/**
 * Voice Routes — ElevenLabs TTS + Twilio voice agent
 *
 * POST   /api/v1/voice/tts           — Generate TTS audio from text
 * POST   /api/v1/voice/tts/stream    — Stream TTS audio
 * GET    /api/v1/voice/audio/:file   — Serve cached audio file
 * GET    /api/v1/voice/voices        — List available voices
 * GET    /api/v1/voice/usage         — Get ElevenLabs usage stats
 * POST   /api/v1/voice/call/inbound  — Twilio webhook for inbound calls
 * POST   /api/v1/voice/call/outbound — Initiate outbound call
 * POST   /api/v1/voice/call/status   — Twilio call status webhook
 */

import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, unlinkSync } from 'fs';
import {
  textToSpeech,
  streamTextToSpeech,
  listVoices,
  getUsage,
  getAudioPath,
  getConversationalAgentUrl,
} from '../services/elevenlabsService.js';

const router = express.Router();

const __filename_voice = fileURLToPath(import.meta.url);
const __dirname_voice = dirname(__filename_voice);

// Multer for audio file uploads (store in /tmp)
const upload = multer({
  dest: join(__dirname_voice, '../../data/audio/uploads/'),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB (Whisper limit)
});

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || '';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3002';

// ─── STT (Whisper) ──────────────────────────────────────────────────────────

/**
 * POST /transcribe — Transcribe audio to text via OpenAI Whisper
 *
 * Accepts multipart form data with an 'audio' file field.
 * Returns { text, language, duration }.
 */
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  try {
    // Read the uploaded file and build FormData for Whisper API
    const audioBuffer = readFileSync(req.file.path);
    const blob = new Blob([audioBuffer], { type: req.file.mimetype || 'audio/m4a' });

    const formData = new FormData();
    formData.append('file', blob, req.file.originalname || 'recording.m4a');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const errBody = await whisperRes.text();
      throw new Error(`Whisper API ${whisperRes.status}: ${errBody}`);
    }

    const result = await whisperRes.json();

    res.json({
      text: result.text || '',
      language: result.language || null,
      duration: result.duration || null,
    });
  } catch (error) {
    console.error('Transcribe error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    // Clean up uploaded file
    try { unlinkSync(req.file.path); } catch {}
  }
});

// ─── TTS Endpoints ──────────────────────────────────────────────────────────

/**
 * POST /tts — Generate TTS audio from text
 */
