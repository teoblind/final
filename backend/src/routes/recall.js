/**
 * Recall.ai Routes — Meeting bot management via Recall.ai
 *
 * POST   /api/v1/recall/join              — Send bot to join a meeting
 * DELETE /api/v1/recall/leave/:botId      — Remove bot from meeting
 * POST   /api/v1/recall/webhook           — Recall.ai status/transcript webhooks
 * GET    /api/v1/recall/status/:botId     — Get bot status
 * GET    /api/v1/recall/transcript/:botId — Get meeting transcript
 * GET    /api/v1/recall/bots              — List active bots
 */

import express from 'express';
import {
  createBot,
  removeBot,
  getBotStatus,
  getTranscript,
  sendChatMessage,
  getLocalBot,
  updateLocalBot,
  appendTranscript,
  removeLocalBot,
  listActiveBots,
} from '../services/recallService.js';
import { startChatLoop, stopChatLoop, handleChatTranscriptEvent } from '../services/meetingChatLoop.js';
import { handleTranscriptEvent, startVoiceLoop, stopVoiceLoop } from '../services/meetingVoiceLoop.js';
import { getMeetingRoomByBot, addTranscript } from '../services/meetingRoomService.js';
import { startVisionLoop, stopVisionLoop, getVisualContext, isVisionActive, processFrame } from '../services/geminiVisionService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// ── Unauthenticated routes — Recall.ai webhooks (called by Recall servers, not users) ──

/**
 * POST /webhook — Recall.ai webhooks for bot status changes
 * No auth — Recall.ai calls this directly.
 */
