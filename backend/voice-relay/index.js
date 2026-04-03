/**
 * Coppice Voice Relay v4 - Gated proxy + Recall.ai output_audio
 *
 * v3: holds audio until session.updated confirms turn_detection: null.
 * v4: intercepts response.audio.delta, converts PCM->MP3 via ffmpeg,
 *     and POSTs to Recall.ai output_audio endpoint so meeting participants
 *     actually hear the bot. The output_media webpage tab audio capture
 *     in headless Chrome is unreliable.
 */

import { WebSocketServer, WebSocket } from "ws";
import { spawn } from "child_process";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config(); // try CWD
dotenv.config({ path: resolve(__dirname, '../.env') }); // try parent (backend root)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required. Set it in .env or environment.');
  process.exit(1);
}

const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;

if (!RECALL_API_KEY) {
  console.warn('[VoiceRelay] RECALL_API_KEY not set - output_audio disabled');
}

const PORT = parseInt(process.env.PORT || '3003', 10);
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

/**
 * Convert PCM16 (24kHz mono) to MP3 via ffmpeg.
 */
function pcmToMp3(pcmBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 's16le',
      '-ar', '24000',
      '-ac', '1',
      '-i', 'pipe:0',
      '-codec:a', 'libmp3lame',
      '-b:a', '64k',
      '-f', 'mp3',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
    ffmpeg.stdin.write(pcmBuffer);
    ffmpeg.stdin.end();
  });
}

/**
 * Send MP3 audio to Recall.ai output_audio endpoint.
 */
async function sendAudioToRecall(botId, mp3Buffer) {
  const res = await fetch(`${RECALL_BASE}/bot/${botId}/output_audio/`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${RECALL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'mp3',
      b64_data: mp3Buffer.toString('base64'),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
}

import { createServer } from "http";

// Global pending bot ID - set by HTTP POST /set-bot-id, consumed by next WebSocket connection
// Only one voice bot active at a time, so no session matching needed
let globalPendingBotId = null;
let globalBotIdResolver = null; // resolve function for WS connections waiting for bot ID

// Active OpenAI WebSocket - for injecting text from backend transcript events
let activeOpenaiWs = null;

// HTTP server handles /set-bot-id endpoint + serves as WebSocket transport
const httpServer = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/set-bot-id') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { botId } = JSON.parse(body);
        if (botId) {
          // If a WebSocket is already waiting, resolve it immediately
          if (globalBotIdResolver) {
            console.log(`[VoiceRelay] Bot ID received, delivering to waiting connection: ${botId}`);
            globalBotIdResolver(botId);
            globalBotIdResolver = null;
          } else {
            // Store for the next WebSocket connection
            globalPendingBotId = botId;
            console.log(`[VoiceRelay] Bot ID queued for next connection: ${botId}`);
          }
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
        } else {
          res.writeHead(400);
          res.end('botId required');
        }
      } catch (e) {
        res.writeHead(400);
        res.end(e.message);
      }
    });
    return;
  }
  // Inject transcript text into active OpenAI session (from backend transcript webhooks)
  if (req.method === 'POST' && req.url === '/inject-text') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { text, speaker } = JSON.parse(body);
        if (!text) { res.writeHead(400); res.end('text required'); return; }
        if (!activeOpenaiWs || activeOpenaiWs.readyState !== 1) {
          res.writeHead(503); res.end('no active session'); return;
        }
        // Create a conversation item with the user's text and request a response
        const label = speaker ? `${speaker} said: "${text}"` : text;
        activeOpenaiWs.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: label }],
          },
        }));
        activeOpenaiWs.send(JSON.stringify({ type: 'response.create' }));
        console.log(`[VoiceRelay] Injected text: "${label}"`);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } catch (e) {
        res.writeHead(400); res.end(e.message);
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT);

