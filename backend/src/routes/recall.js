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
import { handleTranscriptEvent } from '../services/meetingVoiceLoop.js';
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
    const { meetingUrl, botName, transcriptionProvider, joinMessage } = req.body;
    if (!meetingUrl) {
      return res.status(400).json({ error: 'meetingUrl is required' });
    }

    const bot = await createBot(meetingUrl, { botName, transcriptionProvider, joinMessage });

    // Silent mode: transcribe only, respond via meeting chat (not voice)
    startChatLoop(bot.id);

    res.json({
      botId: bot.id,
      status: 'joining',
      meetingUrl,
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
