/**
 * Calendar Poll Job - Multi-tenant meeting auto-join via Recall.ai
 *
 * Replaces the standalone ~/MeetingBot/bot.py with a multi-tenant Node.js job.
 *
 * For each tenant that has a configured agent email (tenant_email_config),
 * this job:
 * 1. Polls the agent's Google Calendar for upcoming meetings
 * 2. Falls back to Gmail inbox scanning for meeting invite emails
 * 3. Dispatches a Recall.ai bot to join each meeting
 * 4. Monitors bots until the meeting ends
 * 5. Retrieves transcript, summarizes with Claude, runs per-tenant
 *    post-meeting processing (action items + follow-up emails)
 *
 * Each tenant's agent only sees its own calendar - Sangha agent polls
 * Sangha meetings, DACP agent polls DACP meetings, etc.
 */

import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import {
  getAllTenants,
  getTenantDb,
  insertActivity,
  runWithTenant,
  getTrustedSenderByEmail,
  getTrustedSenderByDomain,
} from '../cache/database.js';
import {
  createBot,
  createVoiceBot,
  getBotStatus,
  getTranscript,
  getLocalBot,
} from '../services/recallService.js';
import { startChatLoop, stopChatLoop } from '../services/meetingChatLoop.js';
import { startVoiceLoop, stopVoiceLoop } from '../services/meetingVoiceLoop.js';
import { processMeetingComplete } from '../services/meetingProcessor.js';

// ─── Config ──────────────────────────────────────────────────────────────────

// OAuth app credentials - lazy evaluation to avoid ESM ordering bug
// (office.js statically imports this module before dotenv.config() runs)
let _clientPairs = null;
function getClientPairs() {
  if (!_clientPairs) {
    _clientPairs = [
      { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET },
      { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET },
    ].filter(p => p.id && p.secret);
  }
  return _clientPairs;
}

function getFallbackRefreshToken() { return process.env.GMAIL_REFRESH_TOKEN; }

const JOIN_BEFORE_MIN = 2;       // join meetings starting within N minutes
const LOOKBACK_MIN = 30;         // also catch meetings that started up to 30 min ago
const MAX_MEETING_HOURS = 3;     // force-end monitoring after this
const POLL_INTERVAL_SEC = 30;    // how often to check calendars
const BOT_CHECK_SEC = 30;        // how often to check bot status

// ─── State ───────────────────────────────────────────────────────────────────

// Track which tenant calendars need the fallback OAuth client (persists across poll cycles)
const useFallbackClient = new Set();

// eventKey = `${tenantId}:${eventId}` - prevents duplicate joins
const joinedEvents = new Set();

// Active bots: eventKey → { botId, tenantId, meetingName, link, attendees, startTime }
const activeBots = new Map();

// Seen Gmail message IDs per tenant (prevents re-scanning same invite)
const seenGmailIds = new Set();

let pollTimer = null;

// ─── OAuth Helpers ───────────────────────────────────────────────────────────