router.post('/webhook', (req, res) => {
  try {
    const event = req.body;
    const eventType = event.event || event.type || 'unknown';
    const botId = event.data?.bot_id || event.bot_id;

    console.log(`[Recall] Webhook: ${eventType} for bot ${botId}`);

    switch (eventType) {
      case 'bot.status_change': {
        const status = event.data?.status?.code || 'unknown';
        updateLocalBot(botId, { status });
        console.log(`[Recall] Bot ${botId} status → ${status}`);

        if (['done', 'fatal', 'analysis_done'].includes(status)) {
          // Clean up
        }
        break;
      }

      case 'bot.transcription': {
        const transcript = event.data?.transcript;
        if (transcript) {
          appendTranscript(botId, {
            speaker: transcript.speaker || 'Unknown',
            text: (transcript.words || []).map(w => w.text).join(' '),
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case 'bot.done': {
        console.log(`[Recall] Bot ${botId} meeting complete`);
        updateLocalBot(botId, { status: 'done' });
        break;
      }

      default:
        console.log(`[Recall] Unhandled webhook event: ${eventType}`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('[Recall] Webhook error:', error.message);
    res.sendStatus(200);
  }
});

/**
 * POST /transcript-event — Real-time transcript webhook from Recall.ai
 * No auth — Recall.ai calls this directly.
 * Feeds both voice loop (audio response) and chat loop (text response).
 */
router.post('/transcript-event', async (req, res) => {
  try {
    const event = req.body;
    console.log(`[Recall] Transcript event: ${JSON.stringify(event).slice(0, 300)}`);
    const botId = event.data?.bot?.id || event.bot?.id || event.data?.bot_id;
    if (botId) {
      const transcriptPayload = event.data?.data || event.data;

      // Append to local transcript store
      const words = transcriptPayload.words || [];
      const text = words.map(w => w.text || w).join(' ').trim() || transcriptPayload.text || '';
      if (text) {
        appendTranscript(botId, {
          speaker: transcriptPayload.speaker || transcriptPayload.participant?.name || 'Unknown',
          text,
          timestamp: new Date().toISOString(),
        });
      }

      // Route to meeting room if this bot is part of one
      const meetingRoom = getMeetingRoomByBot(botId);
      if (meetingRoom) {
        addTranscript(meetingRoom.id, {
          speaker: transcriptPayload.speaker || transcriptPayload.participant?.name || 'Unknown',
          text,
          timestamp: new Date().toISOString(),
        });
      }

      // Voice loop: wake-word-gated audio response
      handleTranscriptEvent(botId, { data: transcriptPayload });

      // Chat loop: text chat response (secondary)
      handleChatTranscriptEvent(botId, { data: transcriptPayload });
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('[Recall] Transcript event error:', error.message);
    res.sendStatus(200);
  }
});

/**
 * POST /start-voice-loop — Start voice loop for a manually-created bot (e.g. from menu bar app)
 * No auth — called by local menu bar app.
 * Body: { botId, tenantId?, meetingTitle? }
 */
router.post('/start-voice-loop', (req, res) => {
  try {
    const { botId, tenantId = 'zhan-capital', meetingTitle } = req.body;
    if (!botId) return res.status(400).json({ error: 'botId is required' });

    startVoiceLoop(botId, tenantId);
    startChatLoop(botId);
    console.log(`[Recall] Voice loop started for bot ${botId} (tenant: ${tenantId}, title: ${meetingTitle || 'unknown'})`);

    res.json({ botId, voiceLoop: true, chatLoop: true });
  } catch (error) {
    console.error('[Recall] Start voice loop error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /save-transcript — Save a locally-captured meeting transcript
 * No auth — called by local menu bar app.
 * Body: { tenantId, title, date, transcript, duration, source }
 */
router.post('/save-transcript', async (req, res) => {
  try {
    const { tenantId = 'zhan-capital', title, date, transcript, duration, source } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript is required' });

    // Save as a knowledge entry (meeting type) — same schema as calendarPoll.js
    const { getTenantDb } = await import('../cache/database.js');
    const db = getTenantDb(tenantId);
    const id = `local-${Date.now()}`;
    db.prepare(`
      INSERT INTO knowledge_entries (id, tenant_id, type, title, transcript, content, source, source_agent, recorded_at, processed)
      VALUES (?, ?, 'meeting', ?, ?, ?, 'local-capture', 'coppice-menubar', ?, 1)
    `).run(id, tenantId, title || 'Untitled Meeting', transcript, transcript, date || new Date().toISOString());
    console.log(`[Recall] Saved local transcript: "${title}" (${transcript.split(/\s+/).length} words)`);

    res.json({ id, saved: true });
  } catch (error) {
    console.error('[Recall] Save transcript error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /video-frame — Real-time video frame webhook from Recall.ai
 * No auth — Recall.ai calls this directly.
 * Receives video frames and sends them to Gemini for analysis.
 */
router.post('/video-frame', async (req, res) => {
  try {
    const event = req.body;
    const botId = event.data?.bot?.id || event.bot?.id || event.data?.bot_id;
    const frameData = event.data?.data || event.data?.frame || event.data?.b64_data;

    if (botId && frameData && isVisionActive(botId)) {
      // Don't await — process in background
      processFrame(botId, frameData).catch(err =>
        console.error(`[Vision] Frame processing error:`, err.message)
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('[Recall] Video frame error:', error.message);
    res.sendStatus(200);
  }
});

// ── Authenticated routes ──
router.use(authenticate);

/**
 * POST /join — Send a Recall bot to join a meeting
 *
 * Body: { meetingUrl, botName?, transcriptionProvider?, joinMessage? }
 * Returns: { botId, status, meetingUrl }
 */
router.post('/join', async (req, res) => {
  try {
    const { meetingUrl, botName, transcriptionProvider, joinMessage, enableVision } = req.body;
    if (!meetingUrl) {
      return res.status(400).json({ error: 'meetingUrl is required' });
    }

    const bot = await createBot(meetingUrl, { botName, transcriptionProvider, joinMessage });

    // Silent mode: transcribe only, respond via meeting chat (not voice)
    startChatLoop(bot.id);

    // Enable vision if requested and Gemini key is configured
    let visionEnabled = false;
    if (enableVision && process.env.GEMINI_API_KEY) {
      // Small delay to let bot join before polling screenshots
      setTimeout(() => startVisionLoop(bot.id), 10000);
      visionEnabled = true;
    }

    res.json({
      botId: bot.id,
      status: 'joining',
      meetingUrl,
      vision: visionEnabled,
    });
  } catch (error) {
    console.error('[Recall] Join error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /leave/:botId — Remove bot from meeting
 */
router.delete('/leave/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    await removeBot(botId);
    stopChatLoop(botId);
    stopVisionLoop(botId);
    removeLocalBot(botId);

    res.json({ botId, status: 'leaving' });
  } catch (error) {
    console.error('[Recall] Leave error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /status/:botId — Get bot status (remote + local)
 */
router.get('/status/:botId', async (req, res) => {
  try {
    const { botId } = req.params;

    // Try remote first, fall back to local
    let remote = null;
    try {
      remote = await getBotStatus(botId);
    } catch {
      // Bot may not exist on Recall anymore
    }

    const local = getLocalBot(botId);

    res.json({
      botId,
      remote: remote ? {
        status: remote.status_changes?.[remote.status_changes.length - 1]?.code || 'unknown',
        meetingUrl: remote.meeting_url,
        botName: remote.bot_name,
        meetingParticipants: remote.meeting_participants,
      } : null,
      local: local ? {
        status: local.status,
        meetingUrl: local.meetingUrl,
        createdAt: local.createdAt,
        transcriptLength: local.transcript?.length || 0,
      } : null,
    });
  } catch (error) {
    console.error('[Recall] Status error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /transcript/:botId — Get transcript for a meeting
 *
 * Tries Recall API first, falls back to local in-memory transcript.
 */
router.get('/transcript/:botId', async (req, res) => {
  try {
    const { botId } = req.params;

    // Try Recall API transcript
    let recallTranscript = null;
    try {
      recallTranscript = await getTranscript(botId);
    } catch {
      // May not be available yet
    }

    // Local transcript from webhook events
    const local = getLocalBot(botId);
    const localTranscript = local?.transcript || [];

    res.json({
      botId,
      recall: recallTranscript,
      local: localTranscript,
    });
  } catch (error) {
    console.error('[Recall] Transcript error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /bots — List all active bots
 */
router.get('/bots', (req, res) => {
  res.json({ bots: listActiveBots() });
});

/**
 * POST /chat/:botId — Send a chat message to the meeting
 */
router.post('/chat/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    await sendChatMessage(botId, message);
    res.json({ botId, sent: true });
  } catch (error) {
    console.error('[Recall] Chat error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /vision/start/:botId — Enable vision (Gemini) for a bot in a meeting
 * Starts polling screenshots and analyzing with Gemini.
 */
router.post('/vision/start/:botId', (req, res) => {
  try {
    const { botId } = req.params;
    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({ error: 'GEMINI_API_KEY not configured' });
    }
    startVisionLoop(botId);
    res.json({ botId, vision: true, polling: true });
  } catch (error) {
    console.error('[Vision] Start error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /vision/stop/:botId — Disable vision for a bot
 */
router.post('/vision/stop/:botId', (req, res) => {
  try {
    const { botId } = req.params;
    stopVisionLoop(botId);
    res.json({ botId, vision: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /vision/:botId — Get current visual context for a bot
 */
router.get('/vision/:botId', (req, res) => {
  try {
    const { botId } = req.params;
    const context = getVisualContext(botId);
    res.json({
      botId,
      active: isVisionActive(botId),
      context: context || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /calendar-status — Calendar poll scheduler status + active meeting bots
 */
router.get('/calendar-status', async (req, res) => {
  try {
    const { getCalendarPollStatus } = await import('../jobs/calendarPoll.js');
    res.json(getCalendarPollStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
