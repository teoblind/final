/**
 * Meeting Chat Loop — silent transcription + text chat responses
 *
 * Replaces meetingVoiceLoop.js. Coppice no longer speaks in meetings.
 * Instead it:
 *   1. Silently transcribes the entire meeting (Recall handles transcription)
 *   2. Responds via the meeting's text chat when addressed ("Coppice", "hey Coppice")
 *   3. Full transcript is uploaded to the DB post-meeting (handled by bot.py → knowledge endpoint)
 */

import Anthropic from '@anthropic-ai/sdk';
import { sendChatMessage } from './recallService.js';

const SPEECH_PAUSE_MS = 3000; // longer debounce for chat (less urgency than voice)

const SYSTEM_PROMPT = `You are Coppice — an AI operations platform built by Sangha Renewables. You are sitting in a live meeting as a silent observer and note-taker.

Rules:
- You are transcribing the meeting silently. You do NOT speak out loud.
- You can ONLY respond via the meeting's text chat.
- Only respond when someone explicitly addresses you by name ("Coppice", "Hey Coppice").
- If nobody is talking to you, respond with EXACTLY an empty string "".
- Keep responses to 1-2 concise sentences. You're typing in a chat, not giving a speech.
- Be helpful and direct. No markdown, no bullet points.
- You know about: ERCOT energy markets, Bitcoin mining, renewable energy, insurance, lead generation, CRM, pitch decks.
- If asked to take a note or remember something, confirm briefly.
- Never interrupt or inject yourself into conversations not directed at you.`;

// Active chat loops keyed by botId
const activeLoops = new Map();

/**
 * Start a chat loop for a bot. Sends a join message via meeting chat.
 */
export function startChatLoop(botId) {
  if (activeLoops.has(botId)) return;

  const state = {
    botId,
    conversationHistory: [],
    isResponding: false,
    pendingText: '',
    pendingSpeaker: '',
    debounceTimer: null,
  };

  activeLoops.set(botId, state);
  console.log(`[ChatLoop] Started for bot ${botId} (silent mode — chat responses only)`);

  // Send a brief join message in the meeting chat
  sendJoinMessage(botId);
}

async function sendJoinMessage(botId) {
  // Wait a bit for the bot to actually be in the call
  setTimeout(async () => {
    try {
      await sendChatMessage(botId, "Hi! Coppice here — I'll be transcribing this meeting silently. Tag me by name if you need anything.");
      console.log(`[ChatLoop] Join message sent for bot ${botId}`);
    } catch (err) {
      console.error(`[ChatLoop] Failed to send join message:`, err.message);
    }
  }, 15000); // 15s delay to ensure bot is in the call
}

/**
 * Handle a transcript event. Only responds via chat if addressed by name.
 */
export function handleChatTranscriptEvent(botId, msg) {
  let state = activeLoops.get(botId);
  if (!state) {
    // Auto-start if we get a transcript event without a loop
    state = {
      botId,
      conversationHistory: [],
      isResponding: false,
      pendingText: '',
      pendingSpeaker: '',
      debounceTimer: null,
    };
    activeLoops.set(botId, state);
    console.log(`[ChatLoop] Auto-started for bot ${botId} (from transcript event)`);
  }

  const data = msg.data || msg;
  const speaker = data.speaker || data.participant?.name || '';
  const words = data.words || [];
  const text = words.map(w => w.text || w).join(' ').trim() || data.text || '';

  if (!text || text.length < 2) return;
  if (speaker.toLowerCase().includes('coppice')) return;

  console.log(`[ChatLoop] [${speaker}]: "${text}"`);

  state.pendingText += (state.pendingText ? ' ' : '') + text;
  if (!state.pendingSpeaker) state.pendingSpeaker = speaker;

  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    if (state.pendingText && !state.isResponding) {
      const fullText = state.pendingText;
      const speakerName = state.pendingSpeaker;
      state.pendingText = '';
      state.pendingSpeaker = '';

      // Only respond if addressed by name
      const lower = fullText.toLowerCase();
      if (lower.includes('coppice') || lower.includes('hey coppice') || lower.includes('ok coppice')) {
        respondViaChat(state, fullText, speakerName);
      }
    }
  }, SPEECH_PAUSE_MS);
}

/**
 * Stop a chat loop.
 */
export function stopChatLoop(botId) {
  const state = activeLoops.get(botId);
  if (state) {
    clearTimeout(state.debounceTimer);
    activeLoops.delete(botId);
    console.log(`[ChatLoop] Stopped for bot ${botId}`);
  }
}

async function respondViaChat(state, userMessage, speaker) {
  if (state.isResponding) return;

  state.isResponding = true;

  try {
    state.conversationHistory.push({ role: 'user', content: `[${speaker}]: ${userMessage}` });
    if (state.conversationHistory.length > 20) {
      state.conversationHistory = state.conversationHistory.slice(-20);
    }

    const anthropic = new Anthropic();
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
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

    console.log(`[ChatLoop] Responding via chat: "${responseText}"`);
    state.conversationHistory.push({ role: 'assistant', content: responseText });

    // Send as a chat message in the meeting
    await sendChatMessage(state.botId, responseText);
    console.log(`[ChatLoop] Chat message sent to meeting`);
  } catch (err) {
    console.error(`[ChatLoop] Error:`, err.message);
  }

  state.isResponding = false;
}
