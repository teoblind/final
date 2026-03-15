/**
 * Gmail Inbox Polling Job
 *
 * Polls for unread emails across all configured tenant inboxes + the default
 * coppice@zhan.capital inbox. Matches senders to known contacts, detects
 * RFQ/bid requests and IPP inquiries, and routes them through pipelines.
 */

import { google } from 'googleapis';
import { insertActivity, getTenantEmailConfig, isEmailProcessed, isThreadProcessed, markEmailProcessed, getTenant, logAutoReply, getSystemDb, getTenantDb, runWithTenant, getAllTenants } from '../cache/database.js';
import { isRfqEmail, processRfqEmail } from '../services/estimatePipeline.js';
import { isIppEmail, processIppEmail } from '../services/ippPipeline.js';
import { chat } from '../services/chatService.js';
import { sendEmail } from '../services/emailService.js';

let pollInterval = null;
let lastPoll = null;
let repliesFound = 0;

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

  // Tenant inboxes from each tenant DB
  try {
    const tenants = getAllTenants();
    for (const tenant of tenants) {
      try {
        const tdb = getTenantDb(tenant.id);
        const rows = tdb.prepare('SELECT * FROM tenant_email_config').all();
        for (const row of rows) {
          const gmail = makeGmailClient(row.gmail_refresh_token);
          if (gmail) {
            inboxes.push({ tenantId: row.tenant_id, label: `${row.sender_email} (${row.tenant_id})`, gmail });
          }
        }
      } catch (e) {
        // Table may not exist yet for this tenant
      }
    }
  } catch (e) {
    // getAllTenants may fail during startup
  }

  return inboxes;
}

