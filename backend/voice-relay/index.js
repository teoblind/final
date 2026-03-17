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

wss.on("connection", async (ws, req) => {
  console.log(`[VoiceRelay] New client connected from ${req.socket.remoteAddress}`);

  const client = new RealtimeClient({ apiKey: OPENAI_API_KEY });

  // Relay: OpenAI → Browser
  client.realtime.on("server.*", (event) => {
    if (event.type === 'response.audio.delta') {
      // Don't log audio deltas (too noisy) — just forward
    } else {
      console.log(`[VoiceRelay] OpenAI → Client: ${event.type}`);
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
