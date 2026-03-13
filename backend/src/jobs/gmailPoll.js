/**
 * Gmail Inbox Polling Job
 *
 * Polls for unread emails across all configured tenant inboxes + the default
 * coppice@zhan.capital inbox. Matches senders to known contacts, detects
 * RFQ/bid requests and IPP inquiries, and routes them through pipelines.
 */

import { google } from 'googleapis';
import { insertActivity, getTenantEmailConfig } from '../cache/database.js';
import { isRfqEmail, processRfqEmail } from '../services/estimatePipeline.js';
import { isIppEmail, processIppEmail } from '../services/ippPipeline.js';
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

// Shared OAuth app credentials
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

function makeGmailClient(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET || !refreshToken) return null;
  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
}

/**
 * Build a list of inboxes to poll: default + all tenant email configs.
 */
function getInboxes() {
  const inboxes = [];

  // Default inbox (coppice@zhan.capital from env vars)
  const defaultToken = process.env.GMAIL_REFRESH_TOKEN;
  if (defaultToken) {
    inboxes.push({ tenantId: null, label: 'coppice@zhan.capital', gmail: makeGmailClient(defaultToken) });
  }

  // Tenant inboxes from DB
  try {
    const rows = db.prepare('SELECT * FROM tenant_email_config').all();
    for (const row of rows) {
      const gmail = makeGmailClient(row.gmail_refresh_token);
      if (gmail) {
        inboxes.push({ tenantId: row.tenant_id, label: `${row.sender_email} (${row.tenant_id})`, gmail });
      }
    }
  } catch (e) {
    // Table may not exist yet
  }

  return inboxes;
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

async function extractAttachments(gmail, messageId, payload) {
  const attachments = [];
  const parts = payload?.parts || [];
  for (const part of parts) {
    if (part.body?.attachmentId && part.filename) {
      try {
        const attRes = await gmail.users.messages.attachments.get({
          userId: 'me', messageId, id: part.body.attachmentId,
        });
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          content: Buffer.from(attRes.data.data, 'base64').toString('utf-8'),
        });
      } catch (err) {
        console.warn(`[GmailPoll] Attachment fetch failed (${part.filename}):`, err.message);
      }
    }
  }
  return attachments;
}

async function pollSingleInbox(gmail, tenantId, label) {
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

      // Resolve which tenant this email belongs to
      const effectiveTenant = tenantId || 'default';

      // Check if this is an RFQ/bid request email → route to estimate pipeline
      if (isRfqEmail(subject, body)) {
        try {
          const result = await processRfqEmail({
            messageId: msg.id,
            threadId: full.data.threadId,
            from: senderEmail,
            fromName: senderName,
            subject,
            body,
          });
          if (result) {
            console.log(`[GmailPoll] [${label}] RFQ processed: ${result.bidId} → Estimate $${result.estimate.totalBid.toLocaleString()}`);
          }
        } catch (err) {
          console.error(`[GmailPoll] [${label}] RFQ pipeline error:`, err.message);
        }

        try {
          await gmail.users.messages.modify({
            userId: 'me', id: msg.id,
            requestBody: { removeLabelIds: ['UNREAD'] },
          });
        } catch {}

        processedIds.add(msg.id);
        newReplies++;
        continue;
      }

      // Check if this is an IPP inquiry → route to mine spec pipeline
      if (isIppEmail(subject, body)) {
        try {
          const attachments = await extractAttachments(gmail, msg.id, full.data.payload);
          const result = await processIppEmail({
            messageId: msg.id,
            threadId: full.data.threadId,
            from: senderEmail,
            fromName: senderName,
            subject,
            body,
            attachments,
          });
          if (result) {
            console.log(`[GmailPoll] [${label}] IPP processed: ${result.status} → ${result.filename || 'needs data'}`);
          }
        } catch (err) {
          console.error(`[GmailPoll] [${label}] IPP pipeline error:`, err.message);
        }

        try {
          await gmail.users.messages.modify({
            userId: 'me', id: msg.id,
            requestBody: { removeLabelIds: ['UNREAD'] },
          });
        } catch {}

        processedIds.add(msg.id);
        newReplies++;
        continue;
      }

      // Not an RFQ or IPP — check if it's from a known contact
      const contact = matchContactToTenant(senderEmail);

      if (!contact) {
        processedIds.add(msg.id);
        continue;
      }

      const contactTenant = contact.tenant_id;
      const displayName = contact.name || senderName || senderEmail;
      const company = contact.company || '';

      insertActivity({
        tenantId: contactTenant,
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

      try {
        await gmail.users.messages.modify({
          userId: 'me', id: msg.id,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
      } catch {}

      processedIds.add(msg.id);
      newReplies++;
    }

    return newReplies;
  } catch (err) {
    console.error(`[GmailPoll] [${label}] Poll error:`, err.message);
    return 0;
  }
}

async function pollInbox() {
  const inboxes = getInboxes();
  if (inboxes.length === 0) return;

  let totalNew = 0;
  for (const inbox of inboxes) {
    const count = await pollSingleInbox(inbox.gmail, inbox.tenantId, inbox.label);
    totalNew += count;
  }

  repliesFound += totalNew;
  lastPoll = new Date().toISOString();

  // Trim processedIds to prevent memory growth
  if (processedIds.size > 500) {
    const arr = [...processedIds];
    processedIds = new Set(arr.slice(-200));
  }

  if (totalNew > 0) {
    console.log(`[GmailPoll] ${totalNew} new replies detected across ${inboxes.length} inbox(es)`);
  }
}

export function startGmailPollScheduler(intervalMinutes = 1) {
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
