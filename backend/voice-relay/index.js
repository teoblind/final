import { WebSocketServer } from "ws";
import { RealtimeClient } from "@openai/realtime-api-beta";
import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required. Set it in .env or environment.');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '3003', 10);
const wss = new WebSocketServer({ port: PORT });

const INSTRUCTIONS = `You are Coppice, an AI assistant participating in this meeting.
Be professional, concise, and helpful. Keep responses brief — this is a real-time conversation, not a lecture.
Listen carefully and respond naturally when addressed. If someone greets you, greet them back warmly but briefly.
Never say you were "cut off" or had technical issues unless specifically asked.`;

wss.on("connection", async (ws, req) => {
  console.log(`[VoiceRelay] New client connected from ${req.socket.remoteAddress}`);

  const client = new RealtimeClient({ apiKey: OPENAI_API_KEY });

  // Track audio delta count for debugging
  let audioOutCount = 0;

  // Relay: OpenAI → Browser
  client.realtime.on("server.*", (event) => {
    if (event.type === 'response.audio.delta') {
      audioOutCount++;
    } else {
      console.log(`[VoiceRelay] OpenAI → Client: ${event.type}`);
      // Log response.done details for debugging
      if (event.type === 'response.done') {
        const output = event.response?.output;
        console.log(`[VoiceRelay] Response output items: ${output?.length || 0}, audio chunks sent: ${audioOutCount}`);
        audioOutCount = 0;
      }
    }
    ws.send(JSON.stringify(event));
  });
  client.realtime.on("close", () => {
    console.log('[VoiceRelay] OpenAI connection closed');
    ws.close();
  });

  // Relay: Browser → OpenAI
  const messageQueue = [];
  const messageHandler = (data) => {
    try {
      const event = JSON.parse(data);
      if (event.type === 'input_audio_buffer.append') {
        // Don't log audio appends (too noisy)
      } else if (event.type === 'session.update') {
        // Skip client session.update — relay configures session via SDK
        console.log(`[VoiceRelay] Skipping client session.update (relay handles session config)`);
        return;
      } else {
        console.log(`[VoiceRelay] Client → OpenAI: ${event.type}`);
      }
      client.realtime.send(event.type, event);
    } catch (e) {
      console.error(`[VoiceRelay] Parse error: ${e.message}`);
    }
  };

  ws.on("message", (data) => {
    if (!client.isConnected()) {
      messageQueue.push(data);
    } else {
      messageHandler(data);
    }
  });

  ws.on("close", () => {
    console.log('[VoiceRelay] Client disconnected');
    client.disconnect();
  });

  // Connect to OpenAI Realtime API
  try {
    console.log('[VoiceRelay] Connecting to OpenAI Realtime API...');
    await client.connect();
    console.log('[VoiceRelay] Connected to OpenAI!');

    // Configure session via SDK (not raw event passthrough)
    client.updateSession({
      modalities: ['text', 'audio'],
      instructions: INSTRUCTIONS,
      voice: 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
    });
    console.log('[VoiceRelay] Session configured with audio modalities');

    // Flush queued messages
    while (messageQueue.length) {
      messageHandler(messageQueue.shift());
    }
  } catch (e) {
    console.error(`[VoiceRelay] Failed to connect to OpenAI: ${e.message}`);
    ws.close();
  }
});

console.log(`[VoiceRelay] WebSocket server listening on port ${PORT}`);
