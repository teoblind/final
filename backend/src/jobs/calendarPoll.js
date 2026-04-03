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
import { queryClaudeAgent } from '../services/claudeAgent.js';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const __filename_cp = fileURLToPath(import.meta.url);
const __dirname_cp = dirname(__filename_cp);
const AUDIO_DIR = join(__dirname_cp, '../../data/audio/meetings/');
if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });
import {
  getAllTenants,
  getAllTenantDbs,
  getTenantDb,
  insertActivity,
  runWithTenant,
  getTrustedSenderByEmail,
  getTrustedSenderByDomain,
  getSystemDb,
} from '../cache/database.js';
import {
  createBot,
  createVoiceBot,
  getBotStatus,
  getTranscript,
  getLocalBot,
  getRecording,
  updateLocalBot,
} from '../services/recallService.js';
import { startChatLoop, stopChatLoop } from '../services/meetingChatLoop.js';
import { startVoiceLoop, stopVoiceLoop } from '../services/meetingVoiceLoop.js';
import { processMeetingComplete } from '../services/meetingProcessor.js';
import { sendMeetingRecapEmail } from '../routes/recall.js';
import { extractMeetingCode, openForBotEntry, restoreAccess } from '../services/googleMeetService.js';

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

// Track active meeting codes (e.g. "abc-defg-hjk") to prevent duplicate bots
// across detection methods (Calendar API + Gmail fallback + recovery)
const activeMeetingCodes = new Set();

let pollTimer = null;

// ─── SQLite Persistence for Bot Dedup ────────────────────────────────────────
// Persists active bot tracking to the system DB so PM2 restarts don't cause
// duplicate bot dispatches. In-memory maps remain the fast-path check;
// the DB is the persistence/recovery layer.

