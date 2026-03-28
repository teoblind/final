/**
 * Gemini Vision Service — Real-time visual understanding for Coppice meetings
 *
 * Architecture:
 *   Recall.ai bot in meeting → periodic screenshots → Gemini Vision → visual context
 *   The visual context is stored per-bot and injected into Claude's chat/voice responses.
 *
 * Two modes:
 *   1. Polling mode: periodically hits Recall's screenshot endpoint (simple, reliable)
 *   2. WebSocket mode: receives real-time video frames via Recall's media WebSocket (future)
 *
 * Currently uses polling mode — captures a screenshot every POLL_INTERVAL_MS and sends to Gemini.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;

const POLL_INTERVAL_MS = 8000;   // screenshot every 8s
const MAX_HISTORY = 5;           // keep last 5 visual descriptions

// Per-bot vision state
const visionStates = new Map();

let genAI;
let visionModel;

function getVisionModel() {
  if (!visionModel) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    visionModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }
  return visionModel;
}

/**
 * Start vision polling for a bot. Captures screenshots and analyzes them with Gemini.
 */
export function startVisionLoop(botId) {
  if (visionStates.has(botId)) return;

  const state = {
    botId,
    isActive: true,
    pollTimer: null,
    visualContext: [],       // last N visual descriptions
    currentDescription: '',  // most recent frame analysis
    screenShareDetected: false,
    frameCount: 0,
    lastFrameTime: 0,
    errors: 0,
  };

  visionStates.set(botId, state);
  console.log(`[Vision] Started vision loop for bot ${botId} (polling every ${POLL_INTERVAL_MS / 1000}s)`);

  // Start polling
  pollFrame(state);
  state.pollTimer = setInterval(() => pollFrame(state), POLL_INTERVAL_MS);
}

/**
 * Stop vision polling for a bot.
 */
export function stopVisionLoop(botId) {
  const state = visionStates.get(botId);
  if (!state) return;

  state.isActive = false;
  clearInterval(state.pollTimer);
  visionStates.delete(botId);
  console.log(`[Vision] Stopped vision loop for bot ${botId} (${state.frameCount} frames processed)`);
}

/**
 * Get current visual context for a bot — used by chat/voice loops.
 */
export function getVisualContext(botId) {
  const state = visionStates.get(botId);
  if (!state || !state.currentDescription) return null;

  return {
    description: state.currentDescription,
    screenShareDetected: state.screenShareDetected,
    lastUpdated: state.lastFrameTime,
    history: state.visualContext,
  };
}

/**
 * Check if vision is active for a bot.
 */
export function isVisionActive(botId) {
  return visionStates.has(botId);
}

/**
 * Capture a screenshot from the Recall bot and analyze it with Gemini.
 */
async function pollFrame(state) {
  if (!state.isActive) return;

  try {
    // Capture screenshot from Recall.ai
    const frameData = await captureScreenshot(state.botId);
    if (!frameData) return;

    // Analyze with Gemini
    const description = await analyzeFrame(frameData, state);
    if (!description) return;

    state.frameCount++;
    state.lastFrameTime = Date.now();
    state.currentDescription = description;
    state.errors = 0;

    // Detect screen share vs normal video
    state.screenShareDetected = description.toLowerCase().includes('screen share') ||
      description.toLowerCase().includes('presentation') ||
      description.toLowerCase().includes('slide') ||
      description.toLowerCase().includes('document') ||
      description.toLowerCase().includes('spreadsheet') ||
      description.toLowerCase().includes('code') ||
      description.toLowerCase().includes('browser');

    // Keep rolling history
    state.visualContext.push({
      description,
      timestamp: new Date().toISOString(),
      screenShare: state.screenShareDetected,
    });
    if (state.visualContext.length > MAX_HISTORY) {
      state.visualContext = state.visualContext.slice(-MAX_HISTORY);
    }

    if (state.frameCount % 5 === 1) {
      console.log(`[Vision] Frame #${state.frameCount}: ${description.slice(0, 100)}...`);
    }
  } catch (err) {
    state.errors++;
    if (state.errors <= 3 || state.errors % 10 === 0) {
      console.error(`[Vision] Poll error (${state.errors}):`, err.message);
    }
    // Stop after too many consecutive errors
    if (state.errors > 30) {
      console.error(`[Vision] Too many errors — stopping vision for bot ${state.botId}`);
      stopVisionLoop(state.botId);
    }
  }
}

/**
 * Capture a screenshot from the Recall.ai bot.
 * Uses the output_video screenshot endpoint.
 */
async function captureScreenshot(botId) {
  const res = await fetch(`${RECALL_BASE}/bot/${botId}/screenshot/`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${RECALL_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 404 || res.status === 405) {
    // Screenshot endpoint might not be available — try alternative
    return await captureFromMediaEndpoint(botId);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Screenshot API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  // Recall returns { data: "<base64 jpeg>" } or similar
  return data.data || data.image || data.b64_data || null;
}

/**
 * Alternative: get current video frame from Recall's real-time media endpoint.
 */
async function captureFromMediaEndpoint(botId) {
  // Try getting the bot's current video output
  const res = await fetch(`${RECALL_BASE}/bot/${botId}/output_video/`, {
    method: 'GET',
    headers: {
      'Authorization': `Token ${RECALL_API_KEY}`,
    },
  });

  if (!res.ok) return null;

  // If returns binary, convert to base64
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('image')) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  }

  const data = await res.json();
  return data.data || data.image || data.b64_data || null;
}

/**
 * Analyze a video frame with Gemini Vision.
 */
async function analyzeFrame(base64Image, state) {
  const model = getVisionModel();

  // Build a context-aware prompt
  const previousContext = state.visualContext.length > 0
    ? `Previous observation: ${state.visualContext[state.visualContext.length - 1].description}`
    : 'This is the first frame.';

  const prompt = `You are observing a live meeting video feed. Describe what you see concisely (2-3 sentences max).

Focus on:
- Is someone sharing their screen? If so, what's on it (slides, code, document, browser, spreadsheet)?
- If it's a screen share: read any visible text, titles, headers, or key data points
- If it's video of people: how many participants, any gestures or expressions worth noting
- Flag anything that changed since the last observation

${previousContext}

Be factual and specific. If you can read text on screen, include it. Don't speculate about things you can't see.`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64Image,
      },
    },
  ]);

  const response = result.response;
  return response.text().trim();
}

/**
 * Process a manually-provided frame (e.g., from WebSocket or webhook).
 * Returns the Gemini analysis immediately.
 */
export async function processFrame(botId, base64Image) {
  let state = visionStates.get(botId);
  if (!state) {
    // Create a minimal state for one-off analysis
    state = {
      botId,
      isActive: false,
      visualContext: [],
      currentDescription: '',
      screenShareDetected: false,
      frameCount: 0,
      lastFrameTime: 0,
      errors: 0,
    };
  }

  const description = await analyzeFrame(base64Image, state);
  if (description) {
    state.currentDescription = description;
    state.lastFrameTime = Date.now();
    state.frameCount++;
    state.visualContext.push({
      description,
      timestamp: new Date().toISOString(),
    });
    if (state.visualContext.length > MAX_HISTORY) {
      state.visualContext = state.visualContext.slice(-MAX_HISTORY);
    }
    if (!visionStates.has(botId)) {
      visionStates.set(botId, state);
    }
  }

  return description;
}
