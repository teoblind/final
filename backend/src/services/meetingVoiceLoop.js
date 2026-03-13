/**
 * Meeting Voice Loop — real-time conversational AI in Recall.ai meetings
 *
 * Receives real-time transcript events from Recall via WebSocket,
 * sends to Claude for a response, generates TTS via ElevenLabs,
 * and injects audio back into the meeting via Recall output_audio.
 *
 * Flow: Recall transcript WS → Claude → ElevenLabs TTS → Recall output_audio
 */

import Anthropic from '@anthropic-ai/sdk';

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah
const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';

const SYSTEM_PROMPT = `You are Coppice — an AI operations platform built by Sangha Renewables, on a live voice call.

Rules:
- Keep responses to 1-2 SHORT sentences. You're in a real-time conversation.
- Be warm, natural, conversational. No markdown, no bullet points.
- Ask questions back — use the "Hot Potato" method (answer briefly, bounce a question back).
- You know about: ERCOT energy markets, Bitcoin mining co-location, renewable energy IPPs, pool routing, curtailment optimization, insurance, lead generation, CRM.
- If you don't know something, say so briefly and ask a clarifying question.
- Never say "as an AI" or "I don't have feelings". Just be natural.`;

// Active voice loops keyed by botId
const activeLoops = new Map();

// Debounce timer — wait for pause in speech before responding
const SPEECH_PAUSE_MS = 2000;

/**
 * Start a voice loop for a bot.
 */
export function startVoiceLoop(botId) {
  if (activeLoops.has(botId)) return;

  const state = {
    botId,
    conversationHistory: [],
    isResponding: false,
    pendingText: '',
    debounceTimer: null,
  };

  console.log(`[VoiceLoop] Ready for bot ${botId}`);
  activeLoops.set(botId, state);
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

/**
 * Handle a real-time transcript event from Recall WebSocket.
 * Called by the WS handler in index.js.
 */
export function handleTranscriptEvent(botId, msg) {
  // Find or auto-create state for this bot
  let state = activeLoops.get(botId);
  if (!state) {
    // Auto-start if we get transcript events
    state = {
      botId,
      conversationHistory: [],
      isResponding: false,
      pendingText: '',
      debounceTimer: null,
    };
    activeLoops.set(botId, state);
    console.log(`[VoiceLoop] Auto-started for bot ${botId}`);
  }

  // Parse transcript data from Recall event
  const data = msg.data || msg;
  const speaker = data.speaker || data.participant?.name || '';
  const words = data.words || [];
  const text = words.map(w => w.text || w).join(' ').trim() || data.text || '';

  if (!text || text.length < 2) return;

  // Skip bot's own speech
  if (speaker.toLowerCase().includes('coppice')) return;

  console.log(`[VoiceLoop] [${speaker}]: "${text}"`);

  // Accumulate speech and debounce — wait for a pause before responding
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

async function respondToSpeech(state, userMessage) {
  if (state.isResponding) return;
  if (!ELEVENLABS_KEY || !RECALL_API_KEY) return;

  state.isResponding = true;

  try {
    // Add to conversation history
    state.conversationHistory.push({ role: 'user', content: userMessage });
    if (state.conversationHistory.length > 20) {
      state.conversationHistory = state.conversationHistory.slice(-20);
    }

    // Get Claude response
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

    // Generate TTS via ElevenLabs
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: responseText,
          model_id: 'eleven_turbo_v2',
          output_format: 'mp3_44100_128',
        }),
      }
    );

    if (!ttsRes.ok) {
      console.error(`[VoiceLoop] TTS failed: ${ttsRes.status}`, await ttsRes.text());
      state.isResponding = false;
      return;
    }

    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
    const b64 = audioBuffer.toString('base64');

    // Send to Recall bot
    const outputRes = await fetch(
      `https://${RECALL_REGION}.recall.ai/api/v1/bot/${state.botId}/output_audio/`,
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
      console.error(`[VoiceLoop] output_audio failed: ${outputRes.status}`, await outputRes.text());
    }
  } catch (err) {
    console.error(`[VoiceLoop] Error:`, err.message);
  }

  state.isResponding = false;
}
