/**
 * User Inbox Poll Job
 *
 * Polls users' personal Gmail inboxes and ingests emails into Coppice's
 * knowledge system. This is READ-ONLY - the agent never replies to emails
 * from the user's inbox. Emails are either auto-ingested as knowledge entries,
 * queued for user review, or skipped based on sender rules.
 *
 * Config lives in each tenant's key vault under service 'google-gmail-user'.
 * Inbox behavior is controlled by user_inbox_config in the tenant DB.
 */

import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllTenants,
  getTenantDb,
  getKeyVaultValue,
  insertApprovalItem,
  insertActivity,
} from '../cache/database.js';
import { processKnowledgeEntry } from '../services/knowledgeProcessor.js';

let pollInterval = null;
let lastPoll = null;
let messagesProcessed = 0;

// Maximum messages to process per poll cycle to avoid Gmail API rate limits
const MAX_MESSAGES_PER_CYCLE = 20;

// Track which tenants need the fallback OAuth client (persists across cycles)
const useFallbackClient = new Set();

// In-memory set of message IDs currently being processed - prevents overlapping
// poll cycles from double-processing the same message concurrently.
const currentlyProcessing = new Set();

// ---- OAuth Client Creation (dual-client pattern from gmailPoll.js) ----------

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

function makeGmailClient(refreshToken) {
  const pairs = getClientPairs();
  if (!refreshToken || pairs.length === 0) return null;
  const client = new google.auth.OAuth2(pairs[0].id, pairs[0].secret, 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
}

function makeGmailClientFallback(refreshToken) {
  const pairs = getClientPairs();
  if (!refreshToken || pairs.length < 2) return null;
  const client = new google.auth.OAuth2(pairs[1].id, pairs[1].secret, 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
}

/**
 * Build a Gmail client for the given tenant, using the fallback client if the
 * primary has previously failed for this tenant.
 */
function getGmailClientForTenant(tenantId, refreshToken) {
  if (useFallbackClient.has(tenantId)) {
    return makeGmailClientFallback(refreshToken) || makeGmailClient(refreshToken);
  }
  return makeGmailClient(refreshToken);
}

// ---- Tenant DB Helpers (user_inbox_config + user_inbox_processed) -----------

/**
 * Ensure the user_inbox_config and user_inbox_processed tables exist in
 * the tenant DB. Called once per tenant per process lifetime.
 */
const _schemaInitialized = new Set();
function ensureSchema(tdb, tenantId) {
  if (_schemaInitialized.has(tenantId)) return;

  tdb.exec(`
    CREATE TABLE IF NOT EXISTS user_inbox_config (
      tenant_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      ingest_mode TEXT DEFAULT 'review' CHECK(ingest_mode IN ('auto', 'review')),
      max_age_days INTEGER DEFAULT 7,
      auto_approve_senders_json TEXT DEFAULT '[]',
      auto_skip_senders_json TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  tdb.exec(`
    CREATE TABLE IF NOT EXISTS user_inbox_processed (
      message_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ingested', 'pending_review', 'skipped')),
      knowledge_entry_id TEXT,
      approval_item_id INTEGER,
      processed_at TEXT DEFAULT (datetime('now'))
    )
  `);

  _schemaInitialized.add(tenantId);
}

function getUserInboxConfig(tdb, tenantId) {
  ensureSchema(tdb, tenantId);
  const row = tdb.prepare('SELECT * FROM user_inbox_config WHERE tenant_id = ?').get(tenantId);
  if (!row) return null;
  return {
    ...row,
    enabled: !!row.enabled,
    auto_approve_senders: JSON.parse(row.auto_approve_senders_json || '[]'),
    auto_skip_senders: JSON.parse(row.auto_skip_senders_json || '[]'),
  };
}

function isUserInboxMessageProcessed(tdb, messageId) {
  try {
    const row = tdb.prepare('SELECT message_id FROM user_inbox_processed WHERE message_id = ?').get(messageId);
    return !!row;
  } catch {
    return false;
  }
}

function markUserInboxMessageProcessed(tdb, { messageId, tenantId, status, knowledgeEntryId, approvalItemId }) {
  ensureSchema(tdb, tenantId);
  tdb.prepare(`
    INSERT OR IGNORE INTO user_inbox_processed (message_id, tenant_id, status, knowledge_entry_id, approval_item_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(messageId, tenantId, status, knowledgeEntryId || null, approvalItemId || null);
}

// ---- Email Parsing Helpers --------------------------------------------------

function extractEmailBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
    // Fallback: text/html or nested parts
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      const nested = extractEmailBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

function getHeader(headers, name) {
  if (!headers) return '';
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

function parseEmailAddress(raw) {
  // "John Doe <john@example.com>" -> { name: "John Doe", email: "john@example.com" }
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim().replace(/^["']|["']$/g, ''), email: match[2].toLowerCase() };
  return { name: '', email: raw.trim().toLowerCase() };
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
        const buffer = Buffer.from(attRes.data.data, 'base64');
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          buffer,
          size: buffer.length,
        });
      } catch (err) {
        console.warn(`[UserInboxPoll] Attachment fetch failed (${part.filename}):`, err.message);
      }
    }
  }
  return attachments;
}

// ---- Attachment Knowledge Persistence ---------------------------------------

/**
 * Parse and save attachment content as knowledge entries.
 * Supports PDF, DOCX, XLSX, CSV, TXT, MD, JSON.
 */
async function saveUserInboxAttachment(tenantId, attachment, emailSubject) {
  const parseable = /\.(pdf|docx|xlsx|csv|txt|md|json)$/i;
  if (!parseable.test(attachment.filename)) return null;

  const { parseFile } = await import('../services/fileParserService.js');
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const tmpPath = path.join(os.tmpdir(), `coppice_uinbox_${Date.now()}_${attachment.filename}`);
  try {
    fs.writeFileSync(tmpPath, attachment.buffer);
    const result = await parseFile(tmpPath, attachment.mimeType, attachment.filename);
    if (!result?.text) return null;

    const tdb = getTenantDb(tenantId);
    const knId = `KN-uinbox-att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const content = JSON.stringify({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      text: result.text.slice(0, 50000),
      emailSubject,
      source: 'user-inbox',
    });
    tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
      VALUES (?, ?, 'document', ?, ?, ?, 'user-inbox-poll', datetime('now'))`)
      .run(knId, tenantId, `Inbox Attachment: ${attachment.filename}`, content, `user-inbox-attachment`);

    console.log(`[UserInboxPoll] Saved attachment knowledge: ${attachment.filename} (${result.text.length} chars) -> ${knId}`);
    return knId;
  } catch (err) {
    console.warn(`[UserInboxPoll] Attachment knowledge save failed (${attachment.filename}):`, err.message);
    return null;
  } finally {
    try { (await import('fs')).unlinkSync(tmpPath); } catch {}
  }
}

// ---- Core Message Processing ------------------------------------------------

/**
 * Process a single email message from the user's inbox.
 * Classifies and routes based on ingest_mode and sender rules.
 */
async function processUserInboxMessage(gmail, tenantId, messageId, config) {
  if (currentlyProcessing.has(messageId)) return;
  currentlyProcessing.add(messageId);

  try {
    const tdb = getTenantDb(tenantId);

    // Already processed?
    if (isUserInboxMessageProcessed(tdb, messageId)) {
      return;
    }

    // Fetch full message
    const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const msg = res.data;
    const headers = msg.payload?.headers || [];

    const from = getHeader(headers, 'From');
    const to = getHeader(headers, 'To');
    const subject = getHeader(headers, 'Subject') || '(no subject)';
    const date = getHeader(headers, 'Date');
    const threadId = msg.threadId;

    const { name: fromName, email: fromEmail } = parseEmailAddress(from);
    const body = extractEmailBody(msg.payload);

    // Check auto_skip_senders
    const skipSenders = (config.auto_skip_senders || []).map(s => s.toLowerCase());
    if (skipSenders.includes(fromEmail)) {
      markUserInboxMessageProcessed(tdb, {
        messageId, tenantId, status: 'skipped',
      });
      console.log(`[UserInboxPoll] Skipped (auto-skip sender): ${fromEmail} - "${subject}"`);
      return;
    }

    // Determine if auto-ingest or review
    const approveSenders = (config.auto_approve_senders || []).map(s => s.toLowerCase());
    const shouldAutoIngest = config.ingest_mode === 'auto' || approveSenders.includes(fromEmail);

    if (shouldAutoIngest) {
      // Auto-ingest: create knowledge entry directly
      const knId = `KN-uinbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const knContent = JSON.stringify({
        from: fromEmail,
        fromName,
        to,
        subject,
        date,
        body: (body || '').slice(0, 10000),
        threadId,
        messageId,
      });

      try {
        tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
          VALUES (?, ?, 'email-observation', ?, ?, ?, 'user-inbox-poll', datetime('now'))`)
          .run(knId, tenantId, `${subject} (from ${fromName || fromEmail})`, knContent, `user-inbox:${fromEmail}`);

        // Process async - extract entities, summaries, enrich contacts (fire and forget)
        processKnowledgeEntry(knId, tenantId).catch(err => {
          console.warn(`[UserInboxPoll] Knowledge processing failed for ${knId}: ${err.message}`);
        });
      } catch (err) {
        console.warn(`[UserInboxPoll] Knowledge save failed: ${err.message}`);
      }

      // Extract and save attachments
      try {
        const attachments = await extractAttachments(gmail, messageId, msg.payload);
        for (const att of attachments) {
          await saveUserInboxAttachment(tenantId, att, subject);
        }
      } catch (err) {
        console.warn(`[UserInboxPoll] Attachment processing failed: ${err.message}`);
      }

      markUserInboxMessageProcessed(tdb, {
        messageId, tenantId, status: 'ingested', knowledgeEntryId: knId,
      });

      // Log activity
      insertActivity({
        tenantId,
        type: 'in',
        title: `Inbox email ingested: ${fromName || fromEmail}`,
        subtitle: subject,
        detailJson: JSON.stringify({ from: fromEmail, fromName, subject, threadId, messageId }),
        sourceType: 'user-inbox',
        sourceId: `uinbox-${messageId}`,
        agentId: 'coppice',
      });

      console.log(`[UserInboxPoll] Ingested: ${fromEmail} - "${subject}" -> ${knId}`);
    } else {
      // Review mode: create approval_item for user to decide
      const payload = {
        from: fromEmail,
        fromName,
        to,
        subject,
        date,
        body: (body || '').slice(0, 5000),
        threadId,
        messageId,
        attachmentCount: (msg.payload?.parts || []).filter(p => p.filename && p.filename.length > 0).length,
      };

      let approvalId = null;
      try {
        const result = insertApprovalItem({
          tenantId,
          agentId: 'coppice',
          title: `Inbox email: ${subject} (from ${fromName || fromEmail})`,
          description: `Email from ${fromName || fromEmail} received in your personal inbox. Review and approve to ingest into the knowledge system, or reject to skip.\n\nFrom: ${fromName || ''} <${fromEmail}>\nSubject: ${subject}\nDate: ${date}\n\n${(body || '').slice(0, 1000)}${(body || '').length > 1000 ? '\n\n[truncated]' : ''}`,
          type: 'inbox_ingest',
          payloadJson: JSON.stringify(payload),
        });
        approvalId = result?.lastInsertRowid || null;
      } catch (err) {
        console.warn(`[UserInboxPoll] Approval item creation failed: ${err.message}`);
      }

      markUserInboxMessageProcessed(tdb, {
        messageId, tenantId, status: 'pending_review', approvalItemId: approvalId,
      });

      console.log(`[UserInboxPoll] Queued for review: ${fromEmail} - "${subject}" (approval #${approvalId})`);
    }
  } catch (err) {
    console.error(`[UserInboxPoll] Failed to process message ${messageId}:`, err.message);
  } finally {
    currentlyProcessing.delete(messageId);
  }
}

