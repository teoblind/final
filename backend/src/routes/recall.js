/**
 * Recall.ai Routes - Meeting bot management via Recall.ai
 *
 * POST   /api/v1/recall/join              - Send bot to join a meeting
 * DELETE /api/v1/recall/leave/:botId      - Remove bot from meeting
 * POST   /api/v1/recall/webhook           - Recall.ai status/transcript webhooks
 * GET    /api/v1/recall/status/:botId     - Get bot status
 * GET    /api/v1/recall/transcript/:botId - Get meeting transcript
 * GET    /api/v1/recall/bots              - List active bots
 */

import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, renameSync } from 'fs';
import {
  createBot,
  createVoiceBot,
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
import { SANGHA_TENANT_ID } from '../cache/database.js';
import { processUtterance, notifyBotResponded, resetConversation } from '../services/conversationStateMachine.js';
import { sendHtmlEmail } from '../services/emailService.js';
import { getSubdomainForSlug } from '../middleware/tenantResolver.js';

const __filename_recall = fileURLToPath(import.meta.url);
const __dirname_recall = dirname(__filename_recall);
const recallAudioDir = join(__dirname_recall, '../../data/audio/meetings/');
if (!existsSync(recallAudioDir)) mkdirSync(recallAudioDir, { recursive: true });
const recallAudioUpload = multer({ dest: recallAudioDir, limits: { fileSize: 200 * 1024 * 1024 } });

const router = express.Router();

/**
 * Save a bot's accumulated transcript to the database when meeting ends.
 * Triggers AI processing (summarization, action items, entity extraction).
 */
async function saveBotTranscript(botId) {
  const bot = getLocalBot(botId);
  if (!bot || !bot.transcript || bot.transcript.length === 0) {
    console.log(`[Recall] No transcript to save for bot ${botId}`);
    return;
  }
  if (bot._transcriptSaved) return; // prevent double-save
  bot._transcriptSaved = true;

  const tenantId = bot.tenantId || 'zhan-capital';

  // Build plain text transcript with speaker labels
  const transcriptText = bot.transcript
    .map(t => `${t.speaker}: ${t.text}`)
    .join('\n');

  // Build JSON transcript for structured display
  const transcriptJson = bot.transcript;

  // Calculate approximate duration from first to last timestamp
  let durationSeconds = null;
  if (bot.transcript.length >= 2) {
    const first = new Date(bot.transcript[0].timestamp).getTime();
    const last = new Date(bot.transcript[bot.transcript.length - 1].timestamp).getTime();
    durationSeconds = Math.round((last - first) / 1000);
  }

  // Try to get meeting title + participants from Recall API
  let meetingTitle = 'Meeting';
  let participants = [];
  try {
    const remoteBot = await getBotStatus(botId);
    const meetingUrl = remoteBot?.meeting_url || bot.meetingUrl || '';
    participants = remoteBot?.meeting_participants?.map(p => p.name).filter(Boolean) || [];
    if (participants.length > 0) {
      meetingTitle = `Meeting with ${participants.slice(0, 3).join(', ')}`;
      if (participants.length > 3) meetingTitle += ` +${participants.length - 3}`;
    }
  } catch (e) {
    // Fallback: extract unique speakers from transcript
    participants = [...new Set(bot.transcript.map(t => t.speaker).filter(s => s && s !== 'Unknown'))];
    if (participants.length > 0) {
      meetingTitle = `Meeting with ${participants.slice(0, 3).join(', ')}`;
    }
    console.warn(`[Recall] Could not fetch bot details for title: ${e.message}`);
  }

  try {
    const { getTenantDb } = await import('../cache/database.js');
    const db = getTenantDb(tenantId);
    const id = `recall-${botId}-${Date.now()}`;

    db.prepare(`
      INSERT INTO knowledge_entries (id, tenant_id, type, title, transcript, content, source, source_agent, duration_seconds, recorded_at, processed, transcript_json)
      VALUES (?, ?, 'meeting', ?, ?, ?, 'recall-bot', 'coppice-voice-bot', ?, ?, 0, ?)
    `).run(
      id, tenantId, meetingTitle, transcriptText, transcriptText,
      durationSeconds, bot.createdAt || new Date().toISOString(),
      JSON.stringify(transcriptJson)
    );

    console.log(`[Recall] Saved transcript for bot ${botId}: "${meetingTitle}" (${bot.transcript.length} segments, ${transcriptText.split(/\s+/).length} words)`);

    // Trigger async AI processing
    try {
      const { processKnowledgeEntry } = await import('../services/knowledgeProcessor.js');
      processKnowledgeEntry(id, tenantId).catch(err => {
        console.error(`[Recall] Background processing failed for ${id}:`, err.message);
      });
    } catch (e) {
      console.warn('[Recall] Knowledge processor not available:', e.message);
    }

    // Send meeting recap email to the person who invited the bot
    // Skip if this bot was created by calendarPoll (it has its own email flow via processMeetingComplete)
    if (!bot._calendarManaged) {
      sendMeetingRecapEmail({
        botId, entryId: id, tenantId, meetingTitle,
        transcript: bot.transcript, durationSeconds,
        inviterEmail: bot.inviterEmail,
        participants,
      }).catch(e => console.error(`[Recall] Recap email error:`, e.message));
    }
  } catch (e) {
    console.error(`[Recall] Failed to save transcript for bot ${botId}:`, e.message);
  }
}

/**
 * Send a Fireflies-style meeting recap email after a meeting ends.
 */
async function sendMeetingRecapEmail({ botId, entryId, tenantId, meetingTitle, transcript, durationSeconds, inviterEmail, participants }) {
  if (!inviterEmail) {
    console.log(`[Recall] No inviter email for bot ${botId} - skipping recap email`);
    return;
  }

  // Wait for AI processing to complete (summary generation)
  // Poll for up to 120s
  const { getTenantDb } = await import('../cache/database.js');
  const db = getTenantDb(tenantId);
  let entry = null;
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    entry = db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(entryId);
    if (entry?.processed === 1) break;
  }

  const summary = entry?.summary || '';
  const wordCount = transcript.map(t => t.text).join(' ').split(/\s+/).length;

  // Get action items for this entry
  let actionItems = [];
  try {
    actionItems = db.prepare('SELECT title, assignee, due_date FROM action_items WHERE entry_id = ?').all(entryId);
  } catch {}

  // Extract topics from summary (first few key phrases)
  const topics = [];
  const topicMatches = summary.match(/(?:^|\n)[-*]\s+(.+?)(?:\n|$)/g);
  if (topicMatches) {
    for (const m of topicMatches.slice(0, 5)) {
      const cleaned = m.replace(/^[\n\-*\s]+/, '').replace(/[:].+$/, '').trim();
      if (cleaned.length > 3 && cleaned.length < 60) topics.push(cleaned);
    }
  }

  // Build dashboard URL
  const subdomain = getSubdomainForSlug(tenantId);
  const baseDomain = process.env.APP_BASE_DOMAIN || 'coppice.ai';
  const dashboardUrl = `https://${subdomain}.${baseDomain}/#files/Meetings`;

  // Duration formatting
  const mins = durationSeconds ? Math.round(durationSeconds / 60) : 0;
  const durationStr = mins > 0 ? `${mins} min` : 'Unknown duration';

  // Meeting date
  const meetingDate = new Date().toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });
  const meetingTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  // Participant names
  const participantNames = participants.length > 0
    ? participants.slice(0, 6).join(', ') + (participants.length > 6 ? ` +${participants.length - 6} more` : '')
    : 'Unknown participants';

  // Build summary section - extract key bullet points
  const summaryBullets = [];
  const bulletMatches = summary.match(/[-*]\s+(.+)/g);
  if (bulletMatches) {
    for (const b of bulletMatches.slice(0, 6)) {
      summaryBullets.push(b.replace(/^[-*]\s+/, '').trim());
    }
  }
  const summaryHtml = summaryBullets.length > 0
    ? summaryBullets.map(b => `<li style="margin-bottom:8px;color:#374151;font-size:15px;line-height:1.5;">${b}</li>`).join('')
    : `<li style="color:#374151;font-size:15px;">${summary.slice(0, 500) || 'Processing meeting summary...'}</li>`;

  // Action items HTML
  const actionItemsHtml = actionItems.length > 0
    ? actionItems.map(a => {
        let line = `<li style="margin-bottom:6px;color:#374151;font-size:14px;">${a.title}`;
        if (a.assignee) line += ` <span style="color:#6B7280;font-size:13px;">(${a.assignee})</span>`;
        if (a.due_date) line += ` <span style="color:#DC2626;font-size:13px;">due ${a.due_date}</span>`;
        return line + '</li>';
      }).join('')
    : '<li style="color:#9CA3AF;font-size:14px;">No action items detected</li>';

  // Topic tags HTML
  const topicsHtml = topics.length > 0
    ? topics.map(t => `<span style="display:inline-block;background:#F3F4F6;color:#4B5563;border-radius:16px;padding:4px 14px;margin:3px;font-size:13px;">${t}</span>`).join('')
    : '';

  // Stats
  const questionCount = transcript.filter(t => t.text.trim().endsWith('?')).length;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:20px;">

  <!-- Header -->
  <div style="background:#FFFFFF;border-radius:12px 12px 0 0;padding:40px 32px 24px;text-align:center;border-bottom:1px solid #E5E7EB;">
    <div style="width:64px;height:64px;background:linear-gradient(135deg,#6366F1,#8B5CF6);border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:28px;color:#FFFFFF;font-weight:bold;">C</span>
    </div>
    <h1 style="margin:0 0 4px;font-size:22px;color:#111827;font-weight:600;">Meeting Recap</h1>
    <p style="margin:0;color:#6B7280;font-size:14px;">by Coppice</p>
  </div>

  <!-- Meeting Info Card -->
  <div style="background:#FFFFFF;padding:24px 32px;border-bottom:1px solid #E5E7EB;">
    <div style="background:#F9FAFB;border-radius:8px;padding:16px 20px;border:1px solid #E5E7EB;">
      <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#111827;">${meetingTitle}</p>
      <p style="margin:0;color:#6B7280;font-size:14px;">${meetingDate} at ${meetingTime} - ${durationStr}</p>
      <p style="margin:6px 0 0;color:#6B7280;font-size:13px;">${participantNames}</p>
    </div>
  </div>

  <!-- CTA Button -->
  <div style="background:#FFFFFF;padding:20px 32px;text-align:center;border-bottom:1px solid #E5E7EB;">
    <a href="${dashboardUrl}" style="display:inline-block;background:#6366F1;color:#FFFFFF;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;">View meeting recap</a>
  </div>

  <!-- Stats -->
  <div style="background:#FFFFFF;padding:24px 32px;border-bottom:1px solid #E5E7EB;text-align:center;">
    <p style="margin:0 0 12px;color:#9CA3AF;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">In this meeting</p>
    <div style="display:inline-block;">
      ${questionCount > 0 ? `<span style="display:inline-block;background:#FEF3C7;color:#92400E;border-radius:8px;padding:10px 18px;margin:4px;font-size:13px;font-weight:500;">${questionCount}+ Questions asked</span>` : ''}
      ${actionItems.length > 0 ? `<span style="display:inline-block;background:#EDE9FE;color:#5B21B6;border-radius:8px;padding:10px 18px;margin:4px;font-size:13px;font-weight:500;">${actionItems.length} Action item${actionItems.length !== 1 ? 's' : ''}</span>` : ''}
      <span style="display:inline-block;background:#F3F4F6;color:#4B5563;border-radius:8px;padding:10px 18px;margin:4px;font-size:13px;font-weight:500;">${wordCount} words transcribed</span>
    </div>
    ${topicsHtml ? `<div style="margin-top:16px;"><p style="margin:0 0 8px;color:#9CA3AF;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Topics discussed</p>${topicsHtml}</div>` : ''}
  </div>

  <!-- Meeting Summary -->
  <div style="background:#FFFFFF;padding:24px 32px;border-bottom:1px solid #E5E7EB;">
    <h2 style="margin:0 0 12px;font-size:18px;color:#111827;font-weight:600;">Meeting Overview</h2>
    <ul style="margin:0;padding-left:20px;">
      ${summaryHtml}
    </ul>
  </div>

  <!-- Action Items -->
  ${actionItems.length > 0 ? `
  <div style="background:#FFFFFF;padding:24px 32px;border-bottom:1px solid #E5E7EB;">
    <h2 style="margin:0 0 12px;font-size:18px;color:#111827;font-weight:600;">Action Items</h2>
    <ul style="margin:0;padding-left:20px;">
      ${actionItemsHtml}
    </ul>
  </div>
  ` : ''}

  <!-- View Full Notes CTA -->
  <div style="background:#FFFFFF;padding:24px 32px;text-align:center;border-bottom:1px solid #E5E7EB;">
    <a href="${dashboardUrl}" style="display:inline-block;background:#111827;color:#FFFFFF;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:15px;font-weight:600;">View complete meeting notes</a>
  </div>

  <!-- Footer -->
  <div style="background:#FFFFFF;border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;">
    <p style="margin:0 0 4px;color:#6B7280;font-size:13px;">Meeting notes taken by <a href="https://coppice.ai" style="color:#6366F1;text-decoration:none;">Coppice</a></p>
    <p style="margin:0;color:#9CA3AF;font-size:12px;">Sent to ${inviterEmail}</p>
  </div>

