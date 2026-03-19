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

// Voice session instructions — keyed by session ID, fetched by voice agent page
export const voiceSessions = new Map();

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
    botName = 'Coppice Agent',
    tenantId = null,
    joinMessage = null,
    enableVoice = false,
  } = opts;

  const body = {
    meeting_url: meetingUrl,
    bot_name: botName,
    automatic_leave: {
      waiting_room_timeout: 600,
      noone_joined_timeout: 60,
      everyone_left_timeout: 5,
    },
  };

  // Enable real-time transcription + webhook delivery for voice-enabled bots
  if (enableVoice) {
    const webhookUrl = `${APP_BASE_URL}/api/v1/recall/transcript-event`;
    body.recording_config = {
      transcript: {
        provider: {
          meeting_captions: {},
        },
      },
      realtime_endpoints: [{
        type: 'webhook',
        url: webhookUrl,
        events: ['transcript.data'],
      }],
    };
    console.log(`[Recall] Voice bot with real-time transcription → ${webhookUrl}`);
  }

  if (joinMessage) {
    body.chat = { on_bot_join: { send_to: 'everyone', message: joinMessage } };
  }

  const bot = await recallFetch('/bot/', { method: 'POST', body: JSON.stringify(body) });

  // Track locally
  activeBots.set(bot.id, {
    id: bot.id,
    meetingUrl,
    botName,
    tenantId,
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
 * Create a voice agent bot — joins meeting with output_media (webpage as camera).
 * The webpage captures meeting audio, sends to relay → OpenAI Realtime API,
 * and plays AI responses back into the meeting.
 *
 * @param {string} meetingUrl - Google Meet / Zoom / Teams URL
 * @param {object} opts
 * @param {string} opts.botName - Bot display name (default: "Coppice")
 * @param {string} opts.voiceAgentUrl - URL of the voice agent webpage
 * @param {string} opts.relayUrl - WebSocket URL for the relay server
 * @returns {{ id, meeting_url, status_changes, ... }}
 */
export async function createVoiceBot(meetingUrl, opts = {}) {
  const {
    botName = 'Coppice',
    tenantId = 'default',
    voiceAgentUrl = process.env.VOICE_AGENT_URL || 'https://coppice.ai/voice-agent',
    relayUrl = process.env.VOICE_RELAY_URL || 'wss://coppice.ai/ws/voice-relay/',
  } = opts;

  // Pre-generate a voice session ID — instructions are stored server-side and fetched by the page
  const sessionId = `vs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Build instructions server-side so the page doesn't need to fetch them unreliably
  try {
    const { getMeetingPrompt } = await import('./chatService.js');
    const { getTenantDb } = await import('../cache/database.js');
    let instructions = getMeetingPrompt(tenantId);

    // Enrich with tenant memory
    try {
      const tdb = getTenantDb(tenantId);
      const meetings = tdb.prepare(`SELECT title, content, recorded_at FROM knowledge_entries WHERE tenant_id = ? AND type = 'meeting' AND processed = 1 ORDER BY recorded_at DESC LIMIT 3`).all(tenantId);
      const items = tdb.prepare(`SELECT title, assignee, due_date FROM action_items WHERE tenant_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 10`).all(tenantId);
      if (meetings.length > 0) {
        instructions += '\n\nRECENT MEETINGS:';
        for (const m of meetings) instructions += `\n- ${m.title} (${m.recorded_at}): ${(m.content || '').slice(0, 300)}`;
      }
      if (items.length > 0) {
        instructions += '\n\nOPEN ACTION ITEMS:';
        for (const i of items) instructions += `\n- [${i.assignee || '?'}] ${i.title}${i.due_date ? ` (due: ${i.due_date})` : ''}`;
      }
    } catch (e) { console.warn('[Recall] Failed to enrich voice instructions:', e.message); }

    voiceSessions.set(sessionId, { instructions, createdAt: Date.now() });
    console.log(`[Recall] Voice session ${sessionId}: ${instructions.length} chars of instructions`);
  } catch (e) { console.warn('[Recall] Failed to build voice instructions:', e.message); }

  const pageUrl = `${voiceAgentUrl}?wss=${encodeURIComponent(relayUrl)}&tenant=${encodeURIComponent(tenantId)}&sid=${sessionId}`;

  // Detect platform for variant selection
  const isZoom = meetingUrl.includes('zoom.us');
  const isTeams = meetingUrl.includes('teams.microsoft.com');
  const variant = {};
  if (isZoom) variant.zoom = 'web_4_core';
  else if (isTeams) variant.microsoft_teams = 'web_4_core';
  else variant.google_meet = 'web_4_core';

  const body = {
    meeting_url: meetingUrl,
    bot_name: botName,
    output_media: {
      camera: {
        kind: 'webpage',
        config: { url: pageUrl },
      },
    },
    variant,
    automatic_leave: {
      waiting_room_timeout: 600,
      noone_joined_timeout: 60,
      everyone_left_timeout: 5,
    },
  };

  const bot = await recallFetch('/bot/', { method: 'POST', body: JSON.stringify(body) });

  activeBots.set(bot.id, {
    id: bot.id,
    meetingUrl,
    botName,
    status: 'joining',
    isVoiceAgent: true,
    createdAt: new Date().toISOString(),
    transcript: [],
  });

  console.log(`[Recall] Voice bot ${bot.id} created for ${meetingUrl}`);
  console.log(`[Recall] Page URL: ${pageUrl}`);
  return bot;
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
