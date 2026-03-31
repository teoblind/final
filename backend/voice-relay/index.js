/**
 * Coppice Voice Relay v2 — Pure WebSocket proxy between voice-agent.html and OpenAI Realtime API
 *
 * Previous version used @openai/realtime-api-beta SDK which:
 *   1. Dropped ALL non-audio events from the page (session.update, input_audio_buffer.commit,
 *      response.create, conversation.item.delete, etc.) — killing the page's manual VAD + wake word logic
 *   2. Configured its own server_vad session (threshold 0.5), overriding the page's manual mode
 *   3. Sent an unsolicited greeting before the page was ready
 *
 * This version is a transparent bidirectional proxy. The page (voice-agent.html) controls
 * the entire session: instructions, turn detection, when to commit audio, when to respond.
 * The relay just forwards messages and logs them for debugging.
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
  // Queue messages that arrive before OpenAI connection is ready
  const pendingMessages = [];

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

  // ── OpenAI → Client (forward everything) ──
  openaiWs.on('message', (data) => {
    if (clientClosed) return;
    try {
      // Forward raw message to client
      clientWs.send(data);

      // Log non-audio events for debugging
      const str = data.toString();
      if (str.length < 5000) {
        try {
          const event = JSON.parse(str);
          if (event.type === 'response.audio.delta') {
            audioOutCount++;
          } else {
            console.log(`[VoiceRelay] OpenAI -> Client: ${event.type}`);
            if (event.type === 'session.created') {
              console.log('[VoiceRelay] Session created');
            }
            if (event.type === 'session.updated') {
              console.log(`[VoiceRelay] Session config: modalities=${JSON.stringify(event.session?.modalities)}, turn_detection=${JSON.stringify(event.session?.turn_detection)}`);
            }
            if (event.type === 'conversation.item.input_audio_transcription.completed') {
              console.log(`[VoiceRelay] Heard: "${event.transcript}"`);
            }
            if (event.type === 'response.audio_transcript.done') {
              console.log(`[VoiceRelay] Said: "${event.transcript}"`);
            }
            if (event.type === 'response.done') {
              console.log(`[VoiceRelay] Response complete (${audioOutCount} audio chunks sent)`);
              audioOutCount = 0;
            }
            if (event.type === 'input_audio_buffer.speech_started') {
              console.log('[VoiceRelay] VAD: speech started');
            }
            if (event.type === 'input_audio_buffer.speech_stopped') {
              console.log('[VoiceRelay] VAD: speech stopped');
            }
            if (event.type === 'input_audio_buffer.committed') {
              console.log(`[VoiceRelay] Audio buffer committed: item=${event.item_id}`);
            }
            if (event.type === 'error') {
              console.error(`[VoiceRelay] OpenAI error:`, str.slice(0, 1000));
            }
          }
        } catch {} // Not JSON, forward anyway
      }
    } catch (e) {
      console.error(`[VoiceRelay] Error forwarding to client: ${e.message}`);
    }
  });

  openaiWs.on('open', () => {
    console.log('[VoiceRelay] Connected to OpenAI Realtime API');
    // Flush any messages queued during connection
    if (pendingMessages.length > 0) {
      console.log(`[VoiceRelay] Flushing ${pendingMessages.length} queued messages`);
      for (const msg of pendingMessages) {
        openaiWs.send(msg);
      }
      pendingMessages.length = 0;
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

  // ── Client → OpenAI (forward EVERYTHING) ──
  clientWs.on("message", (data) => {
    if (openaiClosed) return;
    try {
      const str = data.toString();
      const event = JSON.parse(str);

      // Log non-audio events
      if (event.type === 'input_audio_buffer.append') {
        audioInCount++;
        // Check amplitude of first few audio chunks for debugging
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
      } else {
        console.log(`[VoiceRelay] Client -> OpenAI: ${event.type}`);
      }

      // Forward to OpenAI (queue if not ready yet)
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(str);
      } else if (openaiWs.readyState === WebSocket.CONNECTING) {
        pendingMessages.push(str);
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

console.log(`[VoiceRelay] v2 — pure proxy, port ${PORT}`);
console.log(`[VoiceRelay] OpenAI endpoint: ${OPENAI_REALTIME_URL}`);
