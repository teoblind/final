/**
 * Coppice Voice Relay v5 - Self-connecting (no page dependency)
 *
 * POST /set-bot-id { botId, instructions } -> connects to OpenAI, configures session
 * POST /inject-text { text, speaker } -> sends transcript text, triggers audio response
 * Audio flow: OpenAI response.audio.delta -> buffer PCM -> MP3 via ffmpeg -> output_audio API
 *
 * No webpage, no WebSocket proxy. Relay manages OpenAI Realtime session directly.
 */

import { WebSocket } from "ws";
import { spawn } from "child_process";
import { createServer } from "http";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: resolve(__dirname, '../.env') });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required');
  process.exit(1);
}

const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;
const PORT = parseInt(process.env.PORT || '3003', 10);
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

/**
 * Convert PCM16 (24kHz mono) to MP3 via ffmpeg.
 */
function pcmToMp3(pcmBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
      '-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code}`));
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
    body: JSON.stringify({ kind: 'mp3', b64_data: mp3Buffer.toString('base64') }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
}

// ── Active session ──
let activeSession = null;

/**
 * Start an OpenAI Realtime session for a bot.
 * The relay manages the WebSocket connection directly (no page needed).
 */
function startSession(botId, instructions) {
  if (activeSession?.openaiWs?.readyState === WebSocket.OPEN) {
    console.log('[VoiceRelay] Closing previous session');
    activeSession.openaiWs.close();
  }

  const session = {
    botId,
    openaiWs: null,
    audioBuffer: Buffer.alloc(0),
    audioChunkCount: 0,
    totalBytesSent: 0,
    ready: false,
  };

  async function flushAudio() {
    if (session.audioBuffer.length === 0 || !RECALL_API_KEY) return;
    const pcm = session.audioBuffer;
    session.audioBuffer = Buffer.alloc(0);
    try {
      const mp3 = await pcmToMp3(pcm);
      await sendAudioToRecall(session.botId, mp3);
      session.totalBytesSent += mp3.length;
      const durationMs = Math.round(pcm.length / 2 / 24000 * 1000);
      console.log(`[VoiceRelay] output_audio: ${mp3.length}B MP3, ~${durationMs}ms audio (${session.totalBytesSent}B total)`);
    } catch (err) {
      console.error(`[VoiceRelay] output_audio error: ${err.message}`);
    }
  }

  const ws = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });
  session.openaiWs = ws;

  ws.on('open', () => {
    console.log(`[VoiceRelay] Connected to OpenAI for bot ${botId}`);
    activeSession = session;

    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions,
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: null,
      },
    }));
  });

  ws.on('message', (data) => {
    let event;
    try { event = JSON.parse(data.toString()); } catch { return; }

    switch (event.type) {
      case 'session.created':
        console.log('[VoiceRelay] Session created');
        break;

      case 'session.updated':
        session.ready = true;
        console.log('[VoiceRelay] Session ready - waiting for inject-text');
        break;

      case 'response.audio.delta':
        session.audioChunkCount++;
        if (event.delta) {
          const pcm = Buffer.from(event.delta, 'base64');
          session.audioBuffer = Buffer.concat([session.audioBuffer, pcm]);
        }
        break;

      case 'response.done': {
        const pcmBytes = session.audioBuffer.length;
        const durationMs = Math.round(pcmBytes / 2 / 24000 * 1000);
        console.log(`[VoiceRelay] Response done (${session.audioChunkCount} chunks, ${pcmBytes}B PCM, ~${durationMs}ms)`);
        session.audioChunkCount = 0;
        flushAudio();
        break;
      }

      case 'response.audio_transcript.done':
        console.log(`[VoiceRelay] Said: "${event.transcript}"`);
        break;

      case 'error':
        console.error(`[VoiceRelay] OpenAI error:`, data.toString().slice(0, 500));
        break;

      // Log other interesting events
      case 'conversation.item.created':
      case 'response.created':
        console.log(`[VoiceRelay] ${event.type}`);
        break;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[VoiceRelay] OpenAI closed: ${code} ${reason}`);
    if (activeSession === session) activeSession = null;
  });

  ws.on('error', (err) => {
    console.error(`[VoiceRelay] OpenAI WS error: ${err.message}`);
  });

  return session;
}

// ── HTTP Server ──
const httpServer = createServer((req, res) => {
  // Start session: bot ID + instructions -> connect to OpenAI
  if (req.method === 'POST' && req.url === '/set-bot-id') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { botId, instructions } = JSON.parse(body);
        if (!botId) { res.writeHead(400); res.end('botId required'); return; }

        if (instructions) {
          startSession(botId, instructions);
        } else {
          console.log(`[VoiceRelay] Bot ID stored: ${botId} (no instructions)`);
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } catch (e) {
        res.writeHead(400);
        res.end(e.message);
      }
    });
    return;
  }

  // Inject transcript text -> create conversation item + trigger response
  if (req.method === 'POST' && req.url === '/inject-text') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { text, speaker } = JSON.parse(body);
        if (!text) { res.writeHead(400); res.end('text required'); return; }

        const ws = activeSession?.openaiWs;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          res.writeHead(503);
          res.end('no active session');
          return;
        }

        const label = speaker ? `${speaker} said: "${text}"` : text;
        ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: label }],
          },
        }));
        ws.send(JSON.stringify({ type: 'response.create' }));
        console.log(`[VoiceRelay] Injected: "${label}"`);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } catch (e) {
        res.writeHead(400);
        res.end(e.message);
      }
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      session: activeSession ? {
        botId: activeSession.botId,
        ready: activeSession.ready,
        totalBytesSent: activeSession.totalBytesSent,
      } : null,
    }));
    return;
  }

  res.writeHead(404);
  res.end();
});

httpServer.listen(PORT);
console.log(`[VoiceRelay] v5 - self-connecting, port ${PORT}`);
console.log(`[VoiceRelay] Recall output_audio: ${RECALL_API_KEY ? 'ENABLED' : 'DISABLED'}`);