// ---- Per-Tenant Inbox Poll --------------------------------------------------

/**
 * Poll a single user's inbox for new emails.
 * Fetches messages newer than max_age_days and processes up to MAX_MESSAGES_PER_CYCLE.
 */
async function pollUserInbox(tenantId, config) {
  const refreshToken = getKeyVaultValue(tenantId, 'google-gmail-user');
  if (!refreshToken) {
    console.warn(`[UserInboxPoll] No refresh token found for tenant ${tenantId} (service: google-gmail-user)`);
    return;
  }

  let gmail = getGmailClientForTenant(tenantId, refreshToken);
  if (!gmail) {
    console.warn(`[UserInboxPoll] Could not create Gmail client for tenant ${tenantId}`);
    return;
  }

  const maxAgeDays = config.max_age_days || 7;
  const query = `newer_than:${maxAgeDays}d`;

  let messages = [];
  try {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: MAX_MESSAGES_PER_CYCLE,
    });
    messages = listRes.data.messages || [];
  } catch (err) {
    // If primary client fails, try fallback
    if (!useFallbackClient.has(tenantId)) {
      console.warn(`[UserInboxPoll] Primary client failed for ${tenantId}, trying fallback: ${err.message}`);
      useFallbackClient.add(tenantId);
      const fallbackGmail = makeGmailClientFallback(refreshToken);
      if (fallbackGmail) {
        try {
          const listRes = await fallbackGmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: MAX_MESSAGES_PER_CYCLE,
          });
          messages = listRes.data.messages || [];
          gmail = fallbackGmail;
        } catch (err2) {
          console.error(`[UserInboxPoll] Both clients failed for ${tenantId}: ${err2.message}`);
          return;
        }
      } else {
        console.error(`[UserInboxPoll] No fallback client available for ${tenantId}`);
        return;
      }
    } else {
      console.error(`[UserInboxPoll] Gmail list failed for ${tenantId}: ${err.message}`);
      return;
    }
  }

  if (messages.length === 0) {
    return;
  }

  const tdb = getTenantDb(tenantId);
  let processed = 0;

  for (const msg of messages) {
    if (processed >= MAX_MESSAGES_PER_CYCLE) break;

    // Skip already-processed messages (quick check before full fetch)
    if (isUserInboxMessageProcessed(tdb, msg.id)) continue;

    try {
      await processUserInboxMessage(gmail, tenantId, msg.id, config);
      processed++;
    } catch (err) {
      console.error(`[UserInboxPoll] Error processing ${msg.id} for ${tenantId}:`, err.message);
    }
  }

  if (processed > 0) {
    console.log(`[UserInboxPoll] Processed ${processed} messages for tenant ${tenantId}`);
  }
}

