/**
 * Gmail Inbox Polling Job
 *
 * Polls for unread emails across all configured tenant inboxes + the default
 * agent@zhan.coppice.ai inbox. Matches senders to known contacts, detects
 * RFQ/bid requests and IPP inquiries, and routes them through pipelines.
 */

import { google } from 'googleapis';
import { insertActivity, getTenantEmailConfig, isEmailPermanentlyProcessed, isThreadProcessed, markEmailProcessed, markEmailRetry, getEmailRetryCount, getTenant, logAutoReply, getSystemDb, getTenantDb, runWithTenant, getAllTenants, getTrustedSenderByEmail, addTrustedSender, upsertCcThreadTracker, getCcThreadsReadyForTrigger, markCcThreadTriggered, insertAgentAssignment, updateAgentAssignment, getAgentMemory, insertApprovalItem , getDefaultTenantId } from '../cache/database.js';
import { isAwardNotice, processAwardNotice } from '../services/awardPipeline.js';
import { isRfqEmail, processRfqEmail } from '../services/estimatePipeline.js';
import { isIppEmail, processIppEmail } from '../services/ippPipeline.js';
import { classifyEmail, canAutoRespond, canProcess, getAccessTier } from '../services/emailGuard.js';
import { tunnelOrChat } from '../services/cliTunnel.js';
import { sendEmail, sendHtmlEmail, sendEmailWithAttachments, markdownToEmailHtml } from '../services/emailService.js';
import { processKnowledgeEntry, getThreadKnowledge, getContactKnowledge } from '../services/knowledgeProcessor.js';
import { extractFirefliesMeetingId, fetchFirefliesTranscript, formatTranscriptAsMarkdown } from '../services/firefliesService.js';

let pollInterval = null;
let lastPoll = null;
let repliesFound = 0;

// Token health tracking - in-memory map of { label -> { status, lastChecked, error } }
const tokenHealth = new Map();
let lastHealthCheck = null;

// Track which inboxes need the fallback client (persists across poll cycles)
const useFallbackClient = new Set();

// In-memory set of message IDs currently being processed - prevents overlapping
// poll cycles from double-processing the same message concurrently.
const currentlyProcessing = new Set();

// Maximum number of retry attempts before giving up permanently.
const MAX_RETRIES = 3;

// OAuth app credentials - lazy evaluation to avoid ESM ordering bug
// (admin.js statically imports this module before dotenv.config() runs)
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

// Default for non-gmail-poll usage (lazy)
function getClientId() { return getClientPairs()[0]?.id; }
function getClientSecret() { return getClientPairs()[0]?.secret; }

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
 * Build a list of inboxes to poll: default + all tenant email configs.
 */
function getInboxes() {
  const inboxes = [];

  // Default inbox (agent@zhan.coppice.ai from env vars)
  const defaultToken = process.env.GMAIL_REFRESH_TOKEN;
  if (defaultToken) {
    const label = 'agent@zhan.coppice.ai';
    const gmail = useFallbackClient.has(label) ? makeGmailClientFallback(defaultToken) || makeGmailClient(defaultToken) : makeGmailClient(defaultToken);
    inboxes.push({ tenantId: 'zhan-capital', label, gmail, refreshToken: defaultToken });
  }

  // Tenant inboxes from each tenant DB
  try {
    const tenants = getAllTenants();
    for (const tenant of tenants) {
      try {
        const tdb = getTenantDb(tenant.id);
        const rows = tdb.prepare('SELECT * FROM tenant_email_config').all();
        for (const row of rows) {
          const label = row.sender_email;
          const gmail = useFallbackClient.has(label) ? makeGmailClientFallback(row.gmail_refresh_token) || makeGmailClient(row.gmail_refresh_token) : makeGmailClient(row.gmail_refresh_token);
          if (gmail) {
            inboxes.push({ tenantId: row.tenant_id, label, gmail, refreshToken: row.gmail_refresh_token });
          }
        }
      } catch (e) {
        // Table may not exist yet for this tenant
      }
    }
  } catch (e) {
    // getAllTenants may fail during startup
  }

  // Deduplicate by email label - prefer DB entries over env var
  const seen = new Map();
  for (const inbox of inboxes) {
    const existing = seen.get(inbox.label);
    if (!existing) {
      seen.set(inbox.label, inbox);
    }
  }
  return Array.from(seen.values());
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
        const buffer = Buffer.from(attRes.data.data, 'base64');
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          buffer,
          content: buffer.toString('utf-8'), // text fallback
        });
      } catch (err) {
        console.warn(`[GmailPoll] Attachment fetch failed (${part.filename}):`, err.message);
      }
    }
  }
  return attachments;
}

/**
 * Extract readable text from email attachments (PDF, DOCX, XLSX, TXT).
 * Saves attachment buffer to temp file, parses, then cleans up.
 */
