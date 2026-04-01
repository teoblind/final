/**
 * Coppice Voice Relay v3 - Gated proxy between voice-agent.html and OpenAI Realtime API
 *
 * Key fix over v2: holds ALL audio until session.updated confirms turn_detection: null.
 * This prevents OpenAI's default server VAD from auto-committing audio and creating
 * unwanted responses before manual mode is active.
 *
 * Also cancels any server-initiated responses (defense-in-depth against VAD leaks).
 */

import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required. Set it in .env or environment.');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '3003', 10);
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (clientWs, req) => {
  console.log(`[VoiceRelay] Client connected from ${req.socket.remoteAddress}`);

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
          if (!td || td === null) {
            sessionConfigured = true;
            console.log(`[VoiceRelay] Manual mode confirmed - flushing ${audioQueue.length} queued audio chunks`);
            for (const msg of audioQueue) {
              openaiWs.send(msg);
            }
            audioQueue.length = 0;
          } else {
            // OpenAI didn't apply null turn_detection - force it
            console.warn('[VoiceRelay] turn_detection not null! Forcing override...');
            openaiWs.send(JSON.stringify({
              type: 'session.update',
              session: { turn_detection: null },
            }));
          }
        }

        // ── Cancel server-initiated responses (VAD leak defense) ──
        if (event.type === 'response.created') {
          if (!clientInitiatedResponse) {
            console.warn('[VoiceRelay] Server-initiated response detected - CANCELING');
            openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
            // Don't forward this to client
            return;
          }
        }

        if (event.type === 'response.done') {
          clientInitiatedResponse = false;
          console.log(`[VoiceRelay] Response complete (${audioOutCount} audio chunks)`);
          audioOutCount = 0;
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

        // ── Logging ──
        if (event.type === 'response.audio.delta') {
          audioOutCount++;
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
    console.log(`[VoiceRelay] Client disconnected (audio in: ${audioInCount}, audio out: ${audioOutCount})`);
    if (!openaiClosed && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });

  clientWs.on("error", (err) => {
    console.error(`[VoiceRelay] Client WS error: ${err.message}`);
  });
});

console.log(`[VoiceRelay] v3 - gated proxy, port ${PORT}`);
console.log(`[VoiceRelay] Audio held until session.updated confirms turn_detection: null`);
console.log(`[VoiceRelay] Server-initiated responses will be canceled`);
console.log(`[VoiceRelay] OpenAI endpoint: ${OPENAI_REALTIME_URL}`);
