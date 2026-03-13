/**
 * Recall.ai Service — Meeting bot API client
 *
 * Replaces the Playwright/Chrome/PulseAudio stack with 3 API calls:
 * - createBot() → bot joins meeting
 * - removeBot() → bot leaves
 * - sendAudio() → inject TTS audio into meeting
 *
 * Auth: Token-based. Region: us-west-2.recall.ai
 * Pricing: $0.50/hr, first 5 hours free.
 */

const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3002';

// In-memory bot registry — tracks active bots and their state
const activeBots = new Map();

function headers() {
  return {
    'Authorization': `Token ${RECALL_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function recallFetch(path, opts = {}) {
  if (!RECALL_API_KEY) {
    throw new Error('RECALL_API_KEY not configured');
  }
  const url = `${RECALL_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { ...headers(), ...opts.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Recall API ${res.status} ${opts.method || 'GET'} ${path}: ${body}`);
  }
  // DELETE returns 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Create a bot and send it to join a meeting.
 *
 * @param {string} meetingUrl - Google Meet or Zoom URL
 * @param {object} opts - Optional overrides
 * @param {string} opts.botName - Bot display name (default: "Coppice")
 * @param {string} opts.transcriptionProvider - "assembly_ai" or "deepgram"
 * @param {string} opts.joinMessage - Chat message sent on join
 * @returns {{ id, meeting_url, status_changes, ... }}
 */
export async function createBot(meetingUrl, opts = {}) {
  const {
    botName = 'Coppice',
    transcriptionProvider = 'meeting_captions',
    joinMessage = null,
  } = opts;

  const body = {
    meeting_url: meetingUrl,
    bot_name: botName,
    recording_config: {
      transcript: {
        provider: {
          recallai_streaming: {
            mode: 'prioritize_low_latency',
            language_code: 'en',
          },
        },
      },
      realtime_endpoints: [{
        type: 'webhook',
        url: `${APP_BASE_URL}/api/v1/recall/transcript-event`,
        events: ['transcript.data'],
      }],
    },
    automatic_leave: {
      waiting_room_timeout: 600,
      noone_joined_timeout: 60,
      everyone_left_timeout: 5,
    },
  };

  if (joinMessage) {
    body.chat = { on_bot_join: { send_to: 'everyone', message: joinMessage } };
  }

  const bot = await recallFetch('/bot/', { method: 'POST', body: JSON.stringify(body) });

  // Track locally
  activeBots.set(bot.id, {
    id: bot.id,
    meetingUrl,
    botName,
    status: 'joining',
    createdAt: new Date().toISOString(),
    transcript: [],
  });

  console.log(`[Recall] Bot ${bot.id} created for ${meetingUrl}`);
  return bot;
}

/**
 * Remove a bot from its meeting.
 */
export async function removeBot(botId) {
  await recallFetch(`/bot/${botId}/leave_call/`, { method: 'POST' });
  const local = activeBots.get(botId);
  if (local) local.status = 'leaving';
  console.log(`[Recall] Bot ${botId} leaving meeting`);
}

/**
 * Inject audio into the meeting (TTS playback).
 *
 * @param {string} botId
 * @param {Buffer} mp3Buffer - MP3 audio data
 */
export async function sendAudio(botId, mp3Buffer) {
  const base64 = mp3Buffer.toString('base64');
  await recallFetch(`/bot/${botId}/output_audio/`, {
    method: 'POST',
    body: JSON.stringify({
      kind: 'mp3',
      b64_data: base64,
    }),
  });
}

/**
 * Get bot status from Recall.ai.
 */
export async function getBotStatus(botId) {
  return recallFetch(`/bot/${botId}/`);
}

/**
 * Send a chat message to the meeting.
 */
export async function sendChatMessage(botId, message) {
  return recallFetch(`/bot/${botId}/send_chat_message/`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

/**
 * Get the transcript for a bot (from Recall.ai).
 */
export async function getTranscript(botId) {
  return recallFetch(`/bot/${botId}/transcript/`);
}

/**
 * Get local bot state (in-memory).
 */
export function getLocalBot(botId) {
  return activeBots.get(botId) || null;
}

/**
 * Update local bot state from webhook events.
 */
export function updateLocalBot(botId, updates) {
  const bot = activeBots.get(botId);
  if (bot) {
    Object.assign(bot, updates);
  }
}

/**
 * Append a transcript segment to local state.
 */
export function appendTranscript(botId, segment) {
  const bot = activeBots.get(botId);
  if (bot) {
    bot.transcript.push(segment);
  }
}

/**
 * Remove bot from local tracking.
 */
export function removeLocalBot(botId) {
  activeBots.delete(botId);
}

/**
 * List all active bots.
 */
export function listActiveBots() {
  return Array.from(activeBots.values());
}
