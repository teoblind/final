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
import {
  RecallAudioBridge,
  registerBridge,
  removeBridge,
} from '../services/recallAudioBridge.js';
import { startVoiceLoop, stopVoiceLoop } from '../services/meetingVoiceLoop.js';

const router = express.Router();

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

    // Start the audio bridge only if ElevenLabs is configured
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID) {
      try {
        const bridge = new RecallAudioBridge(bot.id);
        await bridge.start();
        registerBridge(bot.id, bridge);
        console.log(`[Recall] Audio bridge started for bot ${bot.id}`);
      } catch (err) {
        // Non-fatal — bot still joins, just no voice interaction
        console.warn(`[Recall] Audio bridge failed to start for bot ${bot.id}:`, err.message);
      }
    } else {
      console.log(`[Recall] Audio bridge skipped — ElevenLabs not configured`);
    }

    // Start the transcript-based voice loop (polls transcript → Claude → TTS → output_audio)
    startVoiceLoop(bot.id);

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
    removeBridge(botId);
    stopVoiceLoop(botId);
    removeLocalBot(botId);

    res.json({ botId, status: 'leaving' });
  } catch (error) {
    console.error('[Recall] Leave error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /webhook — Recall.ai webhooks for bot status changes and transcription
 *
 * Recall sends events like:
 * - status_change: { bot_id, status: { code, sub_code } }
 * - transcript: { bot_id, transcript: { speaker, words: [...] } }
 * - done: { bot_id, ... }
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

        // If bot is done/fatal, clean up the audio bridge
        if (['done', 'fatal', 'analysis_done'].includes(status)) {
          removeBridge(botId);
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
        removeBridge(botId);
        break;
      }

      default:
        console.log(`[Recall] Unhandled webhook event: ${eventType}`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('[Recall] Webhook error:', error.message);
    res.sendStatus(200); // Always 200 to Recall to prevent retries
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

export default router;
