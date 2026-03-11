/**
 * Gmail Inbox Polling Job
 *
 * Polls for unread emails, matches senders to known contacts,
 * and creates activity_log entries for inbound replies.
 */

import { google } from 'googleapis';
import { insertActivity } from '../cache/database.js';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = new Database(join(__dirname, '../../data/cache.db'));

let pollInterval = null;
let lastPoll = null;
let repliesFound = 0;
let processedIds = new Set();

function getOAuth2Client() {
  const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
  const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) return null;

  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost:8099');
  client.setCredentials({ refresh_token: REFRESH_TOKEN });
  return client;
}

function matchContactToTenant(email) {
  const row = db.prepare(`
    SELECT c.name, c.title, l.venue_name as company, l.tenant_id
    FROM le_contacts c
    JOIN le_leads l ON c.lead_id = l.id AND c.tenant_id = l.tenant_id
    WHERE LOWER(c.email) = LOWER(?)
    LIMIT 1
  `).get(email);
  return row || null;
}

function extractEmailBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      const nested = extractEmailBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

async function pollInbox() {
  const auth = getOAuth2Client();
  if (!auth) return;

  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread newer_than:1h -from:me',
      maxResults: 10,
    });

    const messages = listRes.data.messages || [];
    let newReplies = 0;

    for (const msg of messages) {
      if (processedIds.has(msg.id)) continue;

      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const headers = full.data.payload?.headers || [];
      const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
      const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
      const emailMatch = from.match(/<([^>]+)>/) || [null, from];
      const senderEmail = emailMatch[1];
      const senderName = from.replace(/<[^>]+>/, '').trim().replace(/^"(.*)"$/, '$1');

      const body = extractEmailBody(full.data.payload);
      const contact = matchContactToTenant(senderEmail);
      const tenantId = contact?.tenant_id || 'default';
      const displayName = contact?.name || senderName || senderEmail;
      const company = contact?.company || '';

      insertActivity({
        tenantId,
        type: 'in',
        title: company ? `Reply from ${displayName} at ${company}` : `Reply from ${displayName}`,
        subtitle: subject,
        detailJson: JSON.stringify({
          from: senderEmail,
          fromName: displayName,
          subject,
          body: body.slice(0, 5000),
          threadId: full.data.threadId,
          messageId: msg.id,
        }),
        sourceType: 'email',
        sourceId: msg.id,
        agentId: 'coppice',
      });

      // Mark as read
      await gmail.users.messages.modify({
        userId: 'me',
        id: msg.id,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });

      processedIds.add(msg.id);
      newReplies++;
    }

    repliesFound += newReplies;
    lastPoll = new Date().toISOString();

    // Trim processedIds to prevent memory growth
    if (processedIds.size > 500) {
      const arr = [...processedIds];
      processedIds = new Set(arr.slice(-200));
    }

    if (newReplies > 0) {
      console.log(`[GmailPoll] ${newReplies} new replies detected`);
    }
  } catch (err) {
    console.error('[GmailPoll] Poll error:', err.message);
  }
}

export function startGmailPollScheduler(intervalMinutes = 2) {
  if (pollInterval) {
    console.log('[GmailPoll] Scheduler already running');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`[GmailPoll] Starting scheduler (interval: ${intervalMinutes} min)`);

  // Run after a short delay on startup
  setTimeout(() => {
    pollInbox().catch(err => console.error('[GmailPoll] Initial poll failed:', err.message));
  }, 5000);

  pollInterval = setInterval(() => {
    pollInbox().catch(err => console.error('[GmailPoll] Scheduled poll failed:', err.message));
  }, intervalMs);
}

export function stopGmailPollScheduler() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[GmailPoll] Scheduler stopped');
  }
}

export function getGmailPollStatus() {
  return {
    running: pollInterval !== null,
    lastPoll,
    repliesFound,
  };
}