// ---- Main Scheduler ---------------------------------------------------------

/**
 * Run a single poll cycle across all tenants with enabled user_inbox_config.
 */
async function pollAllUserInboxes() {
  lastPoll = new Date().toISOString();

  let tenants;
  try {
    tenants = getAllTenants();
  } catch (err) {
    console.error('[UserInboxPoll] Failed to get tenants:', err.message);
    return;
  }

  for (const tenant of tenants) {
    try {
      const tdb = getTenantDb(tenant.id);
      const config = getUserInboxConfig(tdb, tenant.id);

      if (!config || !config.enabled) continue;

      await pollUserInbox(tenant.id, config);
    } catch (err) {
      console.error(`[UserInboxPoll] Failed for tenant ${tenant.id}:`, err.message);
    }
  }

  messagesProcessed++;
}

/**
 * Start the user inbox poll scheduler.
 * @param {number} intervalMinutes - Poll interval in minutes (default: 5)
 */
export function startUserInboxPollScheduler(intervalMinutes = 5) {
  if (pollInterval) {
    console.log('[UserInboxPoll] Scheduler already running');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`[UserInboxPoll] Starting scheduler (interval: ${intervalMinutes} min)`);

  // Run after a short delay on startup
  setTimeout(() => {
    pollAllUserInboxes().catch(err => console.error('[UserInboxPoll] Initial poll failed:', err.message));
  }, 15000); // 15s delay - let gmailPoll start first

  pollInterval = setInterval(() => {
    pollAllUserInboxes().catch(err => console.error('[UserInboxPoll] Scheduled poll failed:', err.message));
  }, intervalMs);
}

export function stopUserInboxPollScheduler() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[UserInboxPoll] Scheduler stopped');
  }
}

export function getUserInboxPollStatus() {
  return {
    running: pollInterval !== null,
    lastPoll,
    pollCycles: messagesProcessed,
  };
}