function initBotTrackingTable() {
  const sdb = getSystemDb();
  sdb.exec(`
    CREATE TABLE IF NOT EXISTS active_meeting_bots (
      event_key TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      meeting_code TEXT,
      meeting_name TEXT,
      link TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);
  // Index for meeting code lookups
  sdb.exec(`
    CREATE INDEX IF NOT EXISTS idx_amb_meeting_code
    ON active_meeting_bots(meeting_code) WHERE meeting_code IS NOT NULL
  `);
  // Index for status queries
  sdb.exec(`
    CREATE INDEX IF NOT EXISTS idx_amb_status
    ON active_meeting_bots(status)
  `);
}

/** Rehydrate in-memory maps from DB on startup */
function rehydrateFromDb() {
  try {
    const sdb = getSystemDb();
    const rows = sdb.prepare(
      `SELECT event_key, bot_id, tenant_id, meeting_code, meeting_name, link, created_at
       FROM active_meeting_bots WHERE status = 'active'`
    ).all();

    for (const row of rows) {
      // Skip entries older than 24h (stale from previous crashes)
      const age = Date.now() - new Date(row.created_at + 'Z').getTime();
      if (age > 24 * 3600000) {
        sdb.prepare(`UPDATE active_meeting_bots SET status = 'expired' WHERE event_key = ?`).run(row.event_key);
        continue;
      }

      joinedEvents.add(row.event_key);
      if (row.meeting_code) activeMeetingCodes.add(row.meeting_code);
      // Only populate activeBots with the fields we can recover -
      // monitorBot won't restart (that happens via recoverActiveBots + Recall API),
      // but dedup checks will work
      activeBots.set(row.event_key, {
        botId: row.bot_id,
        tenantId: row.tenant_id,
        meetingName: row.meeting_name || 'Recovered',
        link: row.link || '',
        meetingCode: row.meeting_code,
        attendees: [],
        startTime: row.created_at,
      });
    }

    if (rows.length > 0) {
      console.log(`[CalendarPoll] Rehydrated ${activeBots.size} active bot(s) from system DB`);
    }
  } catch (err) {
    console.warn(`[CalendarPoll] DB rehydration failed (non-fatal): ${err.message}`);
  }
}

/** Persist a new active bot to DB */
function persistBotToDb(eventKey, botId, tenantId, meetingCode, meetingName, link) {
  try {
    const sdb = getSystemDb();
    sdb.prepare(
      `INSERT OR REPLACE INTO active_meeting_bots (event_key, bot_id, tenant_id, meeting_code, meeting_name, link, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'active')`
    ).run(eventKey, botId, tenantId, meetingCode || null, meetingName || null, link || null);
  } catch (err) {
    console.warn(`[CalendarPoll] Failed to persist bot to DB: ${err.message}`);
  }
}

/** Mark a bot as ended in DB */
function markBotEndedInDb(eventKey) {
  try {
    const sdb = getSystemDb();
    sdb.prepare(`UPDATE active_meeting_bots SET status = 'ended' WHERE event_key = ?`).run(eventKey);
  } catch (err) {
    console.warn(`[CalendarPoll] Failed to mark bot ended in DB: ${err.message}`);
  }
}

/** Check if a meeting code already has an active bot in DB */
function isMeetingCodeActiveInDb(meetCode) {
  try {
    const sdb = getSystemDb();
    const row = sdb.prepare(
      `SELECT 1 FROM active_meeting_bots
       WHERE meeting_code = ? AND status = 'active'
       AND created_at > datetime('now', '-24 hours')
       LIMIT 1`
    ).get(meetCode);
    return !!row;
  } catch (err) {
    console.warn(`[CalendarPoll] DB meeting code check failed: ${err.message}`);
    return false;
  }
}

/** Clean up old DB entries (older than 24h) */
function cleanupOldBotEntries() {
  try {
    const sdb = getSystemDb();
    const result = sdb.prepare(
      `DELETE FROM active_meeting_bots WHERE created_at < datetime('now', '-24 hours')`
    ).run();
    if (result.changes > 0) {
      console.log(`[CalendarPoll] Cleaned up ${result.changes} old bot tracking entries`);
    }
  } catch (err) {
    console.warn(`[CalendarPoll] DB cleanup failed: ${err.message}`);
  }
}

// Initialize table and rehydrate on module load
try {
  initBotTrackingTable();
  rehydrateFromDb();
} catch (err) {
  console.warn(`[CalendarPoll] Bot tracking DB init failed (non-fatal): ${err.message}`);
}

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

        // Check if any existing bot is already in this meeting (by normalized meeting code)
        // Check both in-memory (fast path) and DB (survives PM2 restarts)
        const meetCode = extractMeetingCode(link);
        if (meetCode && (activeMeetingCodes.has(meetCode) || isMeetingCodeActiveInDb(meetCode))) {
          joinedEvents.add(eventKey);
          continue;
        }
        // Fallback: also check by raw URL comparison
        const alreadyInMeeting = [...activeBots.values()].some(b =>
          b.link && b.link.split('?')[0] === link.split('?')[0]
        );
        if (alreadyInMeeting) {
          joinedEvents.add(eventKey);
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
        // Check both in-memory (fast path) and DB (survives PM2 restarts)
        const gmailMeetCode = extractMeetingCode(link);
        if (gmailMeetCode && (activeMeetingCodes.has(gmailMeetCode) || isMeetingCodeActiveInDb(gmailMeetCode))) continue;
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
async function joinMeeting(meeting, tenantId, agentEmail, refreshToken) {
  const { eventKey, summary, link, attendees } = meeting;

  // Prevent duplicate joins by meeting code
  // Check both in-memory (fast path) and DB (survives PM2 restarts)
  const meetCode = extractMeetingCode(link);
  if (meetCode && (activeMeetingCodes.has(meetCode) || isMeetingCodeActiveInDb(meetCode))) {
    console.log(`[CalendarPoll] Skipping "${summary}" - already have bot in ${meetCode}`);
    joinedEvents.add(eventKey);
    return null;
  }

  console.log(`[CalendarPoll] ════════════════════════════════════════`);
  console.log(`[CalendarPoll] JOINING: ${summary}`);
  console.log(`[CalendarPoll] Tenant: ${tenantId} | Agent: ${agentEmail}`);
  console.log(`[CalendarPoll] Link: ${link}`);
  console.log(`[CalendarPoll] ════════════════════════════════════════`);

  joinedEvents.add(eventKey);
  if (meetCode) activeMeetingCodes.add(meetCode);

  try {
    // Open meeting access for bot entry (Google Meet REST API)
    // This temporarily sets the meeting to OPEN so the Recall.ai bot
    // can join without waiting room admission, then restores to TRUSTED
    // once the bot is in the call.
    if (meetCode && refreshToken) {
      const opened = await openForBotEntry(refreshToken, link);
      if (opened) {
        console.log(`[CalendarPoll] Opened meeting ${meetCode} for bot entry`);
      }
    }

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
      meetingCode: meetCode,
      attendees,
      agentEmail,
      refreshToken,
      isVoiceBot,
      startTime: new Date().toISOString(),
    });

    // Persist to DB so PM2 restarts don't lose dedup state
    persistBotToDb(eventKey, bot.id, tenantId, meetCode, summary, link);

    // Mark as calendar-managed (calendarPoll handles its own emails via processMeetingComplete)
    // Also store inviter email as fallback
    const inviterEmail = attendees.find(e => !e.match(/^agent@.*\.coppice\.ai$/)) || attendees[0];
    updateLocalBot(bot.id, { inviterEmail, _calendarManaged: true });

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
    if (meetCode) activeMeetingCodes.delete(meetCode);
    markBotEndedInDb(eventKey);
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
  let accessRestored = false;

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

      // Restore meeting access to TRUSTED once bot is in the call
      if (!accessRestored && (statusCode === 'in_call_recording' || statusCode === 'in_call_not_recording')) {
        const botInfo = activeBots.get(eventKey);
        if (botInfo?.refreshToken && botInfo?.meetingCode) {
          restoreAccess(botInfo.refreshToken, botInfo.link).catch(() => {});
          accessRestored = true;
        }
      }

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

  const { botId, tenantId, meetingName, attendees, agentEmail, meetingCode } = info;
  console.log(`[CalendarPoll] Processing meeting end: "${meetingName}" (${tenantId})`);

  // Clean up meeting code tracking (in-memory + DB)
  if (meetingCode) activeMeetingCodes.delete(meetingCode);
  markBotEndedInDb(eventKey);

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

    // Build diarized transcript JSON for Fireflies-like viewer
    // Recall.ai segments have: { speaker, text, timestamp, start_time, end_time }
    const meetingStartTime = segments[0]?.timestamp ? new Date(segments[0].timestamp).getTime() / 1000 : 0;
    const transcriptSegments = segments
      .filter(s => (s.text || '').trim())
      .map(s => {
        const speaker = s.speaker || 'Unknown';
        const text = (s.text || '').trim();
        // Calculate start/end in seconds from meeting start
        let start = 0, end = 0;
        if (s.start_time != null) {
          start = Number(s.start_time);
          end = s.end_time != null ? Number(s.end_time) : start + 5;
        } else if (s.timestamp) {
          start = Math.max(0, new Date(s.timestamp).getTime() / 1000 - meetingStartTime);
          end = start + 5;
        }
        return { speaker, text, start, end };
      });
    const transcriptJson = JSON.stringify(transcriptSegments);

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

    // ── Summarize with Claude (via BBB tunnel / local CLI) ──
    console.log(`[CalendarPoll] Summarizing "${meetingName}" with Claude...`);

    const summaryPrompt = `You are a professional meeting analyst. Produce comprehensive, Fireflies-quality meeting notes from this transcript. Be thorough - capture every substantive point, specific data, numbers, names, and strategic context. Do NOT summarize loosely; extract precise details.

Meeting: ${meetingName}
Attendees: ${attendees.join(', ')}

Produce the following sections:

## Overview
2-3 sentence executive summary of the meeting's purpose and outcome.

## Key Topics
For EACH major topic discussed, create a subsection:
### [Topic Name]
- Detailed bullet points capturing specific facts, numbers, percentages, dollar amounts, and quotes
- Note who said what when relevant
- Include context and reasoning behind statements, not just conclusions
- Capture any data points, metrics, or benchmarks mentioned

## Action Items
For EACH person who was assigned or volunteered for a task:
### [Person Name]
- [ ] Specific task description with enough detail to act on it
- [ ] Include any deadlines, dependencies, or conditions mentioned

## Decisions Made
- Specific decisions with rationale and any conditions/caveats

## Strategic Context
- Key strategic insights, market observations, or competitive intelligence discussed
- Any risks, concerns, or open questions raised

## Next Steps
- What happens next, when the next meeting is, what needs to happen before then

IMPORTANT: Be as detailed as Fireflies.ai notes. Every substantive statement should be captured. Include specific numbers, percentages, dollar figures, company names, and technical terms exactly as stated. Do not generalize or paraphrase when precision is available.

---
Transcript:
${transcript}`;

    // Retry up to 5 times with backoff if rate-limited
    let summary = 'Meeting summary unavailable.';
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const summaryRes = await queryClaudeAgent({
          tenantId,
          agentId: 'meetings',
          message: summaryPrompt,
          maxTurns: 1,
          timeoutMs: 180000,
        });
        const text = summaryRes?.response || summaryRes?.text || '';
        if (text && !text.includes("hit your limit") && !text.includes("rate limit") && text.length > 200) {
          summary = text;
          break;
        }
        console.log(`[CalendarPoll] Summarization attempt ${attempt}/5 returned rate limit or empty - waiting before retry...`);
        await new Promise(r => setTimeout(r, attempt * 60000)); // 1min, 2min, 3min, 4min, 5min
      } catch (e) {
        console.warn(`[CalendarPoll] Summarization attempt ${attempt}/5 failed: ${e.message}`);
        if (attempt < 5) await new Promise(r => setTimeout(r, attempt * 60000));
      }
    }

    // ── Retrieve + download audio recording from Recall.ai ──
    // Download to local storage so URLs don't expire (Recall.ai uses signed S3 links)
    let localAudioPath = null; // will be set to "/api/v1/knowledge/audio/{entryId}" after download
    try {
      const recording = await getRecording(botId);
      const downloadUrl = recording?.audioUrl || recording?.videoUrl;
      if (downloadUrl) {
        // Use a temp ID for the filename - will be renamed per-tenant later
        const tempAudioId = `recall-${botId}`;
        const tempPath = join(AUDIO_DIR, `${tempAudioId}.mp3`);
        const resp = await fetch(downloadUrl);
        if (resp.ok) {
          await pipeline(Readable.fromWeb(resp.body), createWriteStream(tempPath));
          localAudioPath = tempPath;
          console.log(`[CalendarPoll] Audio downloaded for "${meetingName}" (${(resp.headers.get('content-length') || '?')} bytes)`);
        } else {
          console.warn(`[CalendarPoll] Audio download failed: HTTP ${resp.status}`);
        }
      } else {
        console.log(`[CalendarPoll] No recording available for "${meetingName}"`);
      }
    } catch (err) {
      console.warn(`[CalendarPoll] Recording retrieval failed for "${meetingName}": ${err.message}`);
    }

    // ── Distribute to all tenants where attendees have accounts ──
    const targetTenants = new Set([tenantId]); // always include the inviting tenant
    try {
      const allDbs = getAllTenantDbs();
      for (const [tid, tdb] of Object.entries(allDbs)) {
        for (const email of attendees) {
          try {
            const user = tdb.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND tenant_id = ? AND status = ?').get(email, tid, 'active');
            if (user) targetTenants.add(tid);
          } catch { /* table may not exist */ }
        }
      }
    } catch (err) {
      console.warn(`[CalendarPoll] Cross-tenant lookup failed, using inviting tenant only: ${err.message}`);
    }

    console.log(`[CalendarPoll] Distributing "${meetingName}" to ${targetTenants.size} tenant(s): ${[...targetTenants].join(', ')}`);

    const recordedAt = new Date().toISOString();
    const coppiceActions = []; // Collect agent-executed instructions for recap email
    let primaryEntryId = null; // Track the inviting tenant's entry ID for recap email

    for (const tid of targetTenants) {
      await runWithTenant(tid, async () => {
        const entryId = `KN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        if (tid === tenantId) primaryEntryId = entryId;
        const tdb = getTenantDb(tid);

        // Copy audio file to entry-specific path (so each entry has its own serving URL)
        let audioUrlForEntry = null;
        if (localAudioPath && existsSync(localAudioPath)) {
          try {
            const { copyFileSync } = await import('fs');
            const destPath = join(AUDIO_DIR, `${entryId}.mp3`);
            copyFileSync(localAudioPath, destPath);
            audioUrlForEntry = `/api/v1/knowledge/audio/${entryId}`;
          } catch (e) {
            console.warn(`[CalendarPoll] Audio copy failed for ${entryId}: ${e.message}`);
          }
        }

        // Insert into knowledge base with audio + diarized transcript
        tdb.prepare(`
          INSERT INTO knowledge_entries (id, tenant_id, type, title, transcript, content, source, source_agent, recorded_at, processed, audio_url, transcript_json)
          VALUES (?, ?, 'meeting', ?, ?, ?, 'calendar-poll', 'meetings', ?, 1, ?, ?)
        `).run(entryId, tid, meetingName, transcript, summary, recordedAt, audioUrlForEntry, transcriptJson);

        // Also add to tenant_files so it shows in Files > Meeting Notes
        try {
          tdb.prepare(`
            INSERT OR IGNORE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at)
            VALUES (?, ?, ?, 'Meeting Notes', 'meeting_transcript', ?, ?)
          `).run(entryId, tid, meetingName, (transcript || '').length, recordedAt);
        } catch { /* tenant_files may not exist */ }

        // Extract action items for ALL tenants; emails + agent instructions only for inviting tenant
        try {
          const result = await processMeetingComplete({
            tenantId: tid,
            entryId,
            meetingTitle: meetingName,
            transcript,
            summary,
            attendees,
            actionItemsOnly: tid !== tenantId,
          });
          console.log(`[CalendarPoll] Post-processing done for ${tid}: ${result.actionItemsInserted || 0} items, ${result.instructionsExecuted || 0} instructions`);

          // Collect coppice actions from the inviting tenant for the recap email
          if (tid === tenantId && result.executedInstructions?.length > 0) {
            coppiceActions.push(...result.executedInstructions);
          }
        } catch (err) {
          console.error(`[CalendarPoll] processMeetingComplete failed for ${tid}:`, err.message);
        }
      });
    }

    // Clean up temp audio file (copies were made per-entry)
    if (localAudioPath && existsSync(localAudioPath)) {
      try { const { unlinkSync } = await import('fs'); unlinkSync(localAudioPath); } catch {}
    }

    // Send branded recap email to the person who invited the bot
    const inviterEmail = attendees.find(e => !e.match(/^agent@.*\.coppice\.ai$/)) || attendees[0];
    if (inviterEmail) {
      try {
        // Build transcript array format expected by sendMeetingRecapEmail
        const transcriptArr = segments.map(s => ({
          speaker: s.speaker || 'Unknown',
          text: (s.text || '').trim(),
        })).filter(s => s.text);

        const meetingDuration = segments.length > 1
          ? Math.round(((segments[segments.length - 1]?.end_time || segments[segments.length - 1]?.start_time || 0)
            - (segments[0]?.start_time || 0)))
          : 0;

        await sendMeetingRecapEmail({
          botId,
          entryId: primaryEntryId,
          tenantId,
          meetingTitle: meetingName,
          transcript: transcriptArr,
          durationSeconds: meetingDuration,
          inviterEmail,
          participants: attendees.filter(e => !e.match(/^agent@.*\.coppice\.ai$/)),
          coppiceActions,
        });
      } catch (emailErr) {
        console.error(`[CalendarPoll] Recap email failed:`, emailErr.message);
      }
    }

    console.log(`[CalendarPoll] Meeting processed: "${meetingName}" -> ${[...targetTenants].join(', ')}`);

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

      const orgDomain = organizerEmail.split('@')[1];
      const trusted = getTrustedSenderByEmail(tenantId, organizerEmail)
        || (orgDomain && getTrustedSenderByDomain(tenantId, orgDomain));
      if (!trusted) continue; // Only auto-accept from trusted senders

      // Accept the invite
      const updatedAttendees = (event.attendees || []).map(a => {
        if (a.self || a.email?.toLowerCase() === agentEmail.toLowerCase()) {
          return { ...a, responseStatus: 'accepted' };
        }
        return a;
      });

      // Use the same calendarClient (already has correct OAuth client - primary or fallback)
      await calendarClient.events.patch({
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
    const isAuthError = err.code === 401 || err.message?.includes('invalid_grant') ||
      err.message?.includes('Invalid Credentials') || err.message?.includes('unauthorized_client') ||
      err.message?.includes('Token has been expired or revoked');
    if (isAuthError) throw err; // Propagate to poll() for fallback client retry
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
        await joinMeeting(meeting, cal.tenantId, cal.agentEmail, cal.refreshToken);
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
            await joinMeeting(meeting, cal.tenantId, cal.agentEmail, cal.refreshToken);
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
      const meetingId = bot.meeting_url?.meeting_id;
      const meetingUrl = meetingId
        ? `https://meet.google.com/${meetingId}`
        : bot.meeting_url?.business_meeting_id || bot.id;
      const meetCode = meetingId || null;
      // Use bot ID as event key since we can't recover the original eventKey
      const eventKey = `recovered:${bot.id}`;
      joinedEvents.add(eventKey);
      if (meetCode) activeMeetingCodes.add(meetCode);
      activeBots.set(eventKey, {
        botId: bot.id,
        tenantId: 'unknown',
        meetingName: bot.bot_name || 'Recovered',
        link: meetingUrl,
        meetingCode: meetCode,
        attendees: [],
        startTime: bot.join_at || new Date().toISOString(),
      });
      // Also persist Recall-recovered bots to DB
      persistBotToDb(eventKey, bot.id, 'unknown', meetCode, bot.bot_name || 'Recovered', meetingUrl);
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

  // Clean up old DB entries every hour
  setInterval(() => {
    cleanupOldBotEntries();
  }, 3600000);
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
