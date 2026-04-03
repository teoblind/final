/**
 * Conversation State Machine for Coppice Voice Bot
 *
 * States: IDLE -> ENGAGED -> LISTENING -> COOLDOWN -> IDLE
 *
 * The bot "flows like water" into conversations:
 * - Wake word activates and tracks WHO activated (the interlocutor)
 * - Responds to follow-ups from interlocutor without wake word
 * - Goes silent when conversation moves to other people
 * - Dismissal phrases end the engagement immediately
 */

const STATES = {
  IDLE: 'IDLE',
  ENGAGED: 'ENGAGED',
  LISTENING: 'LISTENING',
  COOLDOWN: 'COOLDOWN',
};

// Timers
const LISTENING_TIMEOUT_MS = 20000;   // 20s in LISTENING before going IDLE
const HARD_CEILING_MS = 90000;        // 90s max engagement
const COOLDOWN_MS = 5000;             // 5s cooldown after dismissal
const INTERLOCUTOR_SILENCE_MS = 30000; // 30s without interlocutor speaking -> LISTENING

// Dismissal patterns - high confidence, from anyone
const PRIMARY_DISMISSALS = [
  /thanks?\s*(coppice|copice|copis)/i,
  /\b(that's all|that'll be all|that's it)\b/i,
  /\b(ok|okay)\s*(got it|thanks|thank you)\b/i,
  /\b(never\s*mind|nevermind)\b/i,
  /\bgot it,?\s*thanks?\b/i,
  /\bwe('re| are)\s*good\b/i,
];

// Secondary dismissals - only from interlocutor, after at least 1 bot response
const SECONDARY_DISMISSALS = [
  /\b(ok|okay|alright)\s*$/i,
  /\b(cool|perfect|great)\s*$/i,
  /\bmoving on\b/i,
  /\blet's\s*(move on|continue|get back)\b/i,
  /\bback to\b/i,
];

const WAKE_WORD_RE = /\b(coppice|copice|copis|cop ice)\b/i;

// Per-bot conversation states
const sessions = new Map();

function getSession(botId) {
  if (!sessions.has(botId)) {
    sessions.set(botId, {
      state: STATES.IDLE,
      interlocutor: null,
      lastBotResponseTime: 0,
      lastInterlocutorSpeechTime: 0,
      engagedSince: 0,
      turnCount: 0,
      recentSpeakers: [],       // last 5 {speaker, time}
      timers: {},
    });
  }
  return sessions.get(botId);
}

function clearTimers(session) {
  for (const key of Object.keys(session.timers)) {
    clearTimeout(session.timers[key]);
    delete session.timers[key];
  }
}

function transitionTo(session, newState, botId) {
  const oldState = session.state;
  session.state = newState;
  clearTimers(session);

  if (newState === STATES.LISTENING) {
    session.timers.listening = setTimeout(() => {
      if (session.state === STATES.LISTENING) {
        console.log(`[ConvoSM] ${botId}: LISTENING timeout -> IDLE`);
        transitionTo(session, STATES.IDLE, botId);
      }
    }, LISTENING_TIMEOUT_MS);
  }

  if (newState === STATES.COOLDOWN) {
    session.timers.cooldown = setTimeout(() => {
      if (session.state === STATES.COOLDOWN) {
        console.log(`[ConvoSM] ${botId}: COOLDOWN expired -> IDLE`);
        transitionTo(session, STATES.IDLE, botId);
      }
    }, COOLDOWN_MS);
  }

  if (newState === STATES.IDLE) {
    session.interlocutor = null;
    session.turnCount = 0;
  }

  if (oldState !== newState) {
    console.log(`[ConvoSM] ${botId}: ${oldState} -> ${newState}${session.interlocutor ? ` (interlocutor: ${session.interlocutor})` : ''}`);
  }
}

/**
 * Check if the conversation has moved on from the bot.
 * Returns a score: >= 4 means "moved on", lower means "still engaged".
 */
function conversationMovedOnScore(session, speaker, text) {
  let score = 0;
  const isInterlocutor = speaker === session.interlocutor;

  // Interlocutor addresses someone else by name
  if (isInterlocutor && /^(hey |hi )?\w+,/i.test(text)) {
    const nameMatch = text.match(/^(?:hey |hi )?(\w+),/i);
    if (nameMatch && !WAKE_WORD_RE.test(nameMatch[1])) {
      score += 5;
    }
  }

  // Two consecutive non-interlocutor speakers
  const recent = session.recentSpeakers;
  if (recent.length >= 2) {
    const last = recent[recent.length - 1];
    const prev = recent[recent.length - 2];
    if (last.speaker !== session.interlocutor &&
        prev.speaker !== session.interlocutor &&
        last.speaker !== prev.speaker) {
      score += 4;
    }
  }

  // Non-interlocutor asks a question (text ends with ?)
  if (!isInterlocutor && text.trim().endsWith('?') && !WAKE_WORD_RE.test(text)) {
    score += 2;
  }

  // Non-interlocutor long statement (new topic)
  if (!isInterlocutor && text.split(/\s+/).length > 15 && !WAKE_WORD_RE.test(text)) {
    score += 1;
  }

  // --- Signals AGAINST moving on ---

  // Interlocutor is speaking
  if (isInterlocutor) {
    score -= 5;
  }

  // Short filler from non-interlocutor
  if (!isInterlocutor && text.split(/\s+/).length <= 3) {
    const fillers = /^(yeah|yes|right|mm-?hmm|ok|okay|sure|uh-?huh|exactly|agreed)\.?$/i;
    if (fillers.test(text.trim())) {
      score -= 1;
    }
  }

  // References bot or bot's response
  if (WAKE_WORD_RE.test(text) || /\b(you said|can you also|what about|and also|you mentioned)\b/i.test(text)) {
    score -= 3;
  }

  return score;
}

/**
 * Check for dismissal phrases.
 * Returns true if the utterance is a dismissal.
 */
function isDismissal(session, speaker, text) {
  // Primary dismissals - anyone can trigger
  for (const pattern of PRIMARY_DISMISSALS) {
    if (pattern.test(text)) return true;
  }

  // Secondary dismissals - only from interlocutor, after at least 1 response
  if (speaker === session.interlocutor && session.turnCount >= 1) {
    for (const pattern of SECONDARY_DISMISSALS) {
      if (pattern.test(text)) return true;
    }
  }

  return false;
}

/**
 * Process an utterance and decide whether to respond.
 *
 * @param {string} botId
 * @param {string} speaker - Speaker name from transcript
 * @param {string} text - What was said
 * @returns {{ respond: boolean, cancel: boolean }}
 *   respond=true: trigger audio response
 *   cancel=true: cancel any in-progress response (conversation moved on)
 */
export function processUtterance(botId, speaker, text) {
  const session = getSession(botId);
  const now = Date.now();
  const hasWakeWord = WAKE_WORD_RE.test(text);

  // Track recent speakers
  session.recentSpeakers.push({ speaker, time: now });
  if (session.recentSpeakers.length > 5) session.recentSpeakers.shift();

  // COOLDOWN: ignore everything except wake word
  if (session.state === STATES.COOLDOWN) {
    if (hasWakeWord) {
      session.interlocutor = speaker;
      session.engagedSince = now;
      session.turnCount = 0;
      transitionTo(session, STATES.ENGAGED, botId);
      return { respond: true, cancel: false };
    }
    return { respond: false, cancel: false };
  }

  // IDLE: only respond to wake word
  if (session.state === STATES.IDLE) {
    if (hasWakeWord) {
      session.interlocutor = speaker;
      session.engagedSince = now;
      session.turnCount = 0;
      transitionTo(session, STATES.ENGAGED, botId);
      return { respond: true, cancel: false };
    }
    return { respond: false, cancel: false };
  }

  // LISTENING: waiting for interlocutor follow-up
  if (session.state === STATES.LISTENING) {
    if (hasWakeWord) {
      session.interlocutor = speaker;
      session.engagedSince = now;
      session.turnCount = 0;
      transitionTo(session, STATES.ENGAGED, botId);
      return { respond: true, cancel: false };
    }
    if (speaker === session.interlocutor) {
      // Interlocutor followed up - re-engage
      transitionTo(session, STATES.ENGAGED, botId);
      session.lastInterlocutorSpeechTime = now;
      return { respond: true, cancel: false };
    }
    // Someone else spoke - conversation moved on
    transitionTo(session, STATES.IDLE, botId);
    return { respond: false, cancel: false };
  }

  // ENGAGED: active conversation
  if (session.state === STATES.ENGAGED) {
    // Hard ceiling
    if (now - session.engagedSince > HARD_CEILING_MS) {
      console.log(`[ConvoSM] ${botId}: Hard ceiling reached (${Math.round((now - session.engagedSince) / 1000)}s)`);
      transitionTo(session, STATES.LISTENING, botId);
      return { respond: false, cancel: false };
    }

    // Turn count soft cap - after 5 responses, lower threshold
    const movedOnThreshold = session.turnCount >= 5 ? 1 : 4;

    // Dismissal check
    if (isDismissal(session, speaker, text)) {
      console.log(`[ConvoSM] ${botId}: Dismissal detected from ${speaker}: "${text.slice(0, 60)}"`);
      transitionTo(session, STATES.COOLDOWN, botId);
      return { respond: false, cancel: true };
    }

    // Wake word from new person - switch interlocutor
    if (hasWakeWord && speaker !== session.interlocutor) {
      session.interlocutor = speaker;
      session.turnCount = 0;
      console.log(`[ConvoSM] ${botId}: New interlocutor: ${speaker}`);
      return { respond: true, cancel: false };
    }

    // Wake word from same interlocutor
    if (hasWakeWord) {
      session.lastInterlocutorSpeechTime = now;
      return { respond: true, cancel: false };
    }

    // Interlocutor speaking (no wake word needed)
    if (speaker === session.interlocutor) {
      session.lastInterlocutorSpeechTime = now;
      return { respond: true, cancel: false };
    }

    // Non-interlocutor speaking - check if conversation moved on
    const movedOnScore = conversationMovedOnScore(session, speaker, text);
    if (movedOnScore >= movedOnThreshold) {
      console.log(`[ConvoSM] ${botId}: Conversation moved on (score=${movedOnScore}, threshold=${movedOnThreshold})`);
      transitionTo(session, STATES.LISTENING, botId);
      return { respond: false, cancel: true };
    }

    // Non-interlocutor but conversation hasn't moved on (brief interjection)
    // Respond if it seems directed at bot, otherwise just context
    const seemsDirectedAtBot = WAKE_WORD_RE.test(text) || /\b(can you|could you|you said|what about)\b/i.test(text);
    return { respond: seemsDirectedAtBot, cancel: false };
  }

  return { respond: false, cancel: false };
}

/**
 * Notify that the bot just responded (for turn counting and timing).
 */
export function notifyBotResponded(botId) {
  const session = getSession(botId);
  session.turnCount++;
  session.lastBotResponseTime = Date.now();
}

/**
 * Get current state for debugging.
 */
export function getConversationState(botId) {
  const session = sessions.get(botId);
  if (!session) return null;
  return {
    state: session.state,
    interlocutor: session.interlocutor,
    turnCount: session.turnCount,
    engagedSince: session.engagedSince,
  };
}

/**
 * Reset state when bot leaves meeting.
 */
export function resetConversation(botId) {
  const session = sessions.get(botId);
  if (session) {
    clearTimers(session);
    sessions.delete(botId);
  }
}