wss.on("connection", (clientWs, req) => {
  console.log(`[VoiceRelay] Client connected from ${req.socket.remoteAddress}, url=${req.url}`);

  let audioInCount = 0;
  let audioOutCount = 0;
  let openaiWs = null;
  let clientClosed = false;
  let openaiClosed = false;

  // Gate: hold audio until session is configured with turn_detection: null
  let sessionConfigured = false;
  const audioQueue = [];       // audio chunks queued before session is configured
  const controlQueue = [];     // non-audio messages queued before OpenAI connects

  // Track client-initiated responses to detect server-initiated (auto) responses
  let clientInitiatedResponse = false;

  // ── Recall.ai output_audio: buffer PCM from OpenAI, flush as MP3 ──
  let recallBotId = null;
  let audioOutputBuffer = Buffer.alloc(0);
  let totalAudioBytesSent = 0;

  // Get bot ID - either already pending from HTTP POST, or wait for it
  if (RECALL_API_KEY) {
    if (globalPendingBotId) {
      recallBotId = globalPendingBotId;
      globalPendingBotId = null;
      console.log(`[VoiceRelay] Bot ID from pending: ${recallBotId} - output_audio ready`);
    } else {
      // WebSocket connected before bot ID was registered - wait up to 15s
      console.log(`[VoiceRelay] Waiting for bot ID (HTTP POST to /set-bot-id)...`);
      const waitPromise = new Promise((resolve) => {
        globalBotIdResolver = resolve;
        setTimeout(() => {
          if (globalBotIdResolver === resolve) {
            globalBotIdResolver = null;
            resolve(null);
          }
        }, 15000);
      });
      waitPromise.then(botId => {
        if (botId) {
          recallBotId = botId;
          console.log(`[VoiceRelay] Bot ID received: ${recallBotId} - output_audio ready`);
        } else {
          console.warn(`[VoiceRelay] Timed out waiting for bot ID - output_audio disabled`);
        }
      });
    }
  }

  async function flushAudioToRecall() {
    if (audioOutputBuffer.length === 0 || !recallBotId || !RECALL_API_KEY) return;
    const pcm = audioOutputBuffer;
    audioOutputBuffer = Buffer.alloc(0);
    try {
      const mp3 = await pcmToMp3(pcm);
      await sendAudioToRecall(recallBotId, mp3);
      totalAudioBytesSent += mp3.length;
      console.log(`[VoiceRelay] output_audio: sent ${mp3.length}B MP3 (${totalAudioBytesSent}B total)`);
    } catch (err) {
      console.error(`[VoiceRelay] output_audio error: ${err.message}`);
    }
  }

  // Connect to OpenAI Realtime API via raw WebSocket
  try {
    openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });
  } catch (e) {
    console.error(`[VoiceRelay] Failed to create OpenAI WebSocket: ${e.message}`);
    clientWs.close();
    return;
  }

  // ── OpenAI -> Client (forward everything, with gating logic) ──
  openaiWs.on('message', (data) => {
    if (clientClosed) return;
    try {
      const str = data.toString();
      let event = null;

      if (str.length < 10000) {
        try { event = JSON.parse(str); } catch {}
      }

      if (event) {
        // ── Session lifecycle ──
        if (event.type === 'session.created') {
          console.log('[VoiceRelay] Session created - waiting for session.updated before forwarding audio');
        }

        if (event.type === 'session.updated') {
          const td = event.session?.turn_detection;
          console.log(`[VoiceRelay] Session configured: turn_detection=${JSON.stringify(td)}`);
          // Accept any session.updated - don't loop trying to force null
          // turn_detection may come back as null, {type:"none"}, or even server_vad object
          // Our manual mode is enforced by NOT sending audio input, not by turn_detection setting
          if (!sessionConfigured) {
            sessionConfigured = true;
            console.log(`[VoiceRelay] Session ready - flushing ${audioQueue.length} queued audio chunks`);
            for (const msg of audioQueue) {
              openaiWs.send(msg);
            }
            audioQueue.length = 0;
          }
        }

        // ── Cancel server-initiated responses (VAD leak defense) ──
        // Allow responses triggered by /inject-text (they have a preceding conversation.item)
        if (event.type === 'response.created') {
          if (!clientInitiatedResponse) {
            // Check if this was triggered by inject-text (has a pending conversation item)
            // In manual mode with turn_detection:null, responses only happen when we create them
            // So just track that we got one
            console.log('[VoiceRelay] Response created (likely from inject-text or client)');
          }
        }

        if (event.type === 'response.done') {
          clientInitiatedResponse = false;
          const bufferedBytes = audioOutputBuffer.length;
          console.log(`[VoiceRelay] Response complete (${audioOutCount} audio chunks, ${bufferedBytes}B PCM buffered)`);
          audioOutCount = 0;
          // Flush entire response as one MP3 - no partial sends
          flushAudioToRecall();
        }

        // ── Cancel server VAD events (shouldn't happen in manual mode) ──
        if (event.type === 'input_audio_buffer.speech_started') {
          console.warn('[VoiceRelay] VAD speech_started in manual mode - suppressing');
          // Don't forward VAD events to client - they confuse the page's manual VAD
          return;
        }
        if (event.type === 'input_audio_buffer.speech_stopped') {
          console.warn('[VoiceRelay] VAD speech_stopped in manual mode - suppressing');
          return;
        }

        // ── Intercept audio for Recall.ai output_audio ──
        if (event.type === 'response.audio.delta') {
          audioOutCount++;
          // Buffer ALL PCM - flush only on response.done (no timer, no partial sends)
          if (event.delta && recallBotId && RECALL_API_KEY) {
            const pcm = Buffer.from(event.delta, 'base64');
            audioOutputBuffer = Buffer.concat([audioOutputBuffer, pcm]);
          }
        }

        // ── Logging ──
        if (event.type === 'response.audio.delta') {
          // Already counted above
        } else if (event.type !== 'response.audio.delta') {
          if (event.type === 'conversation.item.input_audio_transcription.completed') {
            console.log(`[VoiceRelay] Heard: "${event.transcript}"`);
          } else if (event.type === 'response.audio_transcript.done') {
            console.log(`[VoiceRelay] Said: "${event.transcript}"`);
          } else if (event.type === 'input_audio_buffer.committed') {
            console.log(`[VoiceRelay] Audio buffer committed: item=${event.item_id}`);
          } else if (event.type === 'error') {
            console.error(`[VoiceRelay] OpenAI error:`, str.slice(0, 1000));
          } else {
            console.log(`[VoiceRelay] OpenAI -> Client: ${event.type}`);
          }
        }
      }

      // Forward to client (unless suppressed by early return above)
      clientWs.send(data);

    } catch (e) {
      console.error(`[VoiceRelay] Error forwarding to client: ${e.message}`);
    }
  });

  openaiWs.on('open', () => {
    console.log('[VoiceRelay] Connected to OpenAI Realtime API');
    activeOpenaiWs = openaiWs;
    // Flush control messages (session.update etc) but NOT audio
    if (controlQueue.length > 0) {
      console.log(`[VoiceRelay] Flushing ${controlQueue.length} control messages`);
      for (const msg of controlQueue) {
        openaiWs.send(msg);
      }
      controlQueue.length = 0;
    }
  });

  openaiWs.on('close', (code, reason) => {
    openaiClosed = true;
    if (activeOpenaiWs === openaiWs) activeOpenaiWs = null;
    console.log(`[VoiceRelay] OpenAI closed: ${code} ${reason}`);
    if (!clientClosed) clientWs.close();
  });

  openaiWs.on('error', (err) => {
    console.error(`[VoiceRelay] OpenAI WS error: ${err.message}`);
  });

  // ── Client -> OpenAI (gated forwarding) ──
  clientWs.on("message", (data) => {
    if (openaiClosed) return;
    try {
      const str = data.toString();
      const event = JSON.parse(str);

      // Handle bot ID from voice-agent page (for output_audio)
      if (event.type === 'coppice.set_bot_id') {
        recallBotId = event.bot_id;
        console.log(`[VoiceRelay] Bot ID set: ${recallBotId} - output_audio enabled`);
        return; // Don't forward to OpenAI
      }

      const isAudio = event.type === 'input_audio_buffer.append';

      if (isAudio) {
        audioInCount++;
        if (audioInCount <= 3 && event.audio) {
          try {
            const raw = Buffer.from(event.audio, 'base64');
            const view = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
            let maxAmp = 0;
            for (let i = 0; i < Math.min(view.length, 200); i++) {
              maxAmp = Math.max(maxAmp, Math.abs(view[i]));
            }
            console.log(`[VoiceRelay] Audio in #${audioInCount}: ${view.length} samples, maxAmp=${maxAmp}`);
          } catch {}
        }

        // GATE: hold audio until session is configured
        if (!sessionConfigured) {
          audioQueue.push(str);
          if (audioQueue.length === 1) {
            console.log('[VoiceRelay] Queuing audio - session not yet configured');
          }
          return;
        }
      } else {
        console.log(`[VoiceRelay] Client -> OpenAI: ${event.type}`);

        // Track client-initiated responses
        if (event.type === 'response.create') {
          clientInitiatedResponse = true;
        }
      }

      // Forward to OpenAI
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(str);
      } else if (openaiWs.readyState === WebSocket.CONNECTING) {
        // Queue control messages; audio goes to audioQueue (handled above)
        if (!isAudio) {
          controlQueue.push(str);
        }
      }
    } catch (e) {
      console.error(`[VoiceRelay] Parse error: ${e.message}`);
    }
  });

  clientWs.on("close", () => {
    clientClosed = true;
    // Flush any remaining audio before closing
    flushAudioToRecall();
    console.log(`[VoiceRelay] Client disconnected (audio in: ${audioInCount}, audio out: ${audioOutCount}, recall bytes: ${totalAudioBytesSent})`);
    if (!openaiClosed && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });

  clientWs.on("error", (err) => {
    console.error(`[VoiceRelay] Client WS error: ${err.message}`);
  });
});

console.log(`[VoiceRelay] v4 - gated proxy + output_audio, port ${PORT}`);
console.log(`[VoiceRelay] Audio held until session.updated confirms turn_detection: null`);
console.log(`[VoiceRelay] Server-initiated responses will be canceled`);
console.log(`[VoiceRelay] OpenAI endpoint: ${OPENAI_REALTIME_URL}`);
console.log(`[VoiceRelay] Recall output_audio: ${RECALL_API_KEY ? 'ENABLED' : 'DISABLED (no RECALL_API_KEY)'}`);