function makeOAuth2(refreshToken) {
  const pairs = getClientPairs();
  if (!refreshToken || pairs.length === 0) return null;
  const client = new google.auth.OAuth2(pairs[0].id, pairs[0].secret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function makeOAuth2Fallback(refreshToken) {
  const pairs = getClientPairs();
  if (!refreshToken || pairs.length < 2) return null;
  const client = new google.auth.OAuth2(pairs[1].id, pairs[1].secret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function makeCalendarClient(refreshToken) {
  const auth = makeOAuth2(refreshToken);
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

function makeCalendarClientFallback(refreshToken) {
  const auth = makeOAuth2Fallback(refreshToken);
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

function makeGmailClient(refreshToken) {
  const auth = makeOAuth2(refreshToken);
  if (!auth) return null;
  return google.gmail({ version: 'v1', auth });
}

function makeGmailClientFallback(refreshToken) {
  const auth = makeOAuth2Fallback(refreshToken);
  if (!auth) return null;
  return google.gmail({ version: 'v1', auth });
}

// ─── Meeting Link Extraction ─────────────────────────────────────────────────

function extractMeetingLink(event) {
  // 1. Conference data entry points
  const conf = event.conferenceData || {};
  for (const ep of (conf.entryPoints || [])) {
    if (ep.entryPointType === 'video') return ep.uri;
  }

  // 2. Hangout link
  if (event.hangoutLink) return event.hangoutLink;

  // 3. Regex from description/location - supports Meet, Zoom, and Teams
  const text = ((event.description || '') + ' ' + (event.location || '')).trim();
  const match = text.match(
    /https?:\/\/(?:meet\.google\.com\/[a-z\-]+|[\w.]*zoom\.us\/[jw]\/\d+[^\s]*|teams\.microsoft\.com\/(?:l\/meetup-join|meet)\/[^\s<"]+|teams\.live\.com\/meet\/[^\s<"]+)/
  );
  return match ? match[0] : null;
}

// ─── Tenant Calendar Discovery ───────────────────────────────────────────────

/**
 * Build list of tenant calendars to poll from tenant_email_config tables.
 * Each tenant's agent email has its own OAuth token with calendar scope.
 */
function getTenantCalendars() {
  const calendars = [];

  try {
    const tenants = getAllTenants();
    for (const tenant of tenants) {
      try {
        const tdb = getTenantDb(tenant.id);
        const rows = tdb.prepare('SELECT * FROM tenant_email_config').all();
        for (const row of rows) {
          const calLabel = `${row.sender_email} (${tenant.id})`;
          const useFallback = useFallbackClient.has(calLabel);
          const cal = useFallback
            ? (makeCalendarClientFallback(row.gmail_refresh_token) || makeCalendarClient(row.gmail_refresh_token))
            : makeCalendarClient(row.gmail_refresh_token);
          const gmail = useFallback
            ? (makeGmailClientFallback(row.gmail_refresh_token) || makeGmailClient(row.gmail_refresh_token))
            : makeGmailClient(row.gmail_refresh_token);
          if (cal || gmail) {
            calendars.push({
              tenantId: tenant.id,
              calendarClient: cal,
              gmailClient: gmail,
              agentEmail: row.sender_email,
              refreshToken: row.gmail_refresh_token,
              label: calLabel,
            });
          }
        }
      } catch {
        // tenant_email_config table may not exist yet
      }
    }
  } catch {
    // getAllTenants may fail during startup
  }

  // Fallback: default agent account from env vars
  if (getFallbackRefreshToken()) {
    const hasDefault = calendars.some(c =>
      c.agentEmail === 'agent@zhan.coppice.ai'
    );
    if (!hasDefault) {
      const defLabel = 'agent@zhan.coppice.ai (default)';
      const useFallback = useFallbackClient.has(defLabel);
      const cal = useFallback
        ? (makeCalendarClientFallback(getFallbackRefreshToken()) || makeCalendarClient(getFallbackRefreshToken()))
        : makeCalendarClient(getFallbackRefreshToken());
      const gmail = useFallback
        ? (makeGmailClientFallback(getFallbackRefreshToken()) || makeGmailClient(getFallbackRefreshToken()))
        : makeGmailClient(getFallbackRefreshToken());
      if (cal || gmail) {
        calendars.push({
          tenantId: 'zhan-capital',
          calendarClient: cal,
          gmailClient: gmail,
          agentEmail: 'agent@zhan.coppice.ai',
          refreshToken: getFallbackRefreshToken(),
          label: defLabel,
        });
      }
    }
  }

  return calendars;
}

// ─── Calendar Polling ────────────────────────────────────────────────────────

/**
 * Poll a single tenant's calendar for upcoming meetings.
 * Uses Calendar API if scope available, falls back to Gmail inbox scanning.
 */
async function pollTenantCalendar({ tenantId, calendarClient, gmailClient, agentEmail }) {
  const meetings = [];

  // ── 1. Calendar API (requires calendar.readonly scope) ──
  if (calendarClient) {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - LOOKBACK_MIN * 60000);
      const windowEnd = new Date(now.getTime() + JOIN_BEFORE_MIN * 60000);

      const res = await calendarClient.events.list({
        calendarId: 'primary',
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const items = res.data.items || [];
      if (items.length > 0) {
        console.log(`[CalendarPoll] [${agentEmail}] ${items.length} event(s) in poll window [${windowStart.toISOString()} → ${windowEnd.toISOString()}]`);
      }

      for (const event of items) {
        const eventKey = `${tenantId}:${event.id}`;
        if (joinedEvents.has(eventKey)) continue;

        const link = extractMeetingLink(event);
        if (!link) {
          console.log(`[CalendarPoll] [${agentEmail}] Skipping "${event.summary}" - no meeting link found`);
          continue;
        }

        // Check if any existing bot (including recovered ones) is already in this meeting
        const alreadyInMeeting = [...activeBots.values()].some(b =>
          b.link && link.includes(b.link.split('?')[0]) || b.link?.split('?')[0] === link.split('?')[0]
        );
        if (alreadyInMeeting) {
          joinedEvents.add(eventKey); // mark so we don't re-check every cycle
          continue;
        }

        // Skip declined events
        const selfAttendee = (event.attendees || []).find(
          a => a.self || a.email?.toLowerCase() === agentEmail.toLowerCase()
        );
        if (selfAttendee?.responseStatus === 'declined') continue;

        // Only join meetings from trusted senders (owners, team members)
        const organizerEmail = event.organizer?.email || event.creator?.email;
        if (organizerEmail) {
          const orgDomain = organizerEmail.split('@')[1];
          const trusted = getTrustedSenderByEmail(tenantId, organizerEmail)
            || (orgDomain && getTrustedSenderByDomain(tenantId, orgDomain));
          if (!trusted) {
            console.log(`[CalendarPoll] [${agentEmail}] Skipping "${event.summary}" - organizer ${organizerEmail} not trusted`);
            continue;
          }
        }

        meetings.push({
          eventKey,
          eventId: event.id,
          summary: event.summary || 'Untitled Meeting',
          start: event.start?.dateTime || event.start?.date,
          end: event.end?.dateTime || event.end?.date,
          link,
          attendees: (event.attendees || []).map(a => a.email).filter(Boolean),
        });
      }
    } catch (err) {
      const isAuthError = err.code === 401 || err.message?.includes('invalid_grant') ||
        err.message?.includes('Invalid Credentials') || err.message?.includes('unauthorized_client') ||
        err.message?.includes('Token has been expired or revoked');
      if (isAuthError) throw err; // Propagate to poll() for fallback client retry
      // Calendar scope may not be available - fall through to Gmail
      if (err.message?.includes('insufficient')) {
        console.warn(`[CalendarPoll] ${agentEmail}: Calendar scope missing - using Gmail fallback`);
      } else {
        console.warn(`[CalendarPoll] ${agentEmail}: Calendar API error: ${err.message}`);
      }
    }
  }

  // ── 2. Gmail fallback - scan inbox for meeting invite emails ──
  // Uses after: with epoch timestamp for precise time filtering (newer_than uses day granularity)
  if (gmailClient) {
    try {
      const fiveMinAgo = Math.floor((Date.now() - 5 * 60000) / 1000);
      const listRes = await gmailClient.users.messages.list({
        userId: 'me',
        q: `(meet.google.com OR zoom.us OR teams.microsoft.com) after:${fiveMinAgo} -from:me`,
        maxResults: 5,
      });

      for (const msg of (listRes.data.messages || [])) {
        const gmailKey = `${tenantId}:gmail_${msg.id}`;
        if (joinedEvents.has(gmailKey)) continue;
        if (seenGmailIds.has(gmailKey)) continue;

        seenGmailIds.add(gmailKey);

        const full = await gmailClient.users.messages.get({
          userId: 'me', id: msg.id, format: 'full',
        });

        const headers = full.data.payload?.headers || [];
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'Meeting';
        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';

        // Extract body text
        let body = '';
        const payload = full.data.payload;
        if (payload.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body = Buffer.from(part.body.data, 'base64url').toString('utf-8');
              break;
            }
            if (part.mimeType === 'text/html' && part.body?.data) {
              body = Buffer.from(part.body.data, 'base64url').toString('utf-8');
            }
          }
        } else if (payload.body?.data) {
          body = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
        }
        body += ' ' + (full.data.snippet || '');

        // Find meeting link
        const match = body.match(
          /https?:\/\/(?:meet\.google\.com\/[a-z\-]+|[\w.]*zoom\.us\/[jw]\/\d+[^\s"<]*|teams\.microsoft\.com\/(?:l\/meetup-join|meet)\/[^\s"<]+|teams\.live\.com\/meet\/[^\s"<]+)/
        );
        if (!match) continue;

        const link = match[0].replace(/\.$/, '');

        // Check we haven't already joined this link via another detection method
        const alreadyJoined = [...activeBots.values()].some(b => b.link === link);
        if (alreadyJoined) continue;

        // Determine who actually invited - for Google system emails, extract inviter from subject/body
        const fromEmail = fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader;
        let inviterEmail = fromEmail;
        if (/noreply@google\.com$/i.test(fromEmail) || /calendar-notification@google\.com$/i.test(fromEmail)) {
          // "Happening now: teo@zhan.capital is inviting you..." or "Invitation: ... from user@domain.com"
          const inviterMatch = (subject + ' ' + body).match(
            /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\s+is inviting you/i
          ) || (subject + ' ' + body).match(
            /from\s+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i
          );
          if (inviterMatch) inviterEmail = inviterMatch[1];
        }

        // Only join meetings from trusted senders
        const inviterDomain = inviterEmail.includes('@') ? inviterEmail.split('@')[1] : null;
        const trustedSender = getTrustedSenderByEmail(tenantId, inviterEmail)
          || (inviterDomain && getTrustedSenderByDomain(tenantId, inviterDomain));
        if (!trustedSender) {
          console.log(`[CalendarPoll] [${agentEmail}] Skipping email invite from untrusted sender: ${inviterEmail} (from: ${fromEmail})`);
          continue;
        }

        meetings.push({
          eventKey: gmailKey,
          eventId: `gmail_${msg.id}`,
          summary: subject,
          start: headers.find(h => h.name.toLowerCase() === 'date')?.value || '',
          link,
          attendees: [inviterEmail].filter(Boolean),
        });

        console.log(`[CalendarPoll] ${agentEmail}: Meeting invite in email: ${subject} - ${link} (inviter: ${inviterEmail})`);
      }
    } catch (err) {
      const isAuthError = err.code === 401 || err.message?.includes('invalid_grant') ||
        err.message?.includes('Invalid Credentials') || err.message?.includes('unauthorized_client') ||
        err.message?.includes('Token has been expired or revoked');
      if (isAuthError) throw err; // Propagate to poll() for fallback client retry
      console.warn(`[CalendarPoll] ${agentEmail}: Gmail check error: ${err.message}`);
    }
  }

  return meetings;
}

// ─── Meeting Join + Monitor ──────────────────────────────────────────────────

/**
 * Derive a display name for the bot from the tenant/agent email.
 * e.g. agent@sangha.coppice.ai → "Sangha Agent"
 */
function deriveBotName(tenantId, agentEmail) {
  // Try to get a clean name from the subdomain
  const domainMatch = agentEmail.match(/@([^.]+)\.coppice\.ai/);
  if (domainMatch) {
    const sub = domainMatch[1];
    return sub.charAt(0).toUpperCase() + sub.slice(1) + ' Agent';
  }
  // Fallback
  return 'Coppice Agent';
}

/**
 * Join a meeting via Recall.ai.
 */
async function joinMeeting(meeting, tenantId, agentEmail) {
  const { eventKey, summary, link, attendees } = meeting;

  console.log(`[CalendarPoll] ════════════════════════════════════════`);
  console.log(`[CalendarPoll] JOINING: ${summary}`);
  console.log(`[CalendarPoll] Tenant: ${tenantId} | Agent: ${agentEmail}`);
  console.log(`[CalendarPoll] Link: ${link}`);
  console.log(`[CalendarPoll] ════════════════════════════════════════`);

  joinedEvents.add(eventKey);

  try {
    const botName = deriveBotName(tenantId, agentEmail);

    // Use output_media voice bot (OpenAI Realtime API via voice-agent.html page).
    // This handles real-time voice conversation with wake-word gating.
    // Falls back to standard bot if voice bot creation fails.
    let bot;
    let isVoiceBot = false;
    try {
      bot = await createVoiceBot(link, { botName, tenantId });
      isVoiceBot = true;
      console.log(`[CalendarPoll] Voice bot ${bot.id} created (output_media + OpenAI Realtime)`);
    } catch (e) {
      console.warn(`[CalendarPoll] Voice bot failed, falling back to standard bot: ${e.message}`);
      bot = await createBot(link, { botName, tenantId, enableVoice: true });
    }

    activeBots.set(eventKey, {
      botId: bot.id,
      tenantId,
      meetingName: summary,
      link,
      attendees,
      agentEmail,
      isVoiceBot,
      startTime: new Date().toISOString(),
    });

    // For standard bots: start webhook-based voice loop (ElevenLabs TTS + Recall output_audio).
    // For voice bots: voice-agent.html handles voice via OpenAI Realtime, so skip the voice loop.
    // Chat loop still runs for both (text chat responses in meeting sidebar).
    if (!isVoiceBot) {
      startVoiceLoop(bot.id, tenantId);
    }
    startChatLoop(bot.id);

    // Log activity to tenant's feed
    runWithTenant(tenantId, () => {
      insertActivity({
        tenantId,
        type: 'meet',
        title: `Joined: ${summary}`,
        subtitle: `${attendees.length} attendees - say "Coppice" to activate`,
        sourceType: 'meeting',
        sourceId: eventKey,
        agentId: 'meetings',
      });
    });

    // Start monitoring bot status in background
    monitorBot(eventKey);

    return bot.id;
  } catch (err) {
    console.error(`[CalendarPoll] Join failed for "${summary}":`, err.message);
    joinedEvents.delete(eventKey);
    return null;
  }
}

/**
 * Monitor a bot until the meeting ends, then trigger post-processing.
 * Uses setTimeout chain instead of blocking loop (non-blocking).
 */
function monitorBot(eventKey) {
  const info = activeBots.get(eventKey);
  if (!info) return;

  const { botId } = info;
  const maxMs = MAX_MEETING_HOURS * 3600000;
  const startMs = Date.now();

  const check = async () => {
    // Guard: bot may have been cleaned up externally
    if (!activeBots.has(eventKey)) return;

    // Max duration safety
    if (Date.now() - startMs > maxMs) {
      console.log(`[CalendarPoll] Bot ${botId} hit max duration (${MAX_MEETING_HOURS}h) - processing`);
      await handleMeetingEnd(eventKey);
      return;
    }

    try {
      const status = await getBotStatus(botId);
      const statusCode = status?.status_changes?.slice(-1)?.[0]?.code || 'unknown';

      if (['done', 'fatal', 'analysis_done', 'media_expired'].includes(statusCode)) {
        console.log(`[CalendarPoll] Bot ${botId} finished: ${statusCode}`);
        await handleMeetingEnd(eventKey);
        return;
      }
    } catch {
      // Transient API error - keep polling
    }

    // Schedule next check
    setTimeout(check, BOT_CHECK_SEC * 1000);
  };

  // First check after a delay
  setTimeout(check, BOT_CHECK_SEC * 1000);
}

// ─── Post-Meeting Processing ─────────────────────────────────────────────────

/**
 * Handle meeting end:
 * 1. Retrieve transcript from Recall (remote + local)
 * 2. Summarize with Claude
 * 3. Insert into tenant's knowledge_entries
 * 4. Run per-person task extraction + emails via meetingProcessor
 */
async function handleMeetingEnd(eventKey) {
  const info = activeBots.get(eventKey);
  if (!info) return;

  const { botId, tenantId, meetingName, attendees, agentEmail } = info;
  console.log(`[CalendarPoll] Processing meeting end: "${meetingName}" (${tenantId})`);

  try {
    // ── Get transcript ──
    let segments = [];

    // Try Recall API first
    try {
      const result = await getTranscript(botId);
      if (Array.isArray(result)) segments = result;
    } catch {
      // May not be available yet
    }

    // Merge with local transcript if richer
    const localBot = getLocalBot(botId);
    if (localBot?.transcript?.length > segments.length) {
      segments = localBot.transcript;
    }

    const transcript = segments
      .map(s => {
        const speaker = s.speaker || 'Unknown';
        const text = (s.text || '').trim();
        const ts = s.timestamp || '';
        if (!text) return '';
        if (ts) {
          try {
            const dt = new Date(ts.replace('Z', '+00:00'));
            return `[${dt.toTimeString().slice(0, 8)}] ${speaker}: ${text}`;
          } catch {
            return `${speaker}: ${text}`;
          }
        }
        return `${speaker}: ${text}`;
      })
      .filter(Boolean)
      .join('\n');

    if (!transcript.trim()) {
      console.log(`[CalendarPoll] Empty transcript for "${meetingName}"`);
      runWithTenant(tenantId, () => {
        insertActivity({
          tenantId,
          type: 'meet',
          title: `Meeting ended: ${meetingName}`,
          subtitle: 'No transcript captured',
          sourceType: 'meeting',
          sourceId: eventKey,
          agentId: 'meetings',
        });
      });
      return;
    }

    // ── Summarize with Claude ──
    console.log(`[CalendarPoll] Summarizing "${meetingName}" with Claude...`);
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const summaryRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Summarize this meeting transcript into structured notes.

Meeting: ${meetingName}
Attendees: ${attendees.join(', ')}

Format:
## Summary
(2-3 sentences)

## Key Points
- (bulleted)

## Action Items
- [ ] (with owner if identifiable)

## Decisions Made
- (any decisions)

---
Transcript:
${transcript}`,
      }],
    });

    const summary = summaryRes.content[0].text;

    // ── Per-tenant post-processing ──
    await runWithTenant(tenantId, async () => {
      const entryId = `KN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const tdb = getTenantDb(tenantId);

      // Insert into knowledge base
      tdb.prepare(`
        INSERT INTO knowledge_entries (id, tenant_id, type, title, transcript, content, source, source_agent, recorded_at, processed)
        VALUES (?, ?, 'meeting', ?, ?, ?, 'calendar-poll', 'meetings', ?, 1)
      `).run(
        entryId, tenantId, meetingName, transcript, summary,
        new Date().toISOString(),
      );

      // Extract per-person tasks + send follow-up emails
      try {
        const result = await processMeetingComplete({
          tenantId,
          entryId,
          meetingTitle: meetingName,
          transcript,
          summary,
          attendees,
        });
        console.log(`[CalendarPoll] Post-processing done: ${result.actionItemsInserted || 0} items, ${result.instructionsExecuted || 0} instructions`);
      } catch (err) {
        console.error(`[CalendarPoll] processMeetingComplete failed:`, err.message);
      }
    });

    console.log(`[CalendarPoll] ✓ Meeting processed: "${meetingName}" (${tenantId})`);

  } catch (err) {
    console.error(`[CalendarPoll] Post-meeting error for "${meetingName}":`, err.message);
  } finally {
    activeBots.delete(eventKey);
    stopChatLoop(botId);
    stopVoiceLoop(botId);
  }
}

// ─── Auto-Accept Calendar Invites ────────────────────────────────────────────

/**
 * Auto-accept pending calendar invites from owners/trusted senders.
 * Checks for events where agent's responseStatus is 'needsAction' and
 * the organizer is a trusted sender for that tenant.
 */
async function autoAcceptInvites({ tenantId, calendarClient, agentEmail, refreshToken }) {
  if (!calendarClient) return;

  try {
    const now = new Date();
    // Look ahead 30 days for pending invites
    const windowEnd = new Date(now.getTime() + 30 * 24 * 3600000);

    const res = await calendarClient.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    for (const event of (res.data.items || [])) {
      const selfAttendee = (event.attendees || []).find(
        a => a.self || a.email?.toLowerCase() === agentEmail.toLowerCase()
      );
      if (!selfAttendee || selfAttendee.responseStatus !== 'needsAction') continue;

      // Check if organizer is an owner or trusted sender
      const organizerEmail = event.organizer?.email;
      if (!organizerEmail) continue;

      const trusted = getTrustedSenderByEmail(tenantId, organizerEmail);
      if (!trusted) continue; // Only auto-accept from trusted senders

      // Accept the invite
      const updatedAttendees = (event.attendees || []).map(a => {
        if (a.self || a.email?.toLowerCase() === agentEmail.toLowerCase()) {
          return { ...a, responseStatus: 'accepted' };
        }
        return a;
      });

      // Need calendar.events scope for patching
      const auth = makeOAuth2(refreshToken);
      const calWithWrite = google.calendar({ version: 'v3', auth });

      await calWithWrite.events.patch({
        calendarId: 'primary',
        eventId: event.id,
        requestBody: { attendees: updatedAttendees },
        sendUpdates: 'all',
      });

      console.log(`[CalendarPoll] Auto-accepted invite: "${event.summary}" from ${organizerEmail} (${tenantId})`);

      runWithTenant(tenantId, () => {
        insertActivity({
          tenantId,
          type: 'calendar',
          title: `Accepted: ${event.summary}`,
          subtitle: `Invited by ${organizerEmail}`,
          sourceType: 'calendar',
          sourceId: event.id,
          agentId: 'meetings',
        });
      });
    }
  } catch (err) {
    // calendar.events scope may not be available - silent fail
    if (!err.message?.includes('insufficient')) {
      console.warn(`[CalendarPoll] Auto-accept error for ${agentEmail}: ${err.message}`);
    }
  }
}

// ─── Main Poll Loop ──────────────────────────────────────────────────────────

let pollCount = 0;
async function poll() {
  pollCount++;
  const calendars = getTenantCalendars();
  if (calendars.length === 0) return;
  // Log every 20 cycles (~10 min) as heartbeat
  if (pollCount % 20 === 1) {
    console.log(`[CalendarPoll] Heartbeat: polling ${calendars.length} calendar(s), ${joinedEvents.size} joined, ${activeBots.size} active bots`);
  }

  for (const cal of calendars) {
    try {
      // Auto-accept pending invites from trusted senders
      await autoAcceptInvites(cal);

      const meetings = await pollTenantCalendar(cal);
      if (meetings.length > 0) {
        console.log(`[CalendarPoll] [${cal.agentEmail}] Found ${meetings.length} meeting(s) in window`);
      }
      for (const meeting of meetings) {
        await joinMeeting(meeting, cal.tenantId, cal.agentEmail);
      }
    } catch (err) {
      const isAuthError = err.code === 401 || err.message?.includes('invalid_grant') ||
        err.message?.includes('Invalid Credentials') || err.message?.includes('unauthorized_client') ||
        err.message?.includes('Token has been expired or revoked');

      if (isAuthError && cal.refreshToken && getClientPairs().length >= 2) {
        // Try fallback OAuth client (token may have been issued by a different client)
        try {
          console.log(`[CalendarPoll] [${cal.agentEmail}] Primary client failed, trying fallback client...`);
          const fallbackCal = {
            ...cal,
            calendarClient: makeCalendarClientFallback(cal.refreshToken),
            gmailClient: makeGmailClientFallback(cal.refreshToken),
          };
          await autoAcceptInvites(fallbackCal);
          const meetings = await pollTenantCalendar(fallbackCal);
          if (meetings.length > 0) {
            console.log(`[CalendarPoll] [${cal.agentEmail}] (fallback) Found ${meetings.length} meeting(s) in window`);
          }
          for (const meeting of meetings) {
            await joinMeeting(meeting, cal.tenantId, cal.agentEmail);
          }
          // Fallback worked - remember for future poll cycles
          if (cal.label) useFallbackClient.add(cal.label);
          console.log(`[CalendarPoll] [${cal.agentEmail}] Fallback client succeeded, will use it going forward`);
        } catch (err2) {
          console.error(`[CalendarPoll] [${cal.agentEmail}] Both OAuth clients failed: ${err2.message}`);
        }
      } else {
        console.error(`[CalendarPoll] Error polling ${cal.agentEmail}:`, err.message);
      }
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * On startup, check Recall.ai for bots already in calls.
 * Pre-populate joinedEvents so we don't create duplicates after PM2 restart.
 */
async function recoverActiveBots() {
  const RECALL_API_KEY = process.env.RECALL_API_KEY;
  const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
  if (!RECALL_API_KEY) return;

  try {
    const res = await fetch(
      `https://${RECALL_REGION}.recall.ai/api/v1/bot/?status_code__in=in_call_recording,in_call_not_recording,joining_call,in_waiting_room`,
      { headers: { Authorization: `Token ${RECALL_API_KEY}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const bots = data.results || data;
    if (!Array.isArray(bots) || bots.length === 0) return;

    for (const bot of bots) {
      const meetingUrl = bot.meeting_url?.meeting_id
        ? `recall:${bot.meeting_url.meeting_id}`
        : bot.meeting_url?.business_meeting_id || bot.id;
      // Use bot ID as event key since we can't recover the original eventKey
      const eventKey = `recovered:${bot.id}`;
      joinedEvents.add(eventKey);
      activeBots.set(eventKey, {
        botId: bot.id,
        tenantId: 'unknown',
        meetingName: bot.bot_name || 'Recovered',
        link: meetingUrl,
        attendees: [],
        startTime: bot.join_at || new Date().toISOString(),
      });
    }
    console.log(`[CalendarPoll] Recovered ${bots.length} active bot(s) from Recall.ai - will not duplicate`);
  } catch (e) {
    console.warn(`[CalendarPoll] Bot recovery failed (non-fatal): ${e.message}`);
  }
}

export function startCalendarPollScheduler(intervalSec = POLL_INTERVAL_SEC) {
  if (pollTimer) {
    console.log('[CalendarPoll] Scheduler already running');
    return;
  }

  console.log(`[CalendarPoll] Starting scheduler (interval: ${intervalSec}s)`);

  // Recover active bots before first poll to prevent duplicates after restart
  recoverActiveBots().catch(e => console.warn('[CalendarPoll] Recovery error:', e.message));

  // Initial poll after short startup delay (gives recovery time to complete)
  setTimeout(() => {
    poll().catch(err => console.error('[CalendarPoll] Initial poll failed:', err.message));
  }, 10000);

  pollTimer = setInterval(() => {
    poll().catch(err => console.error('[CalendarPoll] Poll failed:', err.message));
  }, intervalSec * 1000);
}

export function stopCalendarPollScheduler() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[CalendarPoll] Scheduler stopped');
  }
}

export function getCalendarPollStatus() {
  return {
    running: pollTimer !== null,
    joinedCount: joinedEvents.size,
    activeBots: Array.from(activeBots.entries()).map(([key, info]) => ({
      eventKey: key,
      botId: info.botId,
      tenantId: info.tenantId,
      meetingName: info.meetingName,
      agentEmail: info.agentEmail,
      startTime: info.startTime,
    })),
  };
}
