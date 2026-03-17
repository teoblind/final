/**
 * Meeting Voice Loop — event-driven conversational AI in Recall.ai meetings
 *
 * Recall sends transcript.data webhook events → Claude → ElevenLabs TTS → Recall output_audio
 * Greeting is sent when bot joins (detected by polling status).
 */

import Anthropic from '@anthropic-ai/sdk';

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah
const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;

const SPEECH_PAUSE_MS = 2000;

const SYSTEM_PROMPT = `You are Coppice — an AI operations platform built by Sangha Renewables, on a live voice call.

Rules:
- Keep responses to 1-2 SHORT sentences. You're in a real-time conversation.
- Be warm, natural, conversational. No markdown, no bullet points.
- Ask questions back — use the Triple Aikido technique (answer briefly, bounce a question back).
- You know about: ERCOT energy markets, Bitcoin mining co-location, renewable energy IPPs, pool routing, curtailment optimization, insurance, lead generation, CRM.
- If you don't know something, say so briefly and ask a clarifying question.
- Never say "as an AI" or "I don't have feelings". Just be natural.`;

// Active voice loops keyed by botId
const activeLoops = new Map();

/**
 * Start a voice loop for a bot. Waits for bot to join, then sends greeting.
 */
export async function startVoiceLoop(botId) {
  if (activeLoops.has(botId)) return;

  const state = {
    botId,
    conversationHistory: [],
    isResponding: false,
    pendingText: '',
    debounceTimer: null,
    greeted: false,
  };

  activeLoops.set(botId, state);
  console.log(`[VoiceLoop] Started for bot ${botId}`);

  // Poll status until bot is in_call, then greet
  waitForCallAndGreet(state);
}

async function waitForCallAndGreet(state) {
  const check = async () => {
    if (!activeLoops.has(state.botId)) return;

    try {
      const res = await fetch(`${RECALL_BASE}/bot/${state.botId}/`, {
        headers: { 'Authorization': `Token ${RECALL_API_KEY}` },
      });
      if (!res.ok) { setTimeout(check, 5000); return; }

      const bot = await res.json();
      const status = bot.status_changes?.[bot.status_changes.length - 1]?.code;
      console.log(`[VoiceLoop] Bot ${state.botId} status: ${status}`);

      if ((status === 'in_call_not_recording' || status === 'in_call_recording') && !state.greeted) {
        state.greeted = true;
        console.log(`[VoiceLoop] Bot in call, sending greeting`);
        const greeting = "Hey! This is Coppice. I'm here and ready to chat — what's on the agenda?";
        await speakText(state, greeting);
        state.conversationHistory.push({ role: 'assistant', content: greeting });
        console.log(`[VoiceLoop] Greeting sent, waiting for transcript events via webhook`);
        return;
      }

      if (status === 'done' || status === 'fatal') {
        activeLoops.delete(state.botId);
        return;
      }
    } catch (err) {
      console.error(`[VoiceLoop] Status check error:`, err.message);
    }

    setTimeout(check, 5000);
  };

  setTimeout(check, 8000);
}

/**
 * Handle a transcript event from Recall webhook (POST /api/v1/recall/transcript-event).
 */
export function handleTranscriptEvent(botId, msg) {
  let state = activeLoops.get(botId);
  if (!state) {
    state = {
      botId,
      conversationHistory: [],
      isResponding: false,
      pendingText: '',
      debounceTimer: null,
      greeted: true,
    };
    activeLoops.set(botId, state);
    console.log(`[VoiceLoop] Auto-started for bot ${botId} (from webhook event)`);
  }

  const data = msg.data || msg;
  const speaker = data.speaker || data.participant?.name || '';
  const words = data.words || [];
  const text = words.map(w => w.text || w).join(' ').trim() || data.text || '';

  if (!text || text.length < 2) return;
  if (speaker.toLowerCase().includes('coppice')) return;

  console.log(`[VoiceLoop] [${speaker}]: "${text}"`);

  state.pendingText += (state.pendingText ? ' ' : '') + text;

  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    if (state.pendingText && !state.isResponding) {
      const fullText = state.pendingText;
      state.pendingText = '';
      respondToSpeech(state, fullText);
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
    activeLoops.delete(botId);
    console.log(`[VoiceLoop] Stopped for bot ${botId}`);
  }
}

async function respondToSpeech(state, userMessage) {
  if (state.isResponding) return;
  if (!ELEVENLABS_KEY || !RECALL_API_KEY) return;

  state.isResponding = true;

  try {
    state.conversationHistory.push({ role: 'user', content: userMessage });
    if (state.conversationHistory.length > 20) {
      state.conversationHistory = state.conversationHistory.slice(-20);
    }

    const anthropic = new Anthropic();
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
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

    console.log(`[VoiceLoop] Responding: "${responseText}"`);
    state.conversationHistory.push({ role: 'assistant', content: responseText });

    await speakText(state, responseText);
  } catch (err) {
    console.error(`[VoiceLoop] Error:`, err.message);
  }

  state.isResponding = false;
}

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
  console.log(`[VoiceLoop] TTS generated: ${audioBuffer.length} bytes`);

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
    console.log(`[VoiceLoop] Audio sent to meeting`);
  }
}
