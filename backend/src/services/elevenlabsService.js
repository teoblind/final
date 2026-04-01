/**
 * ElevenLabs TTS Service - Text-to-speech generation and voice management
 *
 * Provides:
 * - Standard TTS (text → MP3 file)
 * - Streaming TTS (text → chunked audio via WebSocket)
 * - Voice listing and management
 * - Audio file caching and serving
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

// Default voice - can be overridden per tenant
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // "Sarah" - clear, professional
const DEFAULT_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_v3';

// Audio cache directory
const AUDIO_DIR = join(__dirname, '../../data/audio');
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// ─── TTS Generation ─────────────────────────────────────────────────────────

/**
 * Generate speech from text using ElevenLabs API.
 * Returns { audioPath, audioUrl, duration_estimate }
 */
export async function textToSpeech(text, {
  voiceId = DEFAULT_VOICE_ID,
  modelId = DEFAULT_MODEL,
  stability = 0.5,
  similarity = 0.75,
  style = 0.0,
  speed = 1.0,
} = {}) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  // Generate cache key from content hash
  const hash = crypto.createHash('md5').update(`${voiceId}:${modelId}:${text}`).digest('hex');
  const filename = `tts_${hash}.mp3`;
  const audioPath = join(AUDIO_DIR, filename);

  // Check cache
  if (fs.existsSync(audioPath)) {
    const stats = fs.statSync(audioPath);
    return {
      audioPath,
      audioUrl: `/api/v1/voice/audio/${filename}`,
      cached: true,
      size: stats.size,
      duration_estimate: estimateDuration(text),
    };
  }

  // Call ElevenLabs API
  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: similarity,
        style,
        speed,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs API error (${res.status}): ${errText}`);
  }

  // Save audio to file
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(audioPath, buffer);

  return {
    audioPath,
    audioUrl: `/api/v1/voice/audio/${filename}`,
    cached: false,
    size: buffer.length,
    duration_estimate: estimateDuration(text),
  };
}

/**
 * Stream TTS via HTTP streaming endpoint.
 * Returns a readable stream of audio chunks.
 */
export async function streamTextToSpeech(text, {
  voiceId = DEFAULT_VOICE_ID,
  modelId = DEFAULT_MODEL,
} = {}) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs stream error (${res.status}): ${errText}`);
  }

  return res.body;
}

// ─── Voice Management ───────────────────────────────────────────────────────

/**
 * List available voices from ElevenLabs.
 */
export async function listVoices() {
  if (!ELEVENLABS_API_KEY) {
    // Return demo voices when no API key
    return [
      { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', category: 'premade', labels: { accent: 'American', age: 'young', gender: 'female' } },
      { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', category: 'premade', labels: { accent: 'British', age: 'middle-aged', gender: 'male' } },
      { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', category: 'premade', labels: { accent: 'British', age: 'middle-aged', gender: 'male' } },
    ];
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
  });

  if (!res.ok) throw new Error(`Failed to list voices: ${res.status}`);

  const data = await res.json();
  return data.voices.map(v => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
    labels: v.labels || {},
    preview_url: v.preview_url,
  }));
}

/**
 * Get subscription info / usage stats.
 */
export async function getUsage() {
  if (!ELEVENLABS_API_KEY) {
    return { character_count: 0, character_limit: 0, status: 'no_api_key' };
  }

  const res = await fetch(`${ELEVENLABS_BASE}/user/subscription`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
  });

  if (!res.ok) throw new Error(`Failed to get usage: ${res.status}`);

  const data = await res.json();
  return {
    character_count: data.character_count,
    character_limit: data.character_limit,
    tier: data.tier,
    status: data.status,
  };
}

// ─── Audio File Management ──────────────────────────────────────────────────

/**
 * Get the path to a cached audio file.
 */
export function getAudioPath(filename) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = join(AUDIO_DIR, safeName);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

/**
 * Clean up old audio files (older than 24 hours).
 */
export function cleanupAudioCache(maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  let cleaned = 0;
  for (const file of fs.readdirSync(AUDIO_DIR)) {
    const filePath = join(AUDIO_DIR, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > maxAgeMs) {
      fs.unlinkSync(filePath);
      cleaned++;
    }
  }
  return cleaned;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function estimateDuration(text) {
  // Average speaking rate: ~150 words per minute
  const words = text.split(/\s+/).length;
  return Math.round((words / 150) * 60); // seconds
}

// ─── Twilio + ElevenLabs Conversational AI ──────────────────────────────────

/**
 * Get a signed URL for an ElevenLabs Conversational AI agent session.
 * Used for Twilio integration - the agent handles STT + LLM + TTS.
 */
export async function getConversationalAgentUrl(agentId) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/convai/conversation/get_signed_url?agent_id=${agentId}`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to get conversational agent URL: ${errText}`);
  }

  const data = await res.json();
  return data.signed_url;
}