</div>
</body>
</html>`;

  const inviterName = inviterEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  await sendHtmlEmail({
    to: inviterEmail,
    subject: `Meeting Recap: ${meetingTitle}`,
    html,
    tenantId,
    skipSignature: true,
  });
  console.log(`[Recall] Recap email sent to ${inviterEmail} for "${meetingTitle}"`);
}

// ── Unauthenticated routes - Recall.ai webhooks (called by Recall servers, not users) ──

/**
 * POST /webhook - Recall.ai webhooks for bot status changes
 * No auth - Recall.ai calls this directly.
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

        if (['done', 'analysis_done'].includes(status)) {
          saveBotTranscript(botId).catch(e => console.error(`[Recall] Save transcript error:`, e.message));
          stopChatLoop(botId);
          stopVoiceLoop(botId);
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
        saveBotTranscript(botId).catch(e => console.error(`[Recall] Save transcript error:`, e.message));
        stopChatLoop(botId);
        stopVoiceLoop(botId);
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
 * Flush accumulated speech buffer - send to state machine + relay as one combined utterance.
 * Called after 3s of silence from the same speaker, or when speaker changes.
 */
async function flushSpeechBuffer(botId, sb) {
  sb.timer = null;
  const text = sb.text.trim();
  const speaker = sb.speaker;
  sb.text = '';
  sb.speaker = '';
  if (!text) return;

  const relayUrl = process.env.VOICE_RELAY_LOCAL_URL || 'http://localhost:3003';
  const WAKE_WORD_RE = /\b(coppice|copice|copis|cop ice)\b/i;
  let decision;
  try {
    decision = processUtterance(botId, speaker, text);
  } catch (e) {
    console.error(`[Recall] processUtterance error: ${e.message}`);
    // Fallback: respond if wake word present, otherwise context-only
    decision = { respond: WAKE_WORD_RE.test(text), cancel: false };
  }
  console.log(`[Recall] State machine: respond=${decision.respond}, cancel=${decision.cancel}, speaker="${speaker}", text="${text.slice(0, 80)}"`);

  try {
    if (decision.cancel) {
      await fetch(`${relayUrl}/inject-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '', speaker, cancel: true }),
      });
      console.log(`[Recall] Cancelled bot response (conversation moved on)`);
    }
    await fetch(`${relayUrl}/inject-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speaker, respond: decision.respond }),
    });
    console.log(`[Recall] ${decision.respond ? 'RESPOND' : 'context'}: "${text}" (${speaker})`);
  } catch (e) {
    console.warn(`[Recall] Failed to inject text to relay: ${e.message}`);
  }
}

/**
 * POST /transcript-event - Real-time transcript webhook from Recall.ai
 * No auth - Recall.ai calls this directly.
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
      const text = words.map(w => (typeof w === 'string' ? w : (w.text ?? ''))).join(' ').trim() || transcriptPayload.text || '';
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

      // Voice relay: debounce + conversation state machine
      const speaker = transcriptPayload.participant?.name || transcriptPayload.speaker || 'Unknown';

      // Self-echo filter: skip transcripts from the bot itself
      const isBotSpeaker = /\b(coppice|copice|copis|cop ice)\b/i.test(speaker) || speaker === 'Unknown';
      if (text && !isBotSpeaker) {
        // Debounce: accumulate text from same speaker for 3s before deciding
        // Prevents partial transcript chunks from triggering separate responses
        if (!router._speechBuffer) router._speechBuffer = {};
        const buf = router._speechBuffer;

        if (!buf[botId]) buf[botId] = { speaker: '', text: '', timer: null };
        const sb = buf[botId];

        // If same speaker, accumulate. If different speaker, flush previous first.
        if (sb.timer && sb.speaker !== speaker) {
          clearTimeout(sb.timer);
          flushSpeechBuffer(botId, sb);
        }

        sb.speaker = speaker;
        sb.text = sb.text ? `${sb.text} ${text}` : text;
        if (sb.timer) clearTimeout(sb.timer);
        sb.timer = setTimeout(() => flushSpeechBuffer(botId, sb), 2000);
      } else if (isBotSpeaker && text) {
        console.log(`[Recall] Skipped self-echo from "${speaker}": "${text.slice(0, 80)}"`);
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('[Recall] Transcript event error:', error.message);
    res.sendStatus(200);
  }
});

/**
 * POST /bot-responded - Notify state machine that bot finished responding
 * Called by voice relay after response.done
 */
router.post('/bot-responded', (req, res) => {
  const { botId } = req.body;
  if (botId) notifyBotResponded(botId);
  res.sendStatus(200);
});

/**
 * POST /create-meeting-task - Create a task/action item from a live meeting
 * Called by voice relay when OpenAI calls the create_task tool.
 */
router.post('/create-meeting-task', async (req, res) => {
  try {
    const { botId, title, assignee, due_date } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });

    const bot = getLocalBot(botId);
    const tenantId = bot?.tenantId || 'zhan-capital';

    const { getTenantDb } = await import('../cache/database.js');
    const db = getTenantDb(tenantId);
    const id = `meeting-task-${Date.now()}`;

    db.prepare(`
      INSERT INTO action_items (id, tenant_id, entry_id, title, assignee, due_date, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
    `).run(id, tenantId, `meeting-${botId || 'live'}`, title, assignee || null, due_date || null, new Date().toISOString());

    console.log(`[Recall] Meeting task created: "${title}" (assignee: ${assignee || 'unassigned'})`);
    res.json({ id, title, created: true });
  } catch (e) {
    console.error('[Recall] Create meeting task error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /start-voice-loop - Start voice loop for a manually-created bot (e.g. from menu bar app)
 * No auth - called by local menu bar app.
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
 * POST /save-transcript - Save a locally-captured meeting transcript
 * No auth - called by local menu bar app.
 * Body: { tenantId, title, date, transcript, duration, source }
 */
router.post('/save-transcript', async (req, res) => {
  try {
    const { tenantId = 'zhan-capital', title, date, transcript, duration, source, transcript_json, summary } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript is required' });

    // Save as a knowledge entry (meeting type) - processed=0 so AI pipeline picks it up
    const { getTenantDb } = await import('../cache/database.js');
    const db = getTenantDb(tenantId);
    const id = `local-${Date.now()}`;
    db.prepare(`
      INSERT INTO knowledge_entries (id, tenant_id, type, title, transcript, content, source, source_agent, duration_seconds, recorded_at, processed, transcript_json)
      VALUES (?, ?, 'meeting', ?, ?, ?, 'local-capture', 'coppice-menubar', ?, ?, 0, ?)
    `).run(id, tenantId, title || 'Untitled Meeting', transcript, transcript, duration || null, date || new Date().toISOString(), transcript_json ? JSON.stringify(transcript_json) : null);

    // Store summary if provided
    if (summary) {
      db.prepare('UPDATE knowledge_entries SET summary = ? WHERE id = ?').run(summary, id);
    }

    console.log(`[Recall] Saved local transcript: "${title}" (${transcript.split(/\s+/).length} words) - queued for AI processing`);

    // Trigger async AI processing (summarization, action items, entity extraction)
    try {
      const { processKnowledgeEntry } = await import('../services/knowledgeProcessor.js');
      processKnowledgeEntry(id, tenantId).catch(err => {
        console.error(`[Recall] Background processing failed for ${id}:`, err.message);
      });
    } catch (e) {
      console.warn('[Recall] Knowledge processor not available:', e.message);
    }

    res.json({ id, saved: true, processing: true });
  } catch (error) {
    console.error('[Recall] Save transcript error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /upload-audio - Upload meeting audio file (no auth, called by menubar)
 * Body: multipart form with 'audio' field + entryId + tenantId
 */
router.post('/upload-audio', recallAudioUpload.single('audio'), async (req, res) => {
  try {
    const { entryId, tenantId = 'zhan-capital' } = req.body;
    if (!entryId || !req.file) {
      return res.status(400).json({ error: 'entryId and audio file are required' });
    }

    const { getTenantDb } = await import('../cache/database.js');
    const db = getTenantDb(tenantId);

    const entry = db.prepare('SELECT id FROM knowledge_entries WHERE id = ?').get(entryId);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const destPath = join(recallAudioDir, `${entryId}.mp3`);
    renameSync(req.file.path, destPath);

    const audioUrl = `/api/v1/knowledge/audio/${entryId}`;
    db.prepare('UPDATE knowledge_entries SET audio_url = ? WHERE id = ?').run(audioUrl, entryId);

    console.log(`[Recall] Audio uploaded for ${entryId}: ${(req.file.size / 1024 / 1024).toFixed(1)}MB`);
    res.json({ audio_url: audioUrl });
  } catch (error) {
    console.error('[Recall] Upload audio error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /video-frame - Real-time video frame webhook from Recall.ai
 * No auth - Recall.ai calls this directly.
 * Receives video frames and sends them to Gemini for analysis.
 */
router.post('/video-frame', async (req, res) => {
  try {
    const event = req.body;
    const botId = event.data?.bot?.id || event.bot?.id || event.data?.bot_id;
    const frameData = event.data?.data || event.data?.frame || event.data?.b64_data;

    if (botId && frameData && isVisionActive(botId)) {
      // Don't await - process in background
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

/**
 * POST /voice-test - Create voice bot without auth (testing only, localhost)
 */
router.post('/voice-test', async (req, res) => {
  // Only allow from localhost
  const ip = req.ip || req.connection.remoteAddress;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    return res.status(403).json({ error: 'localhost only' });
  }
  try {
    const { meetingUrl, tenantId, inviterEmail } = req.body;
    if (!meetingUrl) return res.status(400).json({ error: 'meetingUrl required' });
    const bot = await createVoiceBot(meetingUrl, { botName: 'Coppice', tenantId: tenantId || 'zhan-capital' });
    startChatLoop(bot.id);

    // Store inviter email for recap
    if (inviterEmail) updateLocalBot(bot.id, { inviterEmail });

    res.json({ botId: bot.id, meetingUrl });
  } catch (err) {
    console.error('[Recall] voice-test error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Authenticated routes ──
router.use(authenticate);

/**
 * POST /join - Send a Recall bot to join a meeting
 *
 * Body: { meetingUrl, botName?, transcriptionProvider?, joinMessage? }
 * Returns: { botId, status, meetingUrl }
 */
router.post('/join', async (req, res) => {
  try {
    const { meetingUrl, botName, transcriptionProvider, joinMessage, enableVision, voice, tenantId } = req.body;
    if (!meetingUrl) {
      return res.status(400).json({ error: 'meetingUrl is required' });
    }

    let bot;
    if (voice) {
      // Voice bot: output_media page with OpenAI Realtime API for live conversation
      bot = await createVoiceBot(meetingUrl, { botName: botName || 'Coppice', tenantId: tenantId || SANGHA_TENANT_ID });
    } else {
      bot = await createBot(meetingUrl, { botName, transcriptionProvider, joinMessage });
    }

    // Store inviter email so we can send recap after meeting ends
    const inviterEmail = req.user?.email || req.body.inviterEmail;
    if (inviterEmail) updateLocalBot(bot.id, { inviterEmail });

    // Chat loop for text-based meeting sidebar responses
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
 * DELETE /leave/:botId - Remove bot from meeting
 */
router.delete('/leave/:botId', async (req, res) => {
  try {
    const { botId } = req.params;

    // Save transcript BEFORE removing local bot data (which destroys the in-memory transcript)
    await saveBotTranscript(botId);

    await removeBot(botId);
    stopChatLoop(botId);
    stopVisionLoop(botId);
    resetConversation(botId);
    removeLocalBot(botId);

    res.json({ botId, status: 'leaving' });
  } catch (error) {
    console.error('[Recall] Leave error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /status/:botId - Get bot status (remote + local)
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
 * GET /transcript/:botId - Get transcript for a meeting
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
 * GET /bots - List all active bots
 */
router.get('/bots', (req, res) => {
  res.json({ bots: listActiveBots() });
});

/**
 * POST /chat/:botId - Send a chat message to the meeting
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
 * POST /vision/start/:botId - Enable vision (Gemini) for a bot in a meeting
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
 * POST /vision/stop/:botId - Disable vision for a bot
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
 * GET /vision/:botId - Get current visual context for a bot
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
 * GET /calendar-status - Calendar poll scheduler status + active meeting bots
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
