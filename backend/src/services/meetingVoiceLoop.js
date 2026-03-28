/**
 * Meeting Voice Loop — wake-word-gated voice assistant in Recall.ai meetings
 *
 * Architecture: Recall.ai transcription webhook → wake word check → Claude → ElevenLabs TTS → Recall output_audio
 *
 * The bot is COMPLETELY SILENT unless someone says "Coppice" or "hey Coppice".
 * After activation, stays responsive for 45 seconds, then goes back to passive listening.
 * All meeting audio is tracked for context so the bot knows what's being discussed.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getMeetingPrompt } from './chatService.js';
import { getTenantDb } from '../cache/database.js';
import { getVisualContext, isVisionActive } from './geminiVisionService.js';

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah
const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;

const SPEECH_PAUSE_MS = 2000;       // debounce: wait for speaker to finish
const ACTIVE_DURATION_MS = 45000;   // stay active for 45s after wake word
const ECHO_COOLDOWN_MS = 3000;      // ignore transcripts right after bot speaks (echo suppression)

// Active voice loops keyed by botId
const activeLoops = new Map();

/**
 * Start a voice loop for a bot. No greeting — bot stays silent until addressed.
 */
export async function startVoiceLoop(botId, tenantId = 'default') {
  if (activeLoops.has(botId)) return;

  // Build tenant-aware system prompt with accumulated memory
  let systemPrompt;
  try {
    systemPrompt = getMeetingPrompt(tenantId);
    // Enrich with tenant knowledge
    try {
      const tdb = getTenantDb(tenantId);
      const meetings = tdb.prepare(
        `SELECT title, content, recorded_at FROM knowledge_entries WHERE tenant_id = ? AND type = 'meeting' AND processed = 1 ORDER BY recorded_at DESC LIMIT 3`
      ).all(tenantId);
      const items = tdb.prepare(
        `SELECT title, assignee, due_date FROM action_items WHERE tenant_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 10`
      ).all(tenantId);
      if (meetings.length > 0) {
        systemPrompt += '\n\nRECENT MEETINGS:';
        for (const m of meetings) systemPrompt += `\n- ${m.title} (${m.recorded_at}): ${(m.content || '').slice(0, 300)}`;
      }
      if (items.length > 0) {
        systemPrompt += '\n\nOPEN ACTION ITEMS:';
        for (const i of items) systemPrompt += `\n- [${i.assignee || '?'}] ${i.title}${i.due_date ? ` (due: ${i.due_date})` : ''}`;
      }
    } catch (e) { console.warn('[VoiceLoop] Knowledge enrichment failed:', e.message); }
  } catch {
    systemPrompt = 'You are Coppice, an AI meeting assistant. Be concise. Keep responses to 1-2 sentences.';
  }

  const state = {
    botId,
    tenantId,
    systemPrompt,
    conversationHistory: [],   // Direct bot interactions (user ↔ assistant)
    meetingTranscript: [],     // ALL utterances for context
    isResponding: false,
    lastResponseTime: 0,       // Echo suppression
    pendingText: '',
    pendingSpeaker: '',
    debounceTimer: null,
    // Wake word state
    isActive: false,           // true = responding to all speech
    activeTimeout: null,
  };

  activeLoops.set(botId, state);
  console.log(`[VoiceLoop] Started for bot ${botId} (tenant: ${tenantId}) — SILENT until wake word`);
}

/**
 * Check if text contains the wake word "coppice" (with common misheard variants).
 * NOTE: "copper" removed — too many false positives in construction/business meetings.
 */
function checkWakeWord(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /\bcoppice\b|\bcopice\b|\bcopis\b|\bcop ice\b|\bhey copp/.test(lower);
}

/**
 * Activate the bot — it will respond to all speech for ACTIVE_DURATION_MS.
 */
function activateBot(state) {
  state.isActive = true;
  console.log(`[VoiceLoop] *** ACTIVATED — responding to all speech for ${ACTIVE_DURATION_MS / 1000}s ***`);
  if (state.activeTimeout) clearTimeout(state.activeTimeout);
  state.activeTimeout = setTimeout(() => {
    console.log(`[VoiceLoop] Auto-deactivating — timeout`);
    state.isActive = false;
  }, ACTIVE_DURATION_MS);
}

/**
 * Handle a transcript event from Recall webhook.
 * This is called for EVERY utterance — we decide whether to respond based on wake word.
 */
