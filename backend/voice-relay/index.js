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

  // Track audio counts for debugging
  let audioInCount = 0;
  let audioOutCount = 0;

  // Relay: OpenAI → Browser
  client.realtime.on("server.*", (event) => {
    if (event.type === 'response.audio.delta') {
      audioOutCount++;
    } else {
      console.log(`[VoiceRelay] OpenAI → Client: ${event.type}`);
      if (event.type === 'response.done') {
        // Dump full response (minus large audio data)
        const dump = JSON.stringify(event, (k, v) => k === 'audio' || k === 'delta' ? '[audio]' : v);
        console.log(`[VoiceRelay] RESPONSE.DONE: ${dump.slice(0, 2000)}`);
        audioOutCount = 0;
      }
      if (event.type === 'session.updated') {
        console.log(`[VoiceRelay] Session modalities: ${JSON.stringify(event.session?.modalities)}`);
      }
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        console.log(`[VoiceRelay] Heard: "${event.transcript}"`);
      }
      if (event.type === 'response.audio_transcript.done') {
        console.log(`[VoiceRelay] Said: "${event.transcript}"`);
      }
    }
    ws.send(JSON.stringify(event));
  });
  client.realtime.on("close", () => {
    console.log('[VoiceRelay] OpenAI connection closed');
    ws.close();
  });

  // Relay: Browser → OpenAI (only audio input, skip everything else)
  ws.on("message", (data) => {
    if (!client.isConnected()) return;
    try {
      const event = JSON.parse(data);
      if (event.type === 'input_audio_buffer.append') {
        // Forward audio directly to OpenAI
        audioInCount++;
        client.realtime.send(event.type, event);
      } else {
        // Skip all other client events — relay handles session/greeting
        console.log(`[VoiceRelay] Ignoring client event: ${event.type}`);
      }
    } catch (e) {
      console.error(`[VoiceRelay] Parse error: ${e.message}`);
    }
  });

  ws.on("close", () => {
    console.log(`[VoiceRelay] Client disconnected (audio in: ${audioInCount})`);
    client.disconnect();
  });

  // Connect to OpenAI Realtime API
  try {
    console.log('[VoiceRelay] Connecting to OpenAI Realtime API...');
    await client.connect();
    console.log('[VoiceRelay] Connected to OpenAI!');

    // Wait for session to be ready
    await client.waitForSessionCreated();
    console.log('[VoiceRelay] Session created');

    // Configure session via SDK
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
    console.log('[VoiceRelay] Session configured');

    // Send greeting via SDK method
    client.sendUserMessageContent([{
      type: 'input_text',
      text: 'Hello! You just joined a meeting. Please introduce yourself briefly.',
    }]);
    console.log('[VoiceRelay] Greeting sent via SDK');

  } catch (e) {
    console.error(`[VoiceRelay] Failed: ${e.message}`);
    ws.close();
  }
});

console.log(`[VoiceRelay] WebSocket server listening on port ${PORT}`);