function matchContactToTenant(email) {
  // Search across all tenant DBs for the contact
  try {
    const tenants = getAllTenants();
    for (const tenant of tenants) {
      try {
        const tdb = getTenantDb(tenant.id);
        const row = tdb.prepare(`
          SELECT c.name, c.title, l.venue_name as company, l.tenant_id
          FROM le_contacts c
          JOIN le_leads l ON c.lead_id = l.id AND c.tenant_id = l.tenant_id
          WHERE LOWER(c.email) = LOWER(?)
          LIMIT 1
        `).get(email);
        if (row) return row;
      } catch (e) {
        // Table may not exist in this tenant DB
      }
    }
  } catch (e) {
    // Fallback if tenants not available
  }
  return null;
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

function isAutoReplyEnabled(tenantId) {
  try {
    const tenant = getTenant(tenantId || 'default');
    if (!tenant?.settings) return false;
    return tenant.settings.auto_reply_enabled === true;
  } catch {
    return false;
  }
}

async function generalEmailHandler({ messageId, threadId, from, fromName, subject, body, tenantId, gmail }) {
  const resolvedTenant = tenantId || 'default';

  if (!isAutoReplyEnabled(resolvedTenant)) {
    console.log(`[GmailPoll] Auto-reply disabled for tenant ${resolvedTenant}, logging only`);
    insertActivity({
      tenantId: resolvedTenant,
      type: 'in',
      title: `Unmatched email from ${fromName || from}`,
      subtitle: subject,
      detailJson: JSON.stringify({ from, fromName, subject, body: body.slice(0, 5000), threadId, messageId }),
      sourceType: 'email',
      sourceId: messageId,
      agentId: 'coppice',
    });
    markEmailProcessed({ messageId, threadId, pipeline: 'general', tenantId: resolvedTenant });
    return;
  }

  // Ask the Hivemind agent to draft a response
  const prompt = `You received an email from ${fromName || from} (${from}). Subject: ${subject}. Body:\n\n${body.slice(0, 4000)}\n\nDraft a professional response. Reply with ONLY the email body text — no subject line, no greeting instructions, no meta-commentary.`;

  let agentResponse;
  try {
    const result = await chat(resolvedTenant, 'hivemind', 'system-auto-reply', prompt);
    agentResponse = result.response;
  } catch (err) {
    console.error(`[GmailPoll] Agent draft failed for ${messageId}:`, err.message);
    insertActivity({
      tenantId: resolvedTenant,
      type: 'in',
      title: `Unmatched email from ${fromName || from} (auto-reply failed)`,
      subtitle: subject,
      detailJson: JSON.stringify({ from, fromName, subject, body: body.slice(0, 5000), threadId, messageId, error: err.message }),
      sourceType: 'email',
      sourceId: messageId,
      agentId: 'coppice',
    });
    markEmailProcessed({ messageId, threadId, pipeline: 'general-error', tenantId: resolvedTenant });
    return;
  }

  // Send the reply with proper threading
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  try {
    await sendEmail({
      to: from,
      subject: replySubject,
      body: agentResponse,
      tenantId: resolvedTenant,
      threadId,
      inReplyTo: messageId,
      references: messageId,
    });
    console.log(`[GmailPoll] Auto-reply sent to ${from} for "${subject}"`);
  } catch (err) {
    console.error(`[GmailPoll] Auto-reply send failed:`, err.message);
    markEmailProcessed({ messageId, threadId, pipeline: 'general-send-error', tenantId: resolvedTenant });
    return;
  }

  // Log the auto-reply
  logAutoReply({
    messageId,
    sender: from,
    subject,
    responsePreview: agentResponse.slice(0, 500),
    tenantId: resolvedTenant,
  });

  insertActivity({
    tenantId: resolvedTenant,
    type: 'out',
    title: `Auto-reply sent to ${fromName || from}`,
    subtitle: replySubject,
    detailJson: JSON.stringify({ to: from, subject: replySubject, response: agentResponse.slice(0, 2000) }),
    sourceType: 'email',
    sourceId: messageId,
    agentId: 'coppice',
  });

  markEmailProcessed({ messageId, threadId, pipeline: 'general-auto-reply', tenantId: resolvedTenant });
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
      if (isEmailProcessed(msg.id)) continue;

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
      const msgThreadId = full.data.threadId;

      // Check if this thread was already processed by a pipeline — follow-up reply
      const priorThread = isThreadProcessed(msgThreadId);
      if (priorThread) {
        console.log(`[GmailPoll] [${label}] Follow-up in already-processed thread (pipeline: ${priorThread.pipeline}), logging and skipping`);
        const followupTenant = priorThread.tenant_id || tenantId || 'default';
        insertActivity({
          tenantId: followupTenant,
          type: 'in',
          title: `Follow-up from ${senderName || senderEmail}`,
          subtitle: `${subject} (thread already processed by ${priorThread.pipeline})`,
          detailJson: JSON.stringify({
            from: senderEmail, fromName: senderName, subject,
            body: body.slice(0, 5000), threadId: msgThreadId, messageId: msg.id,
            originalPipeline: priorThread.pipeline,
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
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'follow-up', tenantId: followupTenant });
        newReplies++;
        continue;
      }

      // Resolve tenant: inbox tenantId > contact match > pipeline default
      const contact = matchContactToTenant(senderEmail);
      const resolvedTenant = tenantId || contact?.tenant_id || 'default';

      // Check if this is an RFQ/bid request email → route to estimate pipeline
      if (isRfqEmail(subject, body)) {
        const rfqTenant = tenantId || contact?.tenant_id || 'dacp-construction-001';
        try {
          const result = await processRfqEmail({
            messageId: msg.id,
            threadId: msgThreadId,
            from: senderEmail,
            fromName: senderName,
            subject,
            body,
            tenantId: rfqTenant,
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

        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'rfq', tenantId: rfqTenant });
        newReplies++;
        continue;
      }

      // Check if this is an IPP inquiry → route to mine spec pipeline
      if (isIppEmail(subject, body)) {
        const ippTenant = tenantId || contact?.tenant_id || 'default';
        try {
          const attachments = await extractAttachments(gmail, msg.id, full.data.payload);
          const result = await processIppEmail({
            messageId: msg.id,
            threadId: msgThreadId,
            from: senderEmail,
            fromName: senderName,
            subject,
            body,
            attachments,
            tenantId: ippTenant,
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

        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'ipp', tenantId: ippTenant });
        newReplies++;
        continue;
      }

      // Not an RFQ or IPP — check if it's from a known contact
      if (contact) {
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
            threadId: msgThreadId,
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

        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: null, tenantId: contactTenant });
        newReplies++;
        continue;
      }

      // Fallback: unmatched email → general handler (auto-reply if enabled)
      const msgHeaders = full.data.payload?.headers || [];
      const rfc822MessageId = msgHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value || msg.id;

      try {
        await generalEmailHandler({
          messageId: rfc822MessageId,
          threadId: msgThreadId,
          from: from,
          fromName: senderName,
          subject,
          body,
          tenantId: resolvedTenant,
          gmail,
        });
      } catch (err) {
        console.error(`[GmailPoll] [${label}] General handler error:`, err.message);
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'general-error', tenantId: resolvedTenant });
      }

      try {
        await gmail.users.messages.modify({
          userId: 'me', id: msg.id,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
      } catch {}

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
    // Wrap each inbox poll in the appropriate tenant context
    const resolvedId = inbox.tenantId || 'default';
    const count = await runWithTenant(resolvedId, () => pollSingleInbox(inbox.gmail, inbox.tenantId, inbox.label));
    totalNew += count;
  }

  repliesFound += totalNew;
  lastPoll = new Date().toISOString();

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