export function handleTranscriptEvent(botId, msg) {
  const state = activeLoops.get(botId);
  if (!state) {
    // Don't auto-start — voice loop must be explicitly started via startVoiceLoop().
    // Auto-starting caused the bot to respond in meetings where only chat loop was intended.
    return;
  }

  const data = msg.data || msg;
  const speaker = data.speaker || data.participant?.name || '';
  const words = data.words || [];
  const text = words.map(w => w.text || w).join(' ').trim() || data.text || '';

  if (!text || text.length < 2) return;

  // Ignore bot's own speech (echo suppression)
  if (speaker.toLowerCase().includes('coppice')) return;
  if (Date.now() - state.lastResponseTime < ECHO_COOLDOWN_MS) return;

  // Always track full meeting context
  state.meetingTranscript.push({ speaker, text, time: new Date().toISOString() });
  if (state.meetingTranscript.length > 100) {
    state.meetingTranscript = state.meetingTranscript.slice(-80);
  }

  console.log(`[VoiceLoop] [${speaker}]: "${text}" [${state.isActive ? 'ACTIVE' : 'passive'}]`);

  // Check for wake word
  const hasWakeWord = checkWakeWord(text);

  if (!hasWakeWord && !state.isActive) {
    // Passive mode — ignore this utterance
    return;
  }

  if (hasWakeWord) {
    activateBot(state);
  }

  // Accumulate text with debounce (speaker might still be talking)
  state.pendingText += (state.pendingText ? ' ' : '') + text;
  state.pendingSpeaker = speaker;

  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    if (state.pendingText && !state.isResponding) {
      const fullText = state.pendingText;
      const fullSpeaker = state.pendingSpeaker;
      state.pendingText = '';
      state.pendingSpeaker = '';
      respondToSpeech(state, fullText, fullSpeaker);
    }
  }, SPEECH_PAUSE_MS);
}

/**
 * Stop a voice loop.
 */
export function stopVoiceLoop(botId) {
  const state = activeLoops.get(botId);
  if (state) {
    clearTimeout(state.debounceTimer);
    clearTimeout(state.activeTimeout);
    activeLoops.delete(botId);
    console.log(`[VoiceLoop] Stopped for bot ${botId}`);
  }
}

/**
 * Generate a Claude response and speak it into the meeting.
 */
async function respondToSpeech(state, userMessage, speaker) {
  if (state.isResponding) return;
  if (!ELEVENLABS_KEY || !RECALL_API_KEY) {
    console.error('[VoiceLoop] Missing ELEVENLABS_API_KEY or RECALL_API_KEY');
    return;
  }

  state.isResponding = true;

  try {
    // Build context from recent meeting transcript (so bot knows what's being discussed)
    const recentContext = state.meetingTranscript.slice(-20)
      .map(t => `${t.speaker}: ${t.text}`)
      .join('\n');

    // Add user message to conversation history with meeting context
    // Add visual context if vision is active
    let visualNote = '';
    if (isVisionActive(state.botId)) {
      const vision = getVisualContext(state.botId);
      if (vision && vision.description) {
        visualNote = `\n\n[VISUAL CONTEXT — what's on screen right now]: ${vision.description}`;
        if (vision.screenShareDetected) {
          visualNote += ' [Screen share is active]';
        }
      }
    }

    const contextualMessage = recentContext
      ? `[Meeting context — last few utterances]\n${recentContext}${visualNote}\n\n[${speaker} is now addressing you directly]: ${userMessage}`
      : `${userMessage}${visualNote}`;

    state.conversationHistory.push({ role: 'user', content: contextualMessage });
    if (state.conversationHistory.length > 20) {
      state.conversationHistory = state.conversationHistory.slice(-20);
    }

    const anthropic = new Anthropic();
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: state.systemPrompt,
      messages: state.conversationHistory,
    });

    const responseText = completion.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ')
      .trim();

    if (!responseText) {
      state.isResponding = false;
      return;
    }

    console.log(`[VoiceLoop] Responding: "${responseText}"`);
    state.conversationHistory.push({ role: 'assistant', content: responseText });

    await speakText(state, responseText);

    // Do NOT reset active timer — let it expire naturally.
    // Previously this created an infinite loop: respond → reset timer → respond → reset...
  } catch (err) {
    console.error(`[VoiceLoop] Error:`, err.message);
  }

  state.isResponding = false;
  state.lastResponseTime = Date.now();
}

/**
 * Convert text to speech via ElevenLabs and inject into meeting via Recall output_audio.
 */
async function speakText(state, text) {
  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        output_format: 'mp3_44100_128',
      }),
    }
  );

  if (!ttsRes.ok) {
    const errBody = await ttsRes.text();
    console.error(`[VoiceLoop] TTS failed: ${ttsRes.status}`, errBody);
    return;
  }

  const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
  const b64 = audioBuffer.toString('base64');
  console.log(`[VoiceLoop] TTS: ${audioBuffer.length} bytes`);

  const outputRes = await fetch(
    `${RECALL_BASE}/bot/${state.botId}/output_audio/`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Token ${RECALL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind: 'mp3', b64_data: b64 }),
    }
  );

  if (!outputRes.ok) {
    const errBody = await outputRes.text();
    console.error(`[VoiceLoop] output_audio failed: ${outputRes.status}`, errBody);
  } else {
    console.log(`[VoiceLoop] Audio injected into meeting`);
  }
}
