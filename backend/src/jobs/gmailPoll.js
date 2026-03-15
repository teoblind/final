/**
 * Gmail Inbox Polling Job
 *
 * Polls for unread emails across all configured tenant inboxes + the default
 * agent@zhan.coppice.ai inbox. Matches senders to known contacts, detects
 * RFQ/bid requests and IPP inquiries, and routes them through pipelines.
 */

import { google } from 'googleapis';
import { insertActivity, getTenantEmailConfig, isEmailProcessed, isThreadProcessed, markEmailProcessed, getTenant, logAutoReply, getSystemDb, getTenantDb, runWithTenant, getAllTenants } from '../cache/database.js';
import { isRfqEmail, processRfqEmail } from '../services/estimatePipeline.js';
import { isIppEmail, processIppEmail } from '../services/ippPipeline.js';
import { classifyEmail, canAutoRespond, canProcess } from '../services/emailGuard.js';
import { chat } from '../services/chatService.js';
import { sendEmail, sendHtmlEmail, markdownToEmailHtml } from '../services/emailService.js';

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

  // Default inbox (agent@zhan.coppice.ai from env vars)
  const defaultToken = process.env.GMAIL_REFRESH_TOKEN;
  if (defaultToken) {
    inboxes.push({ tenantId: 'zhan-capital', label: 'agent@zhan.coppice.ai', gmail: makeGmailClient(defaultToken) });
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

async function generalEmailHandler({ messageId, threadId, from, fromName, subject, body, tenantId, gmail, classification }) {
  const resolvedTenant = tenantId || 'default';
  const verdict = classification?.verdict || 'unknown';

  // Block auto-reply for unknown senders — only log
  if (!canAutoRespond(verdict)) {
    console.log(`[GmailPoll] Unknown sender ${from} (verdict: ${verdict}), logging only — no auto-reply`);
    insertActivity({
      tenantId: resolvedTenant,
      type: 'in',
      title: `Email from unverified sender: ${fromName || from}`,
      subtitle: `${subject} (not auto-replied — sender not in trusted list)`,
      detailJson: JSON.stringify({ from, fromName, subject, body: body.slice(0, 5000), threadId, messageId, emailGuard: classification }),
      sourceType: 'email',
      sourceId: messageId,
      agentId: 'email-guard',
    });
    markEmailProcessed({ messageId, threadId, pipeline: 'unknown-sender', tenantId: resolvedTenant });
    return;
  }

  if (!isAutoReplyEnabled(resolvedTenant)) {
    console.log(`[GmailPoll] Auto-reply disabled for tenant ${resolvedTenant}, logging only`);
    insertActivity({
      tenantId: resolvedTenant,
      type: 'in',
      title: `Email from ${fromName || from}`,
      subtitle: subject,
      detailJson: JSON.stringify({ from, fromName, subject, body: body.slice(0, 5000), threadId, messageId }),
      sourceType: 'email',
      sourceId: messageId,
      agentId: 'coppice',
    });
    markEmailProcessed({ messageId, threadId, pipeline: 'general', tenantId: resolvedTenant });
    return;
  }

  // Ask the tenant's primary agent to draft a response
  const agentMap = { 'default': 'sangha', 'zhan-capital': 'zhan' };
  const agentId = agentMap[resolvedTenant] || 'hivemind';
  const hasThreadContext = body.includes('--- Previous messages in this thread ---');
  const prompt = hasThreadContext
    ? `You received a follow-up email from ${fromName || from} (${from}) in an ongoing conversation. Subject: ${subject}.\n\nLatest message + conversation history:\n\n${body.slice(0, 6000)}\n\nDraft a response to their latest message, keeping the conversation context in mind. Reply with ONLY the email body text — no subject line, no greeting instructions, no meta-commentary.`
    : `You received an email from ${fromName || from} (${from}). Subject: ${subject}. Body:\n\n${body.slice(0, 4000)}\n\nDraft a professional response. Reply with ONLY the email body text — no subject line, no greeting instructions, no meta-commentary.`;

  let agentResponse;
  try {
    const result = await chat(resolvedTenant, agentId, 'system-auto-reply', prompt);
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

  // Send the reply with proper threading (convert markdown to HTML)
  // Detect meeting-related emails to CC + forward full thread to Teo
  const meetingKeywords = /\b(meeting|call|schedule|calendar|book a time|availability|free on|tuesday|wednesday|thursday|monday|friday|slot|zoom|google meet|check size|LP|lock-?up)\b/i;
  const isMeetingRelated = meetingKeywords.test(body) || meetingKeywords.test(agentResponse);
  const cc = isMeetingRelated ? 'teo@zhan.capital' : undefined;

  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  try {
    const html = markdownToEmailHtml(agentResponse);
    await sendHtmlEmail({
      to: from,
      subject: replySubject,
      html,
      cc,
      tenantId: resolvedTenant,
      threadId,
      inReplyTo: messageId,
      references: messageId,
    });
    console.log(`[GmailPoll] Auto-reply sent to ${from} for "${subject}"${cc ? ` (CC: ${cc})` : ''}`);
  } catch (err) {
    console.error(`[GmailPoll] Auto-reply send failed:`, err.message);
    markEmailProcessed({ messageId, threadId, pipeline: 'general-send-error', tenantId: resolvedTenant });
    return;
  }

  // Forward full conversation thread to Teo on meeting-related emails
  if (isMeetingRelated && gmail && threadId) {
    try {
      const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
      const threadMessages = threadRes.data.messages || [];
      let threadHtml = `<h3 style="font-family:sans-serif;color:#333;">Meeting-related thread — ${fromName || from}</h3><hr>`;
      for (const tm of threadMessages) {
        const tmHeaders = tm.payload?.headers || [];
        const tmFrom = tmHeaders.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown';
        const tmDate = tmHeaders.find(h => h.name.toLowerCase() === 'date')?.value || '';
        const tmBody = extractEmailBody(tm.payload);
        const tmHtml = markdownToEmailHtml(tmBody);
        threadHtml += `<div style="margin:16px 0;padding:12px;border-left:3px solid #ddd;font-family:sans-serif;">`;
        threadHtml += `<div style="font-size:12px;color:#666;margin-bottom:8px;"><strong>${tmFrom}</strong> — ${tmDate}</div>`;
        threadHtml += tmHtml;
        threadHtml += `</div>`;
      }
      threadHtml += `<hr><p style="font-family:sans-serif;font-size:12px;color:#999;">Auto-forwarded by Coppice — reply directly to ${from} to join the conversation.</p>`;
      await sendHtmlEmail({
        to: 'teo@zhan.capital',
        subject: `[Coppice] Meeting request: ${subject} — ${fromName || from}`,
        html: threadHtml,
        tenantId: resolvedTenant,
      });
      console.log(`[GmailPoll] Full thread forwarded to teo@zhan.capital for "${subject}"`);
    } catch (err) {
      console.warn(`[GmailPoll] Thread forward failed: ${err.message}`);
    }
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

      // Check if this thread was already processed — handle multi-turn conversation
      const priorThread = isThreadProcessed(msgThreadId);
      if (priorThread) {
        const followupTenant = priorThread.tenant_id || tenantId || 'default';

        // Skip our own sent messages to avoid reply loops
        const ownAddresses = ['agent@zhan.coppice.ai', 'coppice@zhan.capital'];
        if (ownAddresses.some(addr => senderEmail?.toLowerCase() === addr)) {
          console.log(`[GmailPoll] [${label}] Skipping own sent message in thread ${msgThreadId}`);
          markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'self-skip', tenantId: followupTenant });
          try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
          continue;
        }

        console.log(`[GmailPoll] [${label}] Follow-up in thread (pipeline: ${priorThread.pipeline}), processing multi-turn reply`);

        // Run through email guard for the follow-up
        const followupClassification = classifyEmail({
          tenantId: followupTenant,
          senderEmail,
          senderName,
          subject,
          body,
          headers: full.data.payload?.headers || [],
          messageId: msg.id,
        });

        if (followupClassification.verdict === 'blocked' || followupClassification.verdict === 'spam' || followupClassification.verdict === 'spoofed') {
          console.log(`[GmailPoll] [${label}] Follow-up blocked by email guard: ${followupClassification.verdict}`);
          try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
          markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: `follow-up-${followupClassification.verdict}`, tenantId: followupTenant });
          newReplies++;
          continue;
        }

        // Fetch thread history for context
        let threadContext = '';
        try {
          const threadRes = await gmail.users.threads.get({ userId: 'me', id: msgThreadId, format: 'full' });
          const threadMessages = threadRes.data.messages || [];
          // Build conversation history (last 5 messages, excluding current)
          const recentMessages = threadMessages.slice(-6, -1);
          if (recentMessages.length > 0) {
            threadContext = '\n\n--- Previous messages in this thread ---\n';
            for (const tm of recentMessages) {
              const tmHeaders = tm.payload?.headers || [];
              const tmFrom = tmHeaders.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown';
              const tmBody = extractEmailBody(tm.payload);
              threadContext += `\nFrom: ${tmFrom}\n${tmBody.slice(0, 1500)}\n---\n`;
            }
          }
        } catch (err) {
          console.warn(`[GmailPoll] Could not fetch thread history: ${err.message}`);
        }

        // Route to generalEmailHandler with thread context baked into the body
        const followupHeaders = full.data.payload?.headers || [];
        const followupRfc822Id = followupHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value || msg.id;
        await generalEmailHandler({
          messageId: followupRfc822Id,
          threadId: msgThreadId,
          from: senderEmail,
          fromName: senderName,
          subject,
          body: body + threadContext,
          tenantId: followupTenant,
          gmail,
          classification: followupClassification,
        });
        // Also mark the internal Gmail ID as processed for dedup
        if (followupRfc822Id !== msg.id) {
          markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'follow-up-dedup', tenantId: followupTenant });
        }

        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        newReplies++;
        continue;
      }

      // Resolve tenant: inbox tenantId > contact match > pipeline default
      const contact = matchContactToTenant(senderEmail);
      const resolvedTenant = tenantId || contact?.tenant_id || 'default';
      const allHeaders = full.data.payload?.headers || [];

      // ─── Email Guard: classify before any processing ───
      const classification = classifyEmail({
        tenantId: resolvedTenant,
        senderEmail,
        senderName,
        subject,
        body,
        headers: allHeaders,
        messageId: msg.id,
        contact,
      });

      // SPOOFED → block completely, alert tenant
      if (classification.verdict === 'spoofed') {
        console.warn(`[GmailPoll] [${label}] ⚠ SPOOFED email blocked: "${senderName}" <${senderEmail}> — ${classification.reason}`);
        insertActivity({
          tenantId: resolvedTenant,
          type: 'in',
          title: `⚠ BLOCKED: Spoofed email from "${senderName}" <${senderEmail}>`,
          subtitle: `${subject} — ${classification.reason}`,
          detailJson: JSON.stringify({
            from: senderEmail, fromName: senderName, subject,
            body: body.slice(0, 1000),
            verdict: classification.verdict,
            reason: classification.reason,
            authResults: classification.authResults,
          }),
          sourceType: 'email',
          sourceId: msg.id,
          agentId: 'email-guard',
        });
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'blocked-spoof', tenantId: resolvedTenant });
        newReplies++;
        continue;
      }

      // SPAM → skip entirely, mark processed
      if (classification.verdict === 'spam') {
        console.log(`[GmailPoll] [${label}] Spam filtered: ${senderEmail} — ${classification.reason}`);
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'spam-filtered', tenantId: resolvedTenant });
        newReplies++;
        continue;
      }

      const autoRespondAllowed = canAutoRespond(classification.verdict);

      // Check if this is an RFQ/bid request email → route to estimate pipeline
      if (isRfqEmail(subject, body) && canProcess(classification.verdict)) {
        const rfqTenant = tenantId || contact?.tenant_id || 'dacp-construction-001';
        if (autoRespondAllowed) {
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
        } else {
          // Unknown sender sent an RFQ — log it but don't auto-respond
          console.log(`[GmailPoll] [${label}] RFQ from unknown sender ${senderEmail} — logged, not auto-responded`);
          insertActivity({
            tenantId: rfqTenant,
            type: 'in',
            title: `RFQ received from unknown sender: ${senderName || senderEmail}`,
            subtitle: `${subject} (awaiting manual review — sender not verified)`,
            detailJson: JSON.stringify({
              from: senderEmail, fromName: senderName, subject,
              body: body.slice(0, 5000), threadId: msgThreadId, messageId: msg.id,
              emailGuard: classification,
            }),
            sourceType: 'email',
            sourceId: msg.id,
            agentId: 'email-guard',
          });
        }

        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: autoRespondAllowed ? 'rfq' : 'rfq-pending', tenantId: rfqTenant });
        newReplies++;
        continue;
      }

      // Check if this is an IPP inquiry → route to mine spec pipeline
      if (isIppEmail(subject, body) && canProcess(classification.verdict)) {
        const ippTenant = tenantId || contact?.tenant_id || 'default';
        if (autoRespondAllowed) {
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
        } else {
          console.log(`[GmailPoll] [${label}] IPP from unknown sender ${senderEmail} — logged, not auto-responded`);
          insertActivity({
            tenantId: ippTenant,
            type: 'in',
            title: `IPP inquiry from unknown sender: ${senderName || senderEmail}`,
            subtitle: `${subject} (awaiting manual review — sender not verified)`,
            detailJson: JSON.stringify({
              from: senderEmail, fromName: senderName, subject,
              body: body.slice(0, 5000), threadId: msgThreadId, messageId: msg.id,
              emailGuard: classification,
            }),
            sourceType: 'email',
            sourceId: msg.id,
            agentId: 'email-guard',
          });
        }

        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: autoRespondAllowed ? 'ipp' : 'ipp-pending', tenantId: ippTenant });
        newReplies++;
        continue;
      }

      // Known contact reply (not RFQ/IPP)
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

        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: null, tenantId: contactTenant });
        newReplies++;
        continue;
      }

      // Unmatched email → general handler (auto-reply ONLY if trusted/known AND auto-reply enabled)
      const rfc822MessageId = allHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value || msg.id;

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
          classification,
        });
        // Also mark the internal Gmail ID as processed for dedup
        if (rfc822MessageId !== msg.id) {
          markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'general-dedup', tenantId: resolvedTenant });
        }
      } catch (err) {
        console.error(`[GmailPoll] [${label}] General handler error:`, err.message);
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'general-error', tenantId: resolvedTenant });
      }

      try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
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