router.post('/tts', async (req, res) => {
  try {
    const { text, voice_id, model_id } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const result = await textToSpeech(text, {
      voiceId: voice_id,
      modelId: model_id,
    });

    res.json(result);
  } catch (error) {
    console.error('TTS error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /tts/stream — Stream TTS audio directly
 */
router.post('/tts/stream', async (req, res) => {
  try {
    const { text, voice_id, model_id } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const stream = await streamTextToSpeech(text, {
      voiceId: voice_id,
      modelId: model_id,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Pipe the stream directly to the response
    const reader = stream.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        res.write(value);
      }
    };
    pump().catch(err => {
      console.error('Stream pump error:', err);
      res.end();
    });
  } catch (error) {
    console.error('TTS stream error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /audio/:filename — Serve cached audio file
 */
router.get('/audio/:filename', (req, res) => {
  const audioPath = getAudioPath(req.params.filename);
  if (!audioPath) return res.status(404).json({ error: 'Audio not found' });

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(audioPath);
});

/**
 * GET /voices — List available ElevenLabs voices
 */
router.get('/voices', async (req, res) => {
  try {
    const voices = await listVoices();
    res.json({ voices });
  } catch (error) {
    console.error('Voices error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /usage — ElevenLabs usage statistics
 */
router.get('/usage', async (req, res) => {
  try {
    const usage = await getUsage();
    res.json(usage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Twilio Voice Agent ─────────────────────────────────────────────────────

/**
 * POST /call/inbound — Twilio webhook for incoming calls
 *
 * When someone calls the Twilio number, this handler:
 * 1. Gets a signed WebSocket URL from ElevenLabs Conversational AI
 * 2. Returns TwiML that connects the call to the ElevenLabs agent
 */
router.post('/call/inbound', async (req, res) => {
  try {
    const { From, To, CallSid } = req.body;
    console.log(`Inbound call: ${From} → ${To} (${CallSid})`);

    if (!ELEVENLABS_AGENT_ID) {
      // No agent configured — play a message and hang up
      res.type('text/xml');
      return res.send(`
        <Response>
          <Say>Thank you for calling. The voice agent is not yet configured. Please try again later.</Say>
          <Hangup/>
        </Response>
      `);
    }

    // Get signed WebSocket URL from ElevenLabs
    const signedUrl = await getConversationalAgentUrl(ELEVENLABS_AGENT_ID);

    // Return TwiML that connects to ElevenLabs via WebSocket
    res.type('text/xml');
    res.send(`
      <Response>
        <Connect>
          <Stream url="${signedUrl}">
            <Parameter name="caller" value="${From}" />
            <Parameter name="call_sid" value="${CallSid}" />
          </Stream>
        </Connect>
      </Response>
    `);
  } catch (error) {
    console.error('Inbound call error:', error.message);
    res.type('text/xml');
    res.send(`
      <Response>
        <Say>I'm sorry, I'm having trouble connecting. Please try again later.</Say>
        <Hangup/>
      </Response>
    `);
  }
});

/**
 * POST /call/outbound — Initiate an outbound call
 */
router.post('/call/outbound', async (req, res) => {
  try {
    const { to, agent_id } = req.body;
    if (!to) return res.status(400).json({ error: 'to (phone number) is required' });

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      return res.status(500).json({ error: 'Twilio credentials not configured' });
    }

    // Use Twilio REST API to initiate the call
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    const callRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: to,
        From: TWILIO_PHONE_NUMBER,
        Url: `${APP_BASE_URL}/api/v1/voice/call/inbound`, // Reuse inbound handler for the agent connection
        StatusCallback: `${APP_BASE_URL}/api/v1/voice/call/status`,
        StatusCallbackEvent: 'initiated ringing answered completed',
      }),
    });

    if (!callRes.ok) {
      const errText = await callRes.text();
      throw new Error(`Twilio call failed (${callRes.status}): ${errText}`);
    }

    const callData = await callRes.json();
    res.json({
      call_sid: callData.sid,
      status: callData.status,
      to: callData.to,
      from: callData.from,
    });
  } catch (error) {
    console.error('Outbound call error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /call/status — Twilio call status webhook
 */
router.post('/call/status', (req, res) => {
  const { CallSid, CallStatus, Duration, From, To } = req.body;
  console.log(`Call ${CallSid}: ${CallStatus} (${Duration || 0}s) ${From} → ${To}`);

  // TODO: Log to database, trigger knowledge ingestion for completed calls
  res.sendStatus(200);
});

// ─── Browser Voice Chat (ElevenLabs Conversational AI) ──────────────────────

/**
 * GET /conversation/signed-url — Get a signed WebSocket URL for browser voice chat
 *
 * Returns a signed URL that the frontend uses to connect directly to
 * ElevenLabs Conversational AI. This keeps the API key server-side.
 */
router.get('/conversation/signed-url', async (req, res) => {
  try {
    const agentId = req.query.agent_id || ELEVENLABS_AGENT_ID;
    if (!agentId) {
      return res.status(400).json({ error: 'No ElevenLabs agent ID configured' });
    }

    const signedUrl = await getConversationalAgentUrl(agentId);
    res.json({ signed_url: signedUrl });
  } catch (error) {
    console.error('Signed URL error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /conversation/config — Get voice chat configuration for the frontend
 *
 * Returns the agent ID (for public mode) and whether signed URLs are available.
 */
router.get('/conversation/config', (req, res) => {
  res.json({
    agent_id: ELEVENLABS_AGENT_ID || null,
    has_api_key: !!process.env.ELEVENLABS_API_KEY,
    voice_id: process.env.ELEVENLABS_VOICE_ID || null,
  });
});

export default router;