async function extractAttachmentText(attachments) {
  if (!attachments || attachments.length === 0) return '';
  const { parseFile } = await import('../services/fileParserService.js');
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const parseable = /\.(pdf|docx|xlsx|csv|txt|md|json)$/i;
  let allText = '';

  for (const att of attachments) {
    if (!parseable.test(att.filename)) continue;
    const tmpPath = path.join(os.tmpdir(), `coppice_att_${Date.now()}_${att.filename}`);
    try {
      fs.writeFileSync(tmpPath, att.buffer);
      const result = await parseFile(tmpPath, att.mimeType, att.filename);
      if (result?.text) {
        allText += `\n\n--- Attachment: ${att.filename} ---\n${result.text.slice(0, 8000)}\n`;
      }
    } catch (err) {
      console.warn(`[GmailPoll] Attachment parse failed (${att.filename}): ${err.message}`);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
  return allText;
}

/**
 * Persist extracted attachment text to knowledge_entries for future retrieval.
 * Parses each attachment (PDF, DOCX, XLSX, CSV, TXT) and saves up to 50KB of
 * text per attachment. Fire-and-forget - errors are caught and logged.
 */
async function saveAttachmentKnowledge(attachments, { tenantId, senderEmail, subject, threadId, messageId }) {
  if (!attachments || attachments.length === 0) return;
  const { parseFile } = await import('../services/fileParserService.js');
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const parseable = /\.(pdf|docx|xlsx|csv|txt|md|json)$/i;

  for (const att of attachments) {
    if (!parseable.test(att.filename)) continue;
    const tmpPath = path.join(os.tmpdir(), `coppice_kn_${Date.now()}_${att.filename}`);
    try {
      fs.writeFileSync(tmpPath, att.buffer);
      const result = await parseFile(tmpPath, att.mimeType, att.filename);
      if (!result?.text) continue;

      const tdb = getTenantDb(tenantId);
      const knId = `KN-attach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const attachContent = JSON.stringify({
        filename: att.filename,
        mimeType: att.mimeType,
        text: result.text.slice(0, 50000),
        fromEmail: senderEmail,
        subject,
        threadId,
        messageId,
      });
      tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
        VALUES (?, ?, 'document', ?, ?, ?, 'gmail-poll', datetime('now'))`)
        .run(knId, tenantId, `Attachment: ${att.filename} (from ${senderEmail})`, attachContent, `email-attachment:${senderEmail}`);
      console.log(`[GmailPoll] Saved attachment knowledge: ${att.filename} (${result.text.length} chars) → ${knId}`);
    } catch (err) {
      console.warn(`[GmailPoll] Attachment knowledge save failed (${att.filename}):`, err.message);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}

function isAutoReplyEnabled(tenantId) {
  try {
    const tenant = getTenant(tenantId || getDefaultTenantId());
    if (!tenant?.settings) return false;
    return tenant.settings.auto_reply_enabled === true;
  } catch {
    return false;
  }
}

// ─── Suggested Draft Pipeline ─────────────────────────────────────────────
// Classifies inbound emails and generates draft replies as approval_items
// so the user can review, edit, and approve with one click.

// Signals that indicate an email deserves a suggested draft reply
const REPLY_WORTHY_SIGNALS = [
  /\?/,                                    // contains a question
  /\b(please|can you|could you|would you)\b/i,  // direct request
  /\b(schedule|meeting|call|availability)\b/i,   // scheduling
  /\b(quote|estimate|pricing|proposal|bid)\b/i,  // business inquiry
  /\b(follow up|following up|checking in)\b/i,   // follow-up
  /\b(urgent|asap|time.sensitive)\b/i,           // urgency
  /\b(interested in|looking for|need help)\b/i,  // inbound interest
  /\b(invoice|payment|contract|agreement)\b/i,   // business action
];

// Signals that an email should NOT get a suggested draft
const NO_DRAFT_SIGNALS = [
  /\b(unsubscribe|opt.out|manage preferences)\b/i,
  /\b(do not reply|no.reply|noreply)\b/i,
  /\b(automated message|auto.generated)\b/i,
  /\bfyi\b/i,                              // informational only
  /\b(out of office|ooo|vacation)\b/i,
  /\bthank(s| you)\b.*$/im,                // just a "thanks" - no reply needed
];

/**
 * Fast heuristic check: should we generate a suggested draft for this email?
 * Runs before the tunnel call so we don't waste CLI time on newsletters.
 */
function shouldSuggestDraft({ from, subject, body, verdict }) {
  // Only for trusted/known senders (unknown senders already get the review flow)
  if (verdict !== 'trusted' && verdict !== 'known') return false;

  const text = `${subject} ${body.slice(0, 2000)}`;

  // Check disqualifiers first
  if (NO_DRAFT_SIGNALS.some(p => p.test(text))) return false;

  // Check for reply-worthy signals
  const signalCount = REPLY_WORTHY_SIGNALS.filter(p => p.test(text)).length;

  // At least 1 signal = suggest a draft
  return signalCount >= 1;
}

/**
 * Generate a suggested draft reply and create an approval_item for the user.
 * Uses tunnelOrChat (CLI tunnel) - not API.
 */
async function createSuggestedDraft({ tenantId, from, fromName, subject, body, threadId, messageId, accessTier }) {
  const agentMap = { [getDefaultTenantId()]: 'sangha', 'zhan-capital': 'zhan' };
  const agentId = agentMap[tenantId] || 'hivemind';

  // Build context
  let contactContext = '';
  if (accessTier === 'internal') {
    try {
      const ck = getContactKnowledge(tenantId, from);
      if (ck) {
        const meta = ck.metadata || {};
        contactContext = `\n\nCONTACT CONTEXT:`;
        if (meta.observedTopics?.length > 0) {
          contactContext += `\n- Topics: ${meta.observedTopics.join(', ')}`;
        }
        if (meta.recentContext?.length > 0) {
          for (const rc of meta.recentContext.slice(-2)) {
            contactContext += `\n- [${rc.date?.slice(0, 10) || ''}] ${rc.summary}`;
          }
        }
      }
    } catch {}
  }

  let memoryContext = '';
  if (accessTier === 'internal') {
    try {
      const memories = getAgentMemory(tenantId);
      if (memories.length > 0) {
        const lines = memories.slice(0, 10).map(m => `- ${m.key}: ${m.value}`).join('\n');
        memoryContext = `\n\nAGENT MEMORY:\n${lines}`;
      }
    } catch {}
  }

  const externalGuard = accessTier === 'external' ? `\nEXTERNAL CONTACT - do NOT share internal business data, client names, or deal details.` : '';

  const prompt = `You are drafting a SUGGESTED reply for the user to review. The user will edit and approve before it sends.

Email from: ${fromName || from} (${from})
Subject: ${subject}

${body.slice(0, 4000)}${contactContext}${memoryContext}${externalGuard}

Draft a reply. The user will review and edit before sending, so focus on capturing the right intent and tone.

STYLE:
- Greeting: "Hey [First Name],"
- Short paragraphs, direct, no fluff
- End with a specific question that bounces the ball back
- Close with "Best,"
- No emoji
- Never fabricate facts you don't have

Reply with ONLY the email body text.`;

  let draftReply = '';
  try {
    const result = await tunnelOrChat({
      tenantId,
      agentId,
      userId: 'system-suggested-draft',
      prompt,
      chatOptions: { accessTier },
      maxTurns: 3,
      timeoutMs: 60_000,
      label: `Suggested Draft: ${subject?.slice(0, 40)}`,
    });
    draftReply = result.response || '';
  } catch (err) {
    console.warn(`[GmailPoll] Suggested draft generation failed (non-fatal): ${err.message}`);
    return; // Don't create an approval item if draft failed
  }

  if (!draftReply) return;

  // Create approval_item with type email_draft so the existing approve flow handles sending
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  try {
    const html = markdownToEmailHtml(draftReply);
    insertApprovalItem({
      tenantId,
      agentId: 'email',
      title: `Suggested reply to ${fromName || from}: "${subject.slice(0, 50)}"`,
      description: `${fromName || from} sent an email that may need a response. Review the draft below, edit if needed, and approve to send.\n\n---\n**From:** ${fromName || ''} <${from}>\n**Subject:** ${subject}\n\n${body.slice(0, 1000)}${body.length > 1000 ? '\n\n[truncated]' : ''}`,
      type: 'email_draft',
      payloadJson: JSON.stringify({
        to: from,
        subject: replySubject,
        body: draftReply,
        html,
        threadId,
        inReplyTo: messageId,
        references: messageId,
        suggestedDraft: true,
        originalEmail: {
          from,
          fromName,
          subject,
          body: body.slice(0, 3000),
          receivedAt: new Date().toISOString(),
        },
      }),
    });
    console.log(`[GmailPoll] Created suggested draft for ${from} ("${subject}")`);
  } catch (err) {
    console.warn(`[GmailPoll] Failed to create suggested draft approval: ${err.message}`);
  }
}

async function generalEmailHandler({ messageId, threadId, from, fromName, subject, body, tenantId, gmail, classification, originalTo, originalCc }) {
  const resolvedTenant = tenantId || getDefaultTenantId();
  const verdict = classification?.verdict || 'unknown';
  const accessTier = getAccessTier(verdict, classification?.trustLevel);

  // Unknown senders: don't auto-reply, but draft a response and create a
  // proposed task so the tenant can review, approve, or dismiss.
  if (!canAutoRespond(verdict)) {
    console.log(`[GmailPoll] Unknown sender ${from} (verdict: ${verdict}) - drafting reply for approval`);

    // Save to knowledge base
    let knId;
    try {
      const tdb = getTenantDb(resolvedTenant);
      knId = `KN-unknown-sender-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
        VALUES (?, ?, 'email-observation', ?, ?, ?, 'gmail-poll', datetime('now'))`)
        .run(knId, resolvedTenant, `${subject} (from ${from})`, JSON.stringify({
          from,
          fromName,
          subject,
          body: (body || '').slice(0, 10000),
          threadId,
          messageId,
        }), `unknown-sender:${from}`);
    } catch (err) {
      console.warn(`[GmailPoll] Knowledge save failed for unknown-sender:`, err.message);
    }

    // Draft a reply using external-tier guardrails (no internal data)
    let draftReply = '';
    try {
      const draftResult = await tunnelOrChat({
        tenantId: resolvedTenant,
        agentId: { [getDefaultTenantId()]: 'sangha', 'zhan-capital': 'zhan' }[resolvedTenant] || 'hivemind',
        userId: 'system-auto-reply',
        prompt: `You received an email from an UNKNOWN sender: ${fromName || from} (${from}). Subject: ${subject}. Body:\n\n${body.slice(0, 3000)}\n\nDraft a brief, professional reply. This sender is NOT verified - keep the response generic and do NOT share any internal business information. Reply with ONLY the email body text.

EXTERNAL COMMUNICATION GUARDRAILS (highest priority):
- Do NOT reference any internal data, client names, deal values, or business details
- Keep it brief and professional - acknowledge their email and offer to connect them with the right person
- If it looks like spam or irrelevant, draft a polite decline
- If it looks like a legitimate business inquiry, draft a helpful but guarded response`,
        chatOptions: { accessTier: 'external' },
        maxTurns: 3,
        timeoutMs: 60_000,
        label: `Unknown Sender Draft: ${subject?.slice(0, 30)}`,
      });
      draftReply = draftResult.response || '';
    } catch (err) {
      console.warn(`[GmailPoll] Draft for unknown sender failed (non-fatal): ${err.message}`);
      draftReply = `Hey ${(fromName || from).split(' ')[0]},\n\nThanks for reaching out. Let me loop in the right person on our team to follow up with you.\n\nBest,`;
    }

    // Create a proposed assignment for the tenant to review
    const assignmentId = `assign-unknown-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      insertAgentAssignment({
        id: assignmentId,
        tenant_id: resolvedTenant,
        agent_id: 'email',
        title: `Review email from unknown sender: ${fromName || from}`,
        description: `An email arrived from an unverified sender. Review the email and draft reply below. You can approve to send the reply, edit it, or dismiss if it's spam.\n\n---\n**From:** ${fromName || ''} <${from}>\n**Subject:** ${subject}\n\n${body.slice(0, 2000)}${body.length > 2000 ? '\n\n[truncated]' : ''}\n\n---\n**Draft Reply:**\n\n${draftReply}`,
        category: 'email-review',
        priority: 'high',
        action_prompt: `Send the following reply to ${from} (Subject: Re: ${subject}):\n\n${draftReply}\n\nIf the user approves, send this reply using send_email. If they edit the draft, use their version instead. Thread ID: ${threadId}, In-Reply-To: ${messageId}`,
        context_json: JSON.stringify({
          from,
          fromName,
          subject,
          body: body.slice(0, 5000),
          threadId,
          messageId,
          draftReply,
          classification,
        }),
      });
      // Set source fields
      updateAgentAssignment(resolvedTenant, assignmentId, {
        source_type: 'unknown-sender-review',
        source_thread_id: threadId,
        knowledge_entry_ids_json: knId ? JSON.stringify([knId]) : null,
      });
      console.log(`[GmailPoll] Created review task ${assignmentId} for unknown sender ${from}`);
    } catch (err) {
      console.warn(`[GmailPoll] Failed to create review task for unknown sender: ${err.message}`);
    }

    insertActivity({
      tenantId: resolvedTenant,
      type: 'in',
      title: `Email from unknown sender: ${fromName || from}`,
      subtitle: `${subject} - draft reply pending your review`,
      detailJson: JSON.stringify({ from, fromName, subject, body: body.slice(0, 5000), threadId, messageId, emailGuard: classification, assignmentId, draftReply: draftReply.slice(0, 500) }),
      sourceType: 'email',
      sourceId: messageId,
      agentId: 'email-guard',
    });

    markEmailProcessed({ messageId, threadId, pipeline: 'unknown-sender-review', tenantId: resolvedTenant });
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

    // Save to knowledge base
    try {
      const tdb = getTenantDb(resolvedTenant);
      const knId = `KN-general-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
        VALUES (?, ?, 'email-observation', ?, ?, ?, 'gmail-poll', datetime('now'))`)
        .run(knId, resolvedTenant, `${subject} (from ${from})`, JSON.stringify({
          from,
          fromName,
          subject,
          body: (body || '').slice(0, 10000),
          threadId,
          messageId,
        }), `general:${from}`);
    } catch (err) {
      console.warn(`[GmailPoll] Knowledge save failed for general:`, err.message);
    }

    // ─── Suggested draft pipeline ───
    // Even with auto-reply disabled, suggest drafts for reply-worthy emails
    // so the user can review and approve with one click.
    if (shouldSuggestDraft({ from, subject, body, verdict })) {
      createSuggestedDraft({ tenantId: resolvedTenant, from, fromName, subject, body, threadId, messageId, accessTier })
        .catch(err => console.warn(`[GmailPoll] Suggested draft failed (non-fatal): ${err.message}`));
    }

    return;
  }

  // ─── Contact knowledge injection (internal tier only - never expose to external emails) ───
  let contactContext = '';
  if (accessTier === 'internal') {
    try {
      const ck = getContactKnowledge(resolvedTenant, from);
      if (ck) {
        const meta = ck.metadata || {};
        contactContext = `\n\nCONTACT INTELLIGENCE (from previous interactions with ${fromName || from}):`;
        if (meta.observedTopics?.length > 0) {
          contactContext += `\n- Topics they discuss: ${meta.observedTopics.join(', ')}`;
        }
        if (meta.recentContext?.length > 0) {
          contactContext += `\n- Recent interactions:`;
          for (const rc of meta.recentContext.slice(-3)) {
            contactContext += `\n  [${rc.date?.slice(0, 10) || 'unknown'}] ${rc.summary}`;
          }
        }
        if (ck.entries?.length > 0) {
          contactContext += `\n- ${ck.entries.length} previous email${ck.entries.length > 1 ? 's' : ''} observed involving this contact`;
        }
        contactContext += `\nUse this context to write a more informed, personalized response. Do NOT explicitly mention that you have this intel -- just use it naturally.\n`;
      }
    } catch (err) {
      console.warn(`[GmailPoll] Contact knowledge lookup failed (non-fatal): ${err.message}`);
    }
  }

  // Load tenant memories for email context (internal tier only)
  let memoryContext = '';
  if (accessTier === 'internal') {
    try {
      const memories = getAgentMemory(resolvedTenant);
      if (memories.length > 0) {
        const lines = memories.map(m => `- ${m.key}: ${m.value}`).join('\n');
        memoryContext = `\n\nAGENT MEMORY (from previous work -- use this context when composing replies):\n${lines}`;
      }
    } catch {}
  }

  // ─── Direct-address gate ─────────────────────────────────────────────────
  // Only auto-reply if the agent is directly addressed by name OR the email
  // is sent TO the agent's address (not just CC/BCC). If the sender is talking
  // to someone else and the agent happens to be on the thread, stay silent.
  const agentEmails = ['agent@zhan.coppice.ai', 'coppice@zhan.capital', 'agent@sangha.coppice.ai', 'agent@dacp.coppice.ai'];
  const toField = (originalTo || '').toLowerCase();
  const agentIsDirectRecipient = agentEmails.some(addr => toField.includes(addr));
  const coppiceAddressed = /(?:^|[\n,.!?])\s*(?:@?coppice|hey coppice|hi coppice)\s*[,:]?\s*\b(can you|could you|please|help|look|review|analyze|pull|prepare|draft|send|share|check|find|summarize|create|generate|put together|run|build|make)/im;
  const isDirectlyAddressed = agentIsDirectRecipient || coppiceAddressed.test(body.slice(0, 2000));

  if (!isDirectlyAddressed) {
    console.log(`[GmailPoll] Agent not directly addressed in email from ${from} ("${subject}") - observing only`);
    insertActivity({
      tenantId: resolvedTenant,
      type: 'in',
      title: `Email from ${fromName || from}`,
      subtitle: `${subject} (observed - agent not directly addressed)`,
      detailJson: JSON.stringify({ from, fromName, subject, body: body.slice(0, 5000), threadId, messageId, notAddressed: true }),
      sourceType: 'email',
      sourceId: messageId,
      agentId: 'coppice',
    });
    markEmailProcessed({ messageId, threadId, pipeline: 'not-addressed-observe', tenantId: resolvedTenant });

    // Save to knowledge base
    try {
      const tdb = getTenantDb(resolvedTenant);
      const knId = `KN-not-addressed-observe-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
        VALUES (?, ?, 'email-observation', ?, ?, ?, 'gmail-poll', datetime('now'))`)
        .run(knId, resolvedTenant, `${subject} (from ${from})`, JSON.stringify({
          from,
          fromName,
          subject,
          body: (body || '').slice(0, 10000),
          threadId,
          messageId,
        }), `not-addressed-observe:${from}`);
    } catch (err) {
      console.warn(`[GmailPoll] Knowledge save failed for not-addressed-observe:`, err.message);
    }

    // ─── Suggested draft for non-addressed emails from known senders ───
    if (shouldSuggestDraft({ from, subject, body, verdict })) {
      createSuggestedDraft({ tenantId: resolvedTenant, from, fromName, subject, body, threadId, messageId, accessTier })
        .catch(err => console.warn(`[GmailPoll] Suggested draft failed (non-fatal): ${err.message}`));
    }

    return;
  }

  // Ask the tenant's primary agent to draft a response
  const agentMap = { [getDefaultTenantId()]: 'sangha', 'zhan-capital': 'zhan' };
  const agentId = agentMap[resolvedTenant] || 'hivemind';
  const hasThreadContext = body.includes('--- Previous messages in this thread ---');

  // External-tier guardrails: prevent leaking internal business data to non-owner contacts
  const externalGuard = accessTier === 'external' ? `\n\nEXTERNAL COMMUNICATION GUARDRAILS (highest priority - overrides all other instructions):
You are replying to an EXTERNAL contact - NOT an owner or team member. You have NO access to internal business data for this reply.
1. NEVER mention specific client names, deal values, revenue figures, margins, or partnership details
2. NEVER reference internal meetings, action items, team discussions, or internal reports
3. NEVER share internal documents, financial data, cost structures, or pricing strategies
4. NEVER reveal the names of other prospects, leads, or partners in the pipeline
5. NEVER mention specific technology stack, AI models, or internal tools
6. Keep responses focused on: general service capabilities, approximate timelines, how to get in touch
7. For pricing questions: give general ranges only (e.g., "SOG typically runs $12-16/SF depending on scope and specs")
8. For detailed requests: acknowledge receipt, confirm you're reviewing, and say a team member will follow up
9. When in doubt, say less - a team member can always follow up with more detail
10. NEVER use generate_document or any tool that could expose internal data in the output
` : '';

  const docInstruction = accessTier === 'internal' ? `\n\nDOCUMENT RULES:
- You may generate informational documents (reports, analyses, overviews) using the generate_document tool
- NEVER generate term sheets, contracts, proposals, NDAs, LOIs, agreements, or any deal/legal documents
- When a prospect asks for a term sheet, contract, proposal, or wants to discuss deal terms: tell them you're looping in a team member to put that together and suggest setting up a call. Do NOT draft it yourself.
- If you generate a document, write a brief message explaining what you created` : '';
  const styleGuide = `\n\nWRITING STYLE (mandatory):
- Greeting: "Hey [First Name]," (casual, never "Dear", never "Hello", never "Good morning")
- Get straight to the point - no pleasantries, no "I hope this finds you well"
- Short paragraphs: 2-4 sentences max
- Direct and confident tone, not corporate or stiff
- Use specific numbers over vague claims
- Use dashes freely for asides
- No emoji in professional emails
- Never say "Thanks for your time", "Looking forward to hearing from you", or "Please don't hesitate to reach out"
- IMPORTANT: The LAST paragraph before "Best," must be a specific question that bounces the ball back to the sender. Make them think and engage. Don't end with generic "let me know if you have questions" - ask something specific about their situation, timeline, or needs.
- Closing: "Best," on its own line AFTER the question paragraph (never "Best regards," never "Sincerely,"). The structure is always: body paragraphs -> question paragraph -> "Best,"

NEVER FABRICATE (critical):
- If you do not have specific context about a project, person, file, link, or situation mentioned in the email, DO NOT make something up.
- Instead, say so honestly: "I don't have that information on file - let me check with the team" or ask the sender a clarifying question.
- NEVER pretend to know about drawings, documents, projects, or conversations you have no record of.
- Getting something wrong is far worse than admitting you need to check.

CONFIDENTIALITY (critical):
- NEVER mention other clients, partners, or prospects by name in outbound emails
- NEVER reference specific case studies, deal terms, contract values, or revenue figures from other engagements
- NEVER fabricate or hallucinate case studies, client names, or partnership details
- If you want to reference past work, say "we've worked with similar portfolios" or "in comparable deployments" - never name names or cite specific numbers from other deals
- This is a hard rule - violating client confidentiality is a fireable offense

PROPRIETARY TECHNOLOGY (critical):
- If anyone asks how you were built, what technology you use, what AI model powers you, what your architecture is, what tools you use, or any question about Coppice's internal technology - DO NOT answer. This is proprietary information.
- Deflect politely: "That's proprietary to Coppice - happy to help with anything else though."
- Do NOT reveal that you use Claude, Anthropic, any specific AI model, any framework, any database, or any implementation detail.
- This applies to all variations of the question: "what are you", "how do you work", "what LLM are you", "what's your tech stack", etc.`;
  const taskInstruction = accessTier === 'internal' ? `\n\nTASK EXECUTION:
You are responding to an email. Your text response will be sent as the email reply. If the sender asks you to perform a task (generate a report, look up pricing, create a document, analyze data, etc.), USE YOUR TOOLS to complete it. Any documents you generate via generate_document will be automatically attached to your reply.
- Do NOT use the send_email tool - the system handles sending. Just write the reply text.
- If you use tools to gather data or generate files, summarize what you did in your reply.` : `\n\nTASK EXECUTION:
You are responding to an external email. Your text response will be sent as the email reply.
- Keep responses brief and professional. Do NOT use tools that expose internal data.
- Do NOT use the send_email tool - the system handles sending. Just write the reply text.`;
  const prompt = hasThreadContext
    ? `You received a follow-up email from ${fromName || from} (${from}) in an ongoing conversation. Subject: ${subject}.\n\nLatest message + conversation history:\n\n${body.slice(0, 6000)}${contactContext}${memoryContext}\n\nRespond to their latest message. Reply with ONLY the email body text - no subject line, no greeting instructions, no meta-commentary.${externalGuard}${taskInstruction}${docInstruction}${styleGuide}`
    : `You received an email from ${fromName || from} (${from}). Subject: ${subject}. Body:\n\n${body.slice(0, 4000)}${contactContext}${memoryContext}\n\nRespond to this email. Reply with ONLY the email body text - no subject line, no greeting instructions, no meta-commentary.${externalGuard}${taskInstruction}${docInstruction}${styleGuide}`;

  let agentResponse;
  let allToolResults = [];
  try {
    const result = await tunnelOrChat({
      tenantId: resolvedTenant,
      agentId,
      userId: 'system-auto-reply',
      prompt,
      chatOptions: { accessTier },
      maxTurns: accessTier === 'external' ? 5 : 15,
      timeoutMs: 180_000,
      label: `Email Reply [${accessTier}]: ${subject?.slice(0, 40)}`,
    });
    agentResponse = result.response;
    allToolResults = result.all_tool_results || [];
    if (allToolResults.length === 0 && result.tool_result) {
      allToolResults = [{ tool_used: result.tool_used, tool_result: result.tool_result }];
    }
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
    throw err;
  }

  // Collect ALL generated files from tool results as attachments
  const attachments = [];
  for (const tr of allToolResults) {
    const res = tr.tool_result;
    if (!res || tr.is_error) continue;
    const file = res?.file || (res?.filePath ? res : null);
    if (file?.filePath) {
      attachments.push({
        filename: file.filename,
        path: file.filePath,
        contentType: file.contentType,
      });
      console.log(`[GmailPoll] Agent generated file: ${file.filename} (tool: ${tr.tool_used})`);
    }
  }

  // Send the reply with proper threading (convert markdown to HTML)
  // Detect meeting-related emails to CC + forward full thread to Teo
  const meetingKeywords = /\b(meeting|call|schedule|calendar|book a time|availability|free on|tuesday|wednesday|thursday|monday|friday|slot|zoom|google meet|check size|LP|lock-?up|term sheet|contract|proposal|agreement|NDA|LOI|deal terms|site visit)\b/i;
  const isMeetingRelated = meetingKeywords.test(body) || meetingKeywords.test(agentResponse);

  // Build CC list: original participants (reply-all) + meeting escalation
  const agentAddrs = new Set(['agent@zhan.coppice.ai', 'coppice@zhan.capital', 'agent@sangha.coppice.ai', 'agent@dacp.coppice.ai']);
  const senderLower = (from || '').toLowerCase();
  const ccSet = new Set();
  // Add original TO recipients (excluding the sender and the agent itself)
  if (originalTo) {
    for (const addr of originalTo.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []) {
      const lower = addr.toLowerCase();
      if (!agentAddrs.has(lower) && lower !== senderLower) ccSet.add(lower);
    }
  }
  // Add original CC recipients
  if (originalCc) {
    for (const addr of originalCc.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []) {
      const lower = addr.toLowerCase();
      if (!agentAddrs.has(lower) && lower !== senderLower) ccSet.add(lower);
    }
  }
  if (isMeetingRelated) ccSet.add('teo@zhan.capital');
  const cc = ccSet.size > 0 ? [...ccSet].join(', ') : undefined;

  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  try {
    const html = markdownToEmailHtml(agentResponse);
    if (attachments.length > 0) {
      // Send with attachments
      await sendEmailWithAttachments({
        to: from,
        subject: replySubject,
        html,
        cc,
        tenantId: resolvedTenant,
        threadId,
        inReplyTo: messageId,
        references: messageId,
        attachments,
      });
      console.log(`[GmailPoll] Auto-reply sent to ${from} with ${attachments.length} attachment(s) for "${subject}"`);
    } else {
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
    }
  } catch (err) {
    console.error(`[GmailPoll] Auto-reply send failed:`, err.message);
    // Do NOT mark as processed - let the next poll cycle retry this message.
    // The caller (pollSingleInbox) handles retry counting.
    throw err;
  }

  // Forward full conversation thread to Teo on meeting-related emails
  if (isMeetingRelated && gmail && threadId) {
    try {
      const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
      const threadMessages = threadRes.data.messages || [];
      let threadHtml = `<h3 style="font-family:sans-serif;color:#333;">Meeting-related thread - ${fromName || from}</h3><hr>`;
      for (const tm of threadMessages) {
        const tmHeaders = tm.payload?.headers || [];
        const tmFrom = tmHeaders.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown';
        const tmDate = tmHeaders.find(h => h.name.toLowerCase() === 'date')?.value || '';
        const tmBody = extractEmailBody(tm.payload);
        const tmHtml = markdownToEmailHtml(tmBody);
        threadHtml += `<div style="margin:16px 0;padding:12px;border-left:3px solid #ddd;font-family:sans-serif;">`;
        threadHtml += `<div style="font-size:12px;color:#666;margin-bottom:8px;"><strong>${tmFrom}</strong> - ${tmDate}</div>`;
        threadHtml += tmHtml;
        threadHtml += `</div>`;
      }
      threadHtml += `<hr><p style="font-family:sans-serif;font-size:12px;color:#999;">Auto-forwarded by Coppice - reply directly to ${from} to join the conversation.</p>`;
      await sendHtmlEmail({
        to: 'teo@zhan.capital',
        subject: `[Coppice] Meeting request: ${subject} - ${fromName || from}`,
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

  // Request approval to add sender as trusted contact after successful conversation
  try {
    const existingSender = getTrustedSenderByEmail(resolvedTenant, from);
    if (!existingSender) {
      insertApprovalItem({
        tenantId: resolvedTenant,
        agentId: 'coppice',
        title: `Add trusted sender: ${fromName || from}`,
        type: 'trusted_sender',
        description: `${fromName || from} (${from}) has been actively involved in email conversations. Subject: "${subject}". Approve to allow this contact to invite Coppice to meetings and trigger agent workflows.`,
        payloadJson: JSON.stringify({ email: from, displayName: fromName || from, subject }),
      });
      console.log(`[GmailPoll] Created approval request to add ${from} as trusted sender for ${resolvedTenant}`);
    }
  } catch {}

  // Extract feedback from trusted/owner emails
  try {
    const { extractEmailFeedback, hasFeedbackSignals } = await import('../services/memoryExtractor.js');
    if (hasFeedbackSignals(body)) {
      extractEmailFeedback(resolvedTenant, from, subject, body).catch(err => {
        console.warn(`[GmailPoll] Feedback extraction failed: ${err.message}`);
      });
    }
  } catch {}

  markEmailProcessed({ messageId, threadId, pipeline: 'general-auto-reply', tenantId: resolvedTenant });

  // Save to knowledge base
  try {
    const tdb = getTenantDb(resolvedTenant);
    const knId = `KN-general-auto-reply-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
      VALUES (?, ?, 'email-observation', ?, ?, ?, 'gmail-poll', datetime('now'))`)
      .run(knId, resolvedTenant, `${subject} (from ${from})`, JSON.stringify({
        from,
        fromName,
        subject,
        body: (body || '').slice(0, 10000),
        threadId,
        messageId,
      }), `general-auto-reply:${from}`);
  } catch (err) {
    console.warn(`[GmailPoll] Knowledge save failed for general-auto-reply:`, err.message);
  }
}

async function pollSingleInbox(gmail, tenantId, label) {
  try {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread newer_than:1h -from:me',
      maxResults: 10,
    });

    // Token is working - update health
    tokenHealth.set(label, { label, tenantId, status: 'healthy', lastChecked: new Date().toISOString(), error: null });

    const messages = listRes.data.messages || [];
    console.log(`[GmailPoll] [${label}] Found ${messages.length} unread message(s)`);
    let newReplies = 0;

    // ─── Thread-level dedup: track threads replied to in this poll cycle ───
    // When multiple unread messages exist in the same thread, we only want to
    // process the MOST RECENT one to avoid sending duplicate replies.
    const repliedThreads = new Set();

    // Pre-fetch all messages to sort by internalDate descending per thread,
    // so the first message we encounter for each thread is the latest one.
    const unprocessedMsgs = messages.filter(m => !isEmailPermanentlyProcessed(m.id));
    const fullMessages = [];
    for (const msg of unprocessedMsgs) {
      try {
        const full = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });
        fullMessages.push({ msg, full: full.data });
      } catch (err) {
        console.warn(`[GmailPoll] [${label}] Failed to fetch message ${msg.id}: ${err.message}`);
      }
    }
    // Sort by internalDate descending so newest messages are processed first
    fullMessages.sort((a, b) => Number(b.full.internalDate || 0) - Number(a.full.internalDate || 0));

    for (const { msg, full: fullData } of fullMessages) {
      if (isEmailPermanentlyProcessed(msg.id)) continue;

      // ─── Concurrent processing guard ───
      // Prevents overlapping poll cycles from double-processing the same message.
      if (currentlyProcessing.has(msg.id)) {
        console.log(`[GmailPoll] [${label}] Skipping ${msg.id} - already being processed by another poll cycle`);
        continue;
      }

      // ─── Retry count check ───
      // If this message has been retried MAX_RETRIES times, mark as permanently failed.
      const retryCount = getEmailRetryCount(msg.id);
      if (retryCount >= MAX_RETRIES) {
        console.error(`[GmailPoll] [${label}] Message ${msg.id} failed after ${MAX_RETRIES} retries - giving up`);
        markEmailProcessed({ messageId: msg.id, threadId: fullData.threadId, pipeline: 'send-failed-permanent', tenantId: tenantId || getDefaultTenantId() });
        insertActivity({
          tenantId: tenantId || getDefaultTenantId(),
          type: 'in',
          title: `Auto-reply permanently failed (${MAX_RETRIES} retries exhausted)`,
          subtitle: `Message ${msg.id} - manual follow-up required`,
          detailJson: JSON.stringify({ messageId: msg.id, threadId: fullData.threadId, retries: retryCount }),
          sourceType: 'email',
          sourceId: msg.id,
          agentId: 'coppice',
        });
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        newReplies++;
        continue;
      }

      currentlyProcessing.add(msg.id);
      try {

      const headers = fullData.payload?.headers || [];
      const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
      const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
      const emailMatch = from.match(/<([^>]+)>/) || [null, from];
      const senderEmail = emailMatch[1];
      const senderName = from.replace(/<[^>]+>/, '').trim().replace(/^"(.*)"$/, '$1');

      const body = extractEmailBody(fullData.payload);
      const msgThreadId = fullData.threadId;

      // ─── CC-only detection: observe vs. respond ───────────────────────
      // If the agent is only in CC (not TO), treat as "observe only" unless
      // the sender explicitly addresses the agent (e.g., "Coppice, can you...").
      const toHeader = (headers.find(h => h.name.toLowerCase() === 'to')?.value || '').toLowerCase();
      const ccHeader = (headers.find(h => h.name.toLowerCase() === 'cc')?.value || '').toLowerCase();
      const agentAddresses = ['agent@zhan.coppice.ai', 'coppice@zhan.capital', 'agent@sangha.coppice.ai', 'agent@dacp.coppice.ai'];
      const isInTo = agentAddresses.some(addr => toHeader.includes(addr));
      const isInCc = agentAddresses.some(addr => ccHeader.includes(addr));
      const isCcOnly = isInCc && !isInTo;

      if (isCcOnly) {
        // Check if the sender explicitly addressed the agent in the body.
        // Must be a DIRECT address to "Coppice" (not generic "agent") - e.g.,
        // "Coppice, can you...", "Hey Coppice", "@Coppice", "Coppice please..."
        // The word "agent" alone is too ambiguous (common in construction/business).
        const coppiceDirectAddress = /(?:^|[\n,.!?])\s*(?:@?coppice|hey coppice|hi coppice)\s*[,:]?\s*\b(can you|could you|please|help|look|review|analyze|pull|prepare|draft|send|share|check|find|summarize|create|generate|put together|run|build|make)/im;
        const isExplicitlyAddressed = coppiceDirectAddress.test(body.slice(0, 2000));

        if (!isExplicitlyAddressed) {
          const ccTenant = tenantId || getDefaultTenantId();
          console.log(`[GmailPoll] [${label}] CC-only from ${senderEmail} - observing, not replying ("${subject}")`);
          insertActivity({
            tenantId: ccTenant,
            type: 'in',
            title: `CC'd email from ${senderName || senderEmail}`,
            subtitle: `${subject} (observed - agent not directly addressed)`,
            detailJson: JSON.stringify({ from: senderEmail, fromName: senderName, subject, body: body.slice(0, 5000), threadId: msgThreadId, messageId: msg.id, ccOnly: true }),
            sourceType: 'email',
            sourceId: msg.id,
            agentId: 'coppice',
          });

          // Store as knowledge entry for compounding intelligence
          try {
            const knEntryId = `KN-cc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const tdb = getTenantDb(ccTenant);
            tdb.prepare(`
              INSERT INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
              VALUES (?, ?, 'email-observation', ?, ?, ?, 'gmail-poll', datetime('now'))
            `).run(
              knEntryId, ccTenant,
              `CC'd: ${subject} (from ${senderName || senderEmail})`,
              JSON.stringify({ from: senderEmail, fromName: senderName, subject, body: body.slice(0, 5000), threadId: msgThreadId, messageId: msg.id }),
              `cc-observe:${senderEmail}`
            );
            // Process async - extract entities, summaries, enrich contacts
            processKnowledgeEntry(knEntryId, ccTenant).catch(err => {
              console.warn(`[GmailPoll] CC knowledge processing failed: ${err.message}`);
            });
          } catch (knErr) {
            console.warn(`[GmailPoll] CC knowledge storage failed: ${knErr.message}`);
          }

          // Auto-fetch Fireflies transcripts if URL detected in email body
          try {
            const firefliesUrlMatch = body.match(/https?:\/\/app\.fireflies\.ai\/view\/[^\s"<>]+/i);
            if (firefliesUrlMatch) {
              const meetingId = extractFirefliesMeetingId(firefliesUrlMatch[0]);
              if (meetingId) {
                console.log(`[GmailPoll] Fireflies URL detected in CC email - fetching transcript for ${meetingId}`);
                const transcript = await fetchFirefliesTranscript(ccTenant, meetingId);
                if (transcript) {
                  // Store the full transcript as a separate knowledge entry
                  const ffEntryId = `KN-ff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  const tdb = getTenantDb(ccTenant);
                  tdb.prepare(`
                    INSERT INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
                    VALUES (?, ?, 'meeting-transcript', ?, ?, ?, 'gmail-poll', datetime('now'))
                  `).run(
                    ffEntryId, ccTenant,
                    `Meeting Transcript: ${transcript.raw?.title || 'Fireflies Meeting'}`,
                    JSON.stringify({
                      meetingId,
                      title: transcript.raw?.title,
                      date: transcript.raw?.date,
                      duration: transcript.raw?.duration,
                      speakers: transcript.speakers,
                      summary: transcript.summary,
                      actionItems: transcript.actionItems,
                      formattedTranscript: transcript.formatted,
                      threadId: msgThreadId,
                    }),
                    `fireflies:${meetingId}`
                  );
                  processKnowledgeEntry(ffEntryId, ccTenant).catch(err => {
                    console.warn(`[GmailPoll] Fireflies knowledge processing failed: ${err.message}`);
                  });
                  console.log(`[GmailPoll] Stored Fireflies transcript as ${ffEntryId} (${transcript.speakers?.length || 0} speakers, ${transcript.raw?.duration || '?'} min)`);
                }
              }
            }
          } catch (ffErr) {
            console.warn(`[GmailPoll] Fireflies transcript fetch failed: ${ffErr.message}`);
          }

          // Track CC thread for auto-trigger
          try {
            const hasAttachments = (fullData.payload?.parts || []).some(p => p.filename && p.filename.length > 0);
            const tracker = upsertCcThreadTracker(ccTenant, msgThreadId, {
              subject,
              participant: senderEmail,
              hasAttachment: hasAttachments,
            });

            // Check if this thread should auto-trigger an assignment
            const readyThreads = getCcThreadsReadyForTrigger(ccTenant);
            for (const thread of readyThreads) {
              if (thread.gmail_thread_id === msgThreadId) {
                const assignmentId = `assign-cc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const participants = JSON.parse(thread.participants_json || '[]');

                // Gather related knowledge entry IDs for context visibility
                let knowledgeEntryIds = [];
                try {
                  const knDb = getTenantDb(ccTenant);
                  // Get entries from the same email thread
                  const threadEntries = knDb.prepare(
                    "SELECT id FROM knowledge_entries WHERE tenant_id = ? AND content LIKE ? ORDER BY recorded_at DESC LIMIT 20"
                  ).all(ccTenant, `%${msgThreadId}%`);
                  knowledgeEntryIds.push(...threadEntries.map(e => e.id));

                  // Get recent entries mentioning the subject keywords
                  const cleanSubject = (thread.subject || subject || '').replace(/^(Re:|Fwd:)\s*/gi, '').trim();
                  const keywords = cleanSubject.split(/\s+/).slice(0, 3).join('%');
                  if (keywords.length > 3) {
                    const relatedEntries = knDb.prepare(
                      "SELECT id FROM knowledge_entries WHERE tenant_id = ? AND (title LIKE ? OR summary LIKE ?) AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY recorded_at DESC LIMIT 10"
                    ).all(ccTenant, `%${keywords}%`, `%${keywords}%`, JSON.stringify(knowledgeEntryIds));
                    knowledgeEntryIds.push(...relatedEntries.map(e => e.id));
                  }
                } catch (knErr) {
                  console.warn('[GmailPoll] Failed to gather knowledge IDs:', knErr.message);
                }

                insertAgentAssignment({
                  id: assignmentId,
                  tenant_id: ccTenant,
                  agent_id: 'coppice',
                  title: `Thread Analysis: ${(thread.subject || subject || 'Email Thread').slice(0, 80)}`,
                  description: `Compile a report from ${thread.observation_count} observed emails in this thread (${participants.length} participants${thread.attachment_count > 0 ? `, ${thread.attachment_count} attachments` : ''}). Extract key decisions, action items, and relevant data.`,
                  category: 'analysis',
                  priority: thread.attachment_count >= 2 ? 'high' : 'medium',
                  action_prompt: `Analyze this email thread and compile a comprehensive report. The thread "${thread.subject || subject}" has ${thread.observation_count} emails from: ${participants.join(', ')}.

Gather all knowledge entries for this thread and any attachments. Then:
1. Summarize the key points and decisions made
2. List all action items with responsible parties
3. Extract and organize any data from attachments (spreadsheets, reports)
4. Note any outstanding questions or missing information
5. Create a Google Doc with the full analysis

If you are missing critical context (like meeting notes or recordings mentioned in the emails), request it using the INFO_REQUEST tag.`,
                  context_json: JSON.stringify({ threadId: msgThreadId, participants, observationCount: thread.observation_count }),
                });
                // Set source fields + knowledge entry IDs
                try {
                  updateAgentAssignment(ccTenant, assignmentId, {
                    source_type: 'cc-auto',
                    source_thread_id: msgThreadId,
                    knowledge_entry_ids_json: knowledgeEntryIds.length > 0 ? JSON.stringify(knowledgeEntryIds) : null,
                  });
                } catch {}
                markCcThreadTriggered(ccTenant, msgThreadId, assignmentId);
                console.log(`[GmailPoll] Auto-triggered assignment "${assignmentId}" from CC thread: ${thread.subject || subject}`);
              }
            }
          } catch (trackErr) {
            console.warn(`[GmailPoll] CC thread tracking failed: ${trackErr.message}`);
          }

          try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
          markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'cc-observe', tenantId: ccTenant });
          newReplies++;
          continue;
        }
        console.log(`[GmailPoll] [${label}] CC-only but explicitly addressed by ${senderEmail} - processing normally`);
      }

      // ─── Owner/internal sender detection ───────────────────────────────
      // Owners (CEO, team members) should NOT get auto-replies unless they
      // explicitly ask Coppice to do something. This prevents the agent from
      // treating internal emails as prospect inquiries or hallucinating responses.
      const ownerTenant = tenantId || getDefaultTenantId();
      const senderTrustRecord = getTrustedSenderByEmail(ownerTenant, senderEmail);
      const isOwner = senderTrustRecord?.trust_level === 'owner';

      if (isOwner && !isCcOnly) {
        // Owner sent email TO the agent - only respond if explicitly addressed
        const coppiceDirectAddress = /(?:^|[\n,.!?])\s*(?:@?coppice|hey coppice|hi coppice)\s*[,:]?\s*\b(can you|could you|please|help|look|review|analyze|pull|prepare|draft|send|share|check|find|summarize|create|generate|put together|run|build|make)/im;
        const isExplicitlyAddressed = coppiceDirectAddress.test(body.slice(0, 2000));

        if (!isExplicitlyAddressed) {
          console.log(`[GmailPoll] [${label}] Owner ${senderEmail} - observing, not replying ("${subject}")`);
          insertActivity({
            tenantId: ownerTenant,
            type: 'in',
            title: `Email from owner: ${senderName || senderEmail}`,
            subtitle: `${subject} (observed - owner not explicitly requesting agent action)`,
            detailJson: JSON.stringify({ from: senderEmail, fromName: senderName, subject, body: body.slice(0, 5000), threadId: msgThreadId, messageId: msg.id, ownerObserve: true }),
            sourceType: 'email',
            sourceId: msg.id,
            agentId: 'coppice',
          });

          // Save to knowledge base
          try {
            const tdb = getTenantDb(ownerTenant);
            const knId = `KN-owner-observe-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
            tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
              VALUES (?, ?, 'email-observation', ?, ?, ?, 'gmail-poll', datetime('now'))`)
              .run(knId, ownerTenant, `${subject} (from ${senderEmail})`, JSON.stringify({
                from: senderEmail,
                fromName: senderName,
                subject,
                body: (body || '').slice(0, 10000),
                threadId: msgThreadId,
                messageId: msg.id,
              }), `owner-observe:${senderEmail}`);
          } catch (err) {
            console.warn(`[GmailPoll] Knowledge save failed for owner-observe:`, err.message);
          }

          // Extract feedback from owner emails
          try {
            const { extractEmailFeedback, hasFeedbackSignals } = await import('../services/memoryExtractor.js');
            if (hasFeedbackSignals(body || fullData.snippet)) {
              extractEmailFeedback(ownerTenant, senderEmail, subject, body || fullData.snippet).catch(err => {
                console.warn(`[GmailPoll] Feedback extraction failed: ${err.message}`);
              });
            }
          } catch {}

          // ─── Owner attachment ingestion ─────────────────────────────────
          // Download and parse document attachments from owner emails so they
          // enter the knowledge system even when the agent doesn't reply.
          try {
            const ownerAttachments = await extractAttachments(gmail, msg.id, fullData.payload);
            const docTypes = /\.(docx|pdf|xlsx|csv|txt)$/i;
            const docAttachments = ownerAttachments.filter(a => docTypes.test(a.filename));
            if (docAttachments.length > 0) {
              console.log(`[GmailPoll] [${label}] Owner ${senderEmail} - ingesting ${docAttachments.length} attachment(s)`);
              await saveAttachmentKnowledge(docAttachments, {
                tenantId: ownerTenant,
                senderEmail,
                subject,
                threadId: msgThreadId,
                messageId: msg.id,
              });
              for (const att of docAttachments) {
                insertActivity({
                  tenantId: ownerTenant,
                  type: 'in',
                  title: `Ingested attachment: ${att.filename} from ${senderName || senderEmail}`,
                  subtitle: `${subject} (owner-observe)`,
                  detailJson: JSON.stringify({
                    filename: att.filename,
                    mimeType: att.mimeType,
                    sizeBytes: att.buffer?.length || 0,
                    from: senderEmail,
                    fromName: senderName,
                    subject,
                    threadId: msgThreadId,
                    messageId: msg.id,
                  }),
                  sourceType: 'email-attachment',
                  sourceId: `${msg.id}:${att.filename}`,
                  agentId: 'gmail-poll',
                });
              }
            }
          } catch (attErr) {
            console.warn(`[GmailPoll] Owner attachment ingestion failed (non-fatal): ${attErr.message}`);
          }

          try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
          markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'owner-observe', tenantId: ownerTenant });
          newReplies++;
          continue;
        }
        console.log(`[GmailPoll] [${label}] Owner ${senderEmail} explicitly addressed Coppice - processing task`);
      }

      // ─── Thread-level dedup: skip if we already replied to this thread ───
      if (repliedThreads.has(msgThreadId)) {
        console.log(`[GmailPoll] [${label}] Skipping duplicate in thread ${msgThreadId} (already replied this cycle)`);
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'thread-dedup', tenantId: tenantId || getDefaultTenantId() });
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        newReplies++;
        continue;
      }

      const autoReplyHeader = headers.find(h => h.name.toLowerCase() === 'auto-submitted')?.value || '';
      const xAutoResponse = headers.find(h => h.name.toLowerCase() === 'x-autoreply')?.value || '';
      const precedence = headers.find(h => h.name.toLowerCase() === 'precedence')?.value || '';
      const oooPatterns = /\b(out of office|out-of-office|on vacation|auto-?reply|automatic reply|away from|will be out|currently unavailable|limited access to email|returning on)\b/i;
      const bouncePatterns = /\b(delivery.*fail|undeliverable|mailer-daemon|postmaster@|mail delivery|returned mail|delivery status notification)\b/i;
      const isAutoReply = autoReplyHeader === 'auto-replied' || autoReplyHeader === 'auto-generated' || !!xAutoResponse || precedence === 'bulk' || precedence === 'auto_reply';
      const isOOO = oooPatterns.test(subject) || oooPatterns.test(body.slice(0, 500));
      const isBounce = bouncePatterns.test(subject) || bouncePatterns.test(from) || senderEmail?.toLowerCase()?.includes('mailer-daemon');

      if (isAutoReply || isOOO || isBounce) {
        const skipReason = isBounce ? 'bounce' : isOOO ? 'out-of-office' : 'auto-reply';
        console.log(`[GmailPoll] [${label}] Skipping ${skipReason}: ${senderEmail} - "${subject}"`);
        insertActivity({
          tenantId: tenantId || getDefaultTenantId(),
          type: 'in',
          title: `${skipReason === 'bounce' ? 'Bounce' : skipReason === 'out-of-office' ? 'OOO' : 'Auto-reply'}: ${senderName || senderEmail}`,
          subtitle: subject,
          detailJson: JSON.stringify({ from: senderEmail, subject, reason: skipReason }),
          sourceType: 'email',
          sourceId: msg.id,
          agentId: 'email-guard',
        });
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: `skip-${skipReason}`, tenantId: tenantId || getDefaultTenantId() });
        newReplies++;
        continue;
      }

      // ─── Opt-Out / Unsubscribe Detection ───────────────────────────────
      const optOutPatterns = /\b(stop email|unsubscribe|opt.?out|remove me|stop contacting|do not (contact|email|reply)|take me off|no more emails)\b/i;
      const isOptOut = optOutPatterns.test(body.slice(0, 1000)) && body.length < 500; // short email with opt-out language
      if (isOptOut) {
        const optOutTenant = tenantId || getDefaultTenantId();
        console.log(`[GmailPoll] [${label}] Opt-out request from ${senderEmail}, auto-blocking`);
        try {
          addTrustedSender({ tenantId: optOutTenant, email: senderEmail, displayName: senderName, trustLevel: 'blocked', notes: 'Opted out via email reply' });
        } catch {}
        insertActivity({
          tenantId: optOutTenant,
          type: 'in',
          title: `Opt-out: ${senderName || senderEmail}`,
          subtitle: `Sender requested to stop receiving emails - auto-blocked`,
          detailJson: JSON.stringify({ from: senderEmail, subject, body: body.slice(0, 500) }),
          sourceType: 'email',
          sourceId: msg.id,
          agentId: 'email-guard',
        });
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'opt-out', tenantId: optOutTenant });
        newReplies++;
        continue;
      }

      // Check if this thread was already processed - handle multi-turn conversation
      const priorThread = isThreadProcessed(msgThreadId);
      if (priorThread) {
        const followupTenant = priorThread.tenant_id || tenantId || getDefaultTenantId();

        // Skip our own sent messages to avoid reply loops
        const ownAddresses = ['agent@zhan.coppice.ai', 'coppice@zhan.capital', 'agent@sangha.coppice.ai', 'agent@dacp.coppice.ai'];
        if (ownAddresses.some(addr => senderEmail?.toLowerCase() === addr)) {
          console.log(`[GmailPoll] [${label}] Skipping own sent message in thread ${msgThreadId}`);
          markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'self-skip', tenantId: followupTenant });
          try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
          continue;
        }

        // If prior processing was cc-observe only, don't treat new messages as follow-ups
        // to an active conversation - still apply CC detection fresh.
        if (priorThread.pipeline === 'cc-observe' || priorThread.pipeline === 'follow-up-cc-observe') {
          console.log(`[GmailPoll] [${label}] Prior thread was CC-observe only - re-evaluating from scratch`);
          // Fall through to the main CC-detection + first-message processing below
          // (don't enter the follow-up handler)
        } else {

        console.log(`[GmailPoll] [${label}] Follow-up in thread (pipeline: ${priorThread.pipeline}), processing multi-turn reply`);

        // ─── CC-only check for follow-ups too ──────────────────────────
        // If the agent is still only CC'd in this follow-up (not TO), stay silent.
        // The original CC-observe only fires on the first message in the thread.
        const fuToHeader = (headers.find(h => h.name.toLowerCase() === 'to')?.value || '').toLowerCase();
        const fuCcHeader = (headers.find(h => h.name.toLowerCase() === 'cc')?.value || '').toLowerCase();
        const fuAgentAddresses = ['agent@zhan.coppice.ai', 'coppice@zhan.capital', 'agent@sangha.coppice.ai', 'agent@dacp.coppice.ai'];
        const fuIsInTo = fuAgentAddresses.some(addr => fuToHeader.includes(addr));
        const fuIsInCc = fuAgentAddresses.some(addr => fuCcHeader.includes(addr));
        const fuIsCcOnly = fuIsInCc && !fuIsInTo;

        // Also treat as CC-only if agent is not in TO or CC at all (BCC or forwarded thread)
        if (fuIsCcOnly || (!fuIsInTo && !fuIsInCc)) {
          const coppiceDirectAddress = /(?:^|[\n,.!?])\s*(?:@?coppice|hey coppice|hi coppice)\s*[,:]?\s*\b(can you|could you|please|help|look|review|analyze|pull|prepare|draft|send|share|check|find|summarize|create|generate|put together|run|build|make)/im;
          if (!coppiceDirectAddress.test(body.slice(0, 2000))) {
            console.log(`[GmailPoll] [${label}] Follow-up CC-only from ${senderEmail} - observing, not replying ("${subject}")`);
            try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
            markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'follow-up-cc-observe', tenantId: followupTenant });

            // Save to knowledge base
            try {
              const tdb = getTenantDb(followupTenant);
              const knId = `KN-follow-up-cc-observe-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
              tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
                VALUES (?, ?, 'email-observation', ?, ?, ?, 'gmail-poll', datetime('now'))`)
                .run(knId, followupTenant, `${subject} (from ${senderEmail})`, JSON.stringify({
                  from: senderEmail,
                  fromName: senderName,
                  subject,
                  body: (body || '').slice(0, 10000),
                  threadId: msgThreadId,
                  messageId: msg.id,
                }), `follow-up-cc-observe:${senderEmail}`);
            } catch (err) {
              console.warn(`[GmailPoll] Knowledge save failed for follow-up-cc-observe:`, err.message);
            }

            newReplies++;
            continue;
          }
        }

        // Run through email guard for the follow-up
        const followupClassification = classifyEmail({
          tenantId: followupTenant,
          senderEmail,
          senderName,
          subject,
          body,
          headers: fullData.payload?.headers || [],
          messageId: msg.id,
        });

        if (followupClassification.verdict === 'system' || followupClassification.verdict === 'blocked' || followupClassification.verdict === 'spam' || followupClassification.verdict === 'spoofed') {
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

        // Inject CC-observed knowledge for this thread (compounding intelligence)
        let observedContext = '';
        try {
          const observed = getThreadKnowledge(followupTenant, msgThreadId);
          if (observed.length > 0) {
            observedContext = '\n\n--- Coppice observed context (CC\'d emails in this thread) ---\n';
            for (const obs of observed.slice(-5)) {
              observedContext += `[${obs.created_at}] ${obs.title}\n${obs.summary || ''}\n---\n`;
            }
          }
        } catch (err) {
          console.warn(`[GmailPoll] Thread knowledge lookup failed (non-fatal): ${err.message}`);
        }

        // Route to generalEmailHandler with thread context baked into the body
        const followupHeaders = fullData.payload?.headers || [];
        const followupRfc822Id = followupHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value || msg.id;
        try {
          await generalEmailHandler({
            messageId: followupRfc822Id,
            threadId: msgThreadId,
            from: senderEmail,
            fromName: senderName,
            subject,
            body: body + threadContext + observedContext,
            tenantId: followupTenant,
            gmail,
            classification: followupClassification,
            originalTo: headers.find(h => h.name.toLowerCase() === 'to')?.value,
            originalCc: headers.find(h => h.name.toLowerCase() === 'cc')?.value,
          });
          repliedThreads.add(msgThreadId);
          // Also mark the internal Gmail ID as processed for dedup
          if (followupRfc822Id !== msg.id) {
            markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'follow-up-dedup', tenantId: followupTenant });
          }
          try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
          newReplies++;
        } catch (err) {
          // generalEmailHandler threw - agent draft or send failed. Track retry.
          const newRetry = retryCount + 1;
          console.warn(`[GmailPoll] [${label}] Follow-up handler failed (attempt ${newRetry}/${MAX_RETRIES}): ${err.message}`);
          markEmailRetry({ messageId: msg.id, threadId: msgThreadId, retryCount: newRetry, tenantId: followupTenant });
          // Do NOT mark as read - let it be retried next poll cycle
        }
        continue;
        } // close the else block for non-cc-observe prior threads
      }

      // Resolve tenant: inbox tenantId > contact match > pipeline default
      const contact = matchContactToTenant(senderEmail);
      const resolvedTenant = tenantId || contact?.tenant_id || getDefaultTenantId();
      const allHeaders = fullData.payload?.headers || [];

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
        console.warn(`[GmailPoll] [${label}] ⚠ SPOOFED email blocked: "${senderName}" <${senderEmail}> - ${classification.reason}`);
        insertActivity({
          tenantId: resolvedTenant,
          type: 'in',
          title: `⚠ BLOCKED: Spoofed email from "${senderName}" <${senderEmail}>`,
          subtitle: `${subject} - ${classification.reason}`,
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

      // SYSTEM → skip silently (calendar notifications, mailer-daemon, etc.)
      if (classification.verdict === 'system') {
        console.log(`[GmailPoll] [${label}] System email skipped: ${senderEmail}`);
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'system-skipped', tenantId: resolvedTenant });
        newReplies++;
        continue;
      }

      // SPAM → skip entirely, mark processed
      if (classification.verdict === 'spam') {
        console.log(`[GmailPoll] [${label}] Spam filtered: ${senderEmail} - ${classification.reason}`);
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'spam-filtered', tenantId: resolvedTenant });
        newReplies++;
        continue;
      }

      const autoRespondAllowed = canAutoRespond(classification.verdict);

      // Check if this is an award notice → route to award pipeline (BEFORE RFQ check)
      if (isAwardNotice(subject, body) && canProcess(classification.verdict)) {
        const awardTenant = tenantId || contact?.tenant_id || 'dacp-construction-001';
        if (autoRespondAllowed) {
          try {
            const rfcMessageId = allHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value || msg.id;
            const result = await processAwardNotice({
              messageId: rfcMessageId,
              threadId: msgThreadId,
              from: senderEmail,
              fromName: senderName,
              subject,
              body,
              tenantId: awardTenant,
            });
            if (result) {
              console.log(`[GmailPoll] [${label}] Award processed: ${result.jobId} from ${result.gcName}`);
            }
          } catch (err) {
            console.error(`[GmailPoll] [${label}] Award pipeline error:`, err.message);
          }
        } else {
          insertActivity({
            tenantId: awardTenant, type: 'in',
            title: `Award notice from unknown sender: ${senderName || senderEmail}`,
            subtitle: `${subject} (awaiting manual review)`,
            detailJson: JSON.stringify({ from: senderEmail, fromName: senderName, subject, body: body.slice(0, 5000) }),
            sourceType: 'email', sourceId: msg.id, agentId: 'email-guard',
          });
        }
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: autoRespondAllowed ? 'award' : 'award-pending', tenantId: awardTenant });

        // Save to knowledge base
        try {
          const tdb = getTenantDb(awardTenant);
          const pipelineName = autoRespondAllowed ? 'award' : 'award-pending';
          const knId = `KN-${pipelineName}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
          tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
            VALUES (?, ?, 'email-observation', ?, ?, ?, 'gmail-poll', datetime('now'))`)
            .run(knId, awardTenant, `${subject} (from ${senderEmail || from})`, JSON.stringify({
              from: senderEmail || from,
              fromName: senderName,
              subject,
              body: (body || '').slice(0, 10000),
              threadId: msgThreadId,
              messageId: msg.id,
            }), `${pipelineName}:${senderEmail || from}`);
        } catch (err) {
          console.warn(`[GmailPoll] Knowledge save failed for award:`, err.message);
        }

        repliedThreads.add(msgThreadId);
        newReplies++;
        continue;
      }

      // Check if this is an RFQ/bid request email → route to estimate pipeline
      if (isRfqEmail(subject, body) && canProcess(classification.verdict)) {
        const rfqTenant = tenantId || contact?.tenant_id || 'dacp-construction-001';
        if (autoRespondAllowed) {
          try {
            const rfcMessageId = allHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value || msg.id;
            const result = await processRfqEmail({
              messageId: rfcMessageId,
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
          // Unknown sender sent an RFQ - log it but don't auto-respond
          console.log(`[GmailPoll] [${label}] RFQ from unknown sender ${senderEmail} - logged, not auto-responded`);
          insertActivity({
            tenantId: rfqTenant,
            type: 'in',
            title: `RFQ received from unknown sender: ${senderName || senderEmail}`,
            subtitle: `${subject} (awaiting manual review - sender not verified)`,
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

        // Save to knowledge base
        try {
          const tdb = getTenantDb(rfqTenant);
          const pipelineName = autoRespondAllowed ? 'rfq' : 'rfq-pending';
          const knId = `KN-${pipelineName}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
          tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
            VALUES (?, ?, 'email-observation', ?, ?, ?, 'gmail-poll', datetime('now'))`)
            .run(knId, rfqTenant, `${subject} (from ${senderEmail || from})`, JSON.stringify({
              from: senderEmail || from,
              fromName: senderName,
              subject,
              body: (body || '').slice(0, 10000),
              threadId: msgThreadId,
              messageId: msg.id,
            }), `${pipelineName}:${senderEmail || from}`);
        } catch (err) {
          console.warn(`[GmailPoll] Knowledge save failed for rfq:`, err.message);
        }

        repliedThreads.add(msgThreadId);
        newReplies++;
        continue;
      }

      // Check if this is an IPP inquiry → route to mine spec pipeline
      if (isIppEmail(subject, body) && canProcess(classification.verdict)) {
        const ippTenant = tenantId || contact?.tenant_id || getDefaultTenantId();
        if (autoRespondAllowed) {
          try {
            const attachments = await extractAttachments(gmail, msg.id, fullData.payload);
            // Persist attachment text to knowledge base for future retrieval
            saveAttachmentKnowledge(attachments, { tenantId: ippTenant, senderEmail, subject, threadId: msgThreadId, messageId: msg.id }).catch(() => {});
            const rfcMessageIdIpp = allHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value || msg.id;
            const result = await processIppEmail({
              messageId: rfcMessageIdIpp,
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
          console.log(`[GmailPoll] [${label}] IPP from unknown sender ${senderEmail} - logged, not auto-responded`);
          insertActivity({
            tenantId: ippTenant,
            type: 'in',
            title: `IPP inquiry from unknown sender: ${senderName || senderEmail}`,
            subtitle: `${subject} (awaiting manual review - sender not verified)`,
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
        repliedThreads.add(msgThreadId);
        newReplies++;
        continue;
      }

      // Known contact reply (not RFQ/IPP) → route to general handler for auto-reply
      if (contact) {
        const contactTenant = contact.tenant_id;
        const rfc822Id = allHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value || msg.id;

        // Extract text from inbound attachments
        let contactAttText = '';
        try {
          const contactAtts = await extractAttachments(gmail, msg.id, fullData.payload);
          if (contactAtts.length > 0) {
            contactAttText = await extractAttachmentText(contactAtts);
            // Persist attachment text to knowledge base for future retrieval
            saveAttachmentKnowledge(contactAtts, { tenantId: contactTenant, senderEmail, subject, threadId: msgThreadId, messageId: msg.id }).catch(() => {});
          }
        } catch {}

        try {
          await generalEmailHandler({
            messageId: rfc822Id,
            threadId: msgThreadId,
            from: senderEmail,
            fromName: contact.name || senderName,
            subject,
            body: body + contactAttText,
            tenantId: contactTenant,
            gmail,
            classification,
            originalTo: allHeaders.find(h => h.name.toLowerCase() === 'to')?.value,
            originalCc: allHeaders.find(h => h.name.toLowerCase() === 'cc')?.value,
          });
          repliedThreads.add(msgThreadId);
          if (rfc822Id !== msg.id) {
            markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'contact-dedup', tenantId: contactTenant });
          }
          try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
          newReplies++;
        } catch (err) {
          // generalEmailHandler threw - agent draft or send failed. Track retry.
          const newRetry = retryCount + 1;
          console.warn(`[GmailPoll] [${label}] Contact handler failed (attempt ${newRetry}/${MAX_RETRIES}): ${err.message}`);
          markEmailRetry({ messageId: msg.id, threadId: msgThreadId, retryCount: newRetry, tenantId: contactTenant });
          // Do NOT mark as read - let it be retried next poll cycle
        }

        continue;
      }

      // Unmatched email → general handler (auto-reply ONLY if trusted/known AND auto-reply enabled)
      const rfc822MessageId = allHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value || msg.id;

      // Extract text from inbound attachments (PDF, DOCX, XLSX, etc.)
      let attachmentText = '';
      try {
        const inboundAttachments = await extractAttachments(gmail, msg.id, fullData.payload);
        if (inboundAttachments.length > 0) {
          attachmentText = await extractAttachmentText(inboundAttachments);
          // Persist attachment text to knowledge base for future retrieval
          saveAttachmentKnowledge(inboundAttachments, { tenantId: resolvedTenant, senderEmail, subject, threadId: msgThreadId, messageId: msg.id }).catch(() => {});
          if (attachmentText) {
            console.log(`[GmailPoll] [${label}] Extracted text from ${inboundAttachments.length} attachment(s)`);
          }
        }
      } catch (attErr) {
        console.warn(`[GmailPoll] [${label}] Attachment extraction failed: ${attErr.message}`);
      }

      try {
        await generalEmailHandler({
          messageId: rfc822MessageId,
          threadId: msgThreadId,
          from: from,
          fromName: senderName,
          subject,
          body: body + attachmentText,
          tenantId: resolvedTenant,
          gmail,
          classification,
          originalTo: allHeaders.find(h => h.name.toLowerCase() === 'to')?.value,
          originalCc: allHeaders.find(h => h.name.toLowerCase() === 'cc')?.value,
        });
        repliedThreads.add(msgThreadId);
        // Also mark the internal Gmail ID as processed for dedup
        if (rfc822MessageId !== msg.id) {
          markEmailProcessed({ messageId: msg.id, threadId: msgThreadId, pipeline: 'general-dedup', tenantId: resolvedTenant });
        }
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch {}
        newReplies++;
      } catch (err) {
        // generalEmailHandler threw - agent draft or send failed. Track retry.
        const newRetry = retryCount + 1;
        console.warn(`[GmailPoll] [${label}] General handler failed (attempt ${newRetry}/${MAX_RETRIES}): ${err.message}`);
        markEmailRetry({ messageId: msg.id, threadId: msgThreadId, retryCount: newRetry, tenantId: resolvedTenant });
        // Do NOT mark as read - let it be retried next poll cycle
      }

      } finally {
        currentlyProcessing.delete(msg.id);
      }
    }

    return newReplies;
  } catch (err) {
    // Re-throw auth errors so the outer loop can try the fallback OAuth client
    const isAuthError = err.code === 401 || err.message?.includes('invalid_grant') ||
      err.message?.includes('Invalid Credentials') || err.message?.includes('unauthorized_client') ||
      err.message?.includes('Token has been expired or revoked');
    if (isAuthError) throw err;
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
    const resolvedId = inbox.tenantId || getDefaultTenantId();
    try {
      const count = await runWithTenant(resolvedId, () => pollSingleInbox(inbox.gmail, inbox.tenantId, inbox.label));
      totalNew += count;
    } catch (err) {
      const isAuthError = err.code === 401 || err.message?.includes('invalid_grant') ||
        err.message?.includes('Invalid Credentials') || err.message?.includes('unauthorized_client') ||
        err.message?.includes('Token has been expired or revoked');
      if (isAuthError && inbox.refreshToken) {
        // Try fallback OAuth client (token may have been issued by a different client)
        const fallbackGmail = makeGmailClientFallback(inbox.refreshToken);
        if (fallbackGmail) {
          try {
            console.log(`[GmailPoll] [${inbox.label}] Primary client failed, trying fallback client...`);
            const count = await runWithTenant(resolvedId, () => pollSingleInbox(fallbackGmail, inbox.tenantId, inbox.label));
            totalNew += count;
            // Fallback worked - remember for future poll cycles
            useFallbackClient.add(inbox.label);
            continue;
          } catch (err2) {
            console.error(`[GmailPoll] [${inbox.label}] Both OAuth clients failed: ${err2.message}`);
          }
        }
        console.error(`[GmailPoll] [${inbox.label}] AUTH FAILED - token is dead: ${err.message}`);
        tokenHealth.set(inbox.label, {
          label: inbox.label, tenantId: inbox.tenantId,
          status: 'dead', lastChecked: new Date().toISOString(),
          error: err.message,
        });
      } else if (isAuthError) {
        console.error(`[GmailPoll] [${inbox.label}] AUTH FAILED - token is dead: ${err.message}`);
        tokenHealth.set(inbox.label, {
          label: inbox.label, tenantId: inbox.tenantId,
          status: 'dead', lastChecked: new Date().toISOString(),
          error: err.message,
        });
      } else {
        console.error(`[GmailPoll] [${inbox.label}] Poll error: ${err.message}`);
        tokenHealth.set(inbox.label, {
          label: inbox.label, tenantId: inbox.tenantId,
          status: 'error', lastChecked: new Date().toISOString(),
          error: err.message,
        });
      }
    }
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

/**
 * Check token health for all configured inboxes by attempting a token exchange.
 * Returns array of { label, tenantId, status, lastChecked, error }.
 */
export async function checkAllTokenHealth() {
  const results = [];

  // Build inbox list with raw refresh tokens for testing
  const entries = [];
  const defaultToken = process.env.GMAIL_REFRESH_TOKEN;
  if (defaultToken) {
    entries.push({ tenantId: 'zhan-capital', label: 'agent@zhan.coppice.ai', refreshToken: defaultToken, isEnvVar: true });
  }
  try {
    const tenants = getAllTenants();
    for (const tenant of tenants) {
      try {
        const tdb = getTenantDb(tenant.id);
        const rows = tdb.prepare('SELECT * FROM tenant_email_config').all();
        for (const row of rows) {
          if (row.gmail_refresh_token) {
            entries.push({
              tenantId: row.tenant_id,
              label: row.sender_email,
              refreshToken: row.gmail_refresh_token,
              tokenLastAuthedAt: row.token_last_authed_at || row.updated_at || row.created_at,
              isEnvVar: false,
            });
          }
        }
      } catch {}
    }
  } catch {}

  // Deduplicate by email address - prefer DB entries over env var
  const deduped = new Map();
  for (const entry of entries) {
    const email = entry.label.replace(/\s*\(.*\)$/, '');
    entry.label = email; // normalize label to just the email
    const existing = deduped.get(email);
    if (!existing || (existing.isEnvVar && !entry.isEnvVar)) {
      deduped.set(email, entry);
    }
  }
  // Clear stale poll-generated entries from cache
  tokenHealth.clear();

  for (const entry of deduped.values()) {
    const result = { label: entry.label, tenantId: entry.tenantId, lastChecked: new Date().toISOString(), isEnvVar: false };
    let healthy = false;
    for (const pair of getClientPairs()) {
      try {
        const client = new google.auth.OAuth2(pair.id, pair.secret, 'http://localhost:8099');
        client.setCredentials({ refresh_token: entry.refreshToken });
        const { token } = await client.getAccessToken();
        if (token) {
          healthy = true;
          result.status = 'healthy';
          result.error = null;
          break;
        }
      } catch {}
    }
    if (!healthy) {
      result.status = 'dead';
      result.error = 'Token exchange failed with all OAuth clients';
    }

    // Production OAuth app - refresh tokens don't expire on a timer
    // Show last auth date for reference but no fake countdown
    result.tokenLastAuthedAt = entry.tokenLastAuthedAt || null;
    result.expiresInDays = null;
    result.expiryWarning = null;

    tokenHealth.set(entry.label, result);
    results.push(result);
  }

  lastHealthCheck = new Date().toISOString();
  return results;
}

/**
 * Get cached token health (from last check).
 */
export function getTokenHealthStatus() {
  return {
    lastChecked: lastHealthCheck,
    tokens: Array.from(tokenHealth.values()),
  };
}
