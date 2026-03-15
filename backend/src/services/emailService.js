/**
 * Email Service — Multi-tenant Gmail API sender
 *
 * Each tenant can have its own Gmail account (sender email + refresh token).
 * Falls back to the default agent@zhan.coppice.ai account from env vars.
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { insertActivity, getTenantEmailConfig } from '../cache/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Shared OAuth app credentials (all tenants use the same OAuth app)
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const FALLBACK_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const FALLBACK_SENDER = 'Coppice <agent@zhan.coppice.ai>';

/**
 * Get a Gmail client + sender identity for a tenant.
 * Looks up tenant_email_config in DB; falls back to env var defaults.
 */
function getGmailClient(tenantId) {
  let refreshToken = FALLBACK_REFRESH_TOKEN;
  let sender = FALLBACK_SENDER;

  if (tenantId) {
    try {
      const config = getTenantEmailConfig(tenantId);
      if (config) {
        refreshToken = config.gmailRefreshToken;
        sender = `${config.senderName} <${config.senderEmail}>`;
      }
    } catch (e) {
      // DB not initialized yet (startup) — use fallback
    }
  }

  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost:8099');
  oAuth2Client.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  return { gmail, sender };
}

/**
 * Convert a plain-text email body to styled HTML paragraphs.
 * Splits on double newlines into <p> tags, single newlines become <br>.
 */
export function textToHtml(text) {
  const style = 'font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5;margin:0 0 12px 0;';
  const paras = text.trim().split(/\n\n+/);
  return paras.map(p => `<p style="${style}">${p.replace(/\n/g, '<br>')}</p>`).join('\n');
}

/**
 * Convert markdown-ish agent response to clean HTML email.
 * Handles: **bold**, *italic*, numbered/bulleted lists, paragraphs.
 */
export function markdownToEmailHtml(text) {
  const pStyle = 'font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6;margin:0 0 10px 0;';
  const liStyle = 'font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6;margin:0 0 4px 0;';

  const lines = text.trim().split('\n');
  const blocks = [];
  let currentList = [];
  let listType = null;

  function flushList() {
    if (currentList.length > 0) {
      const tag = listType === 'ol' ? 'ol' : 'ul';
      blocks.push(`<${tag} style="margin:0 0 10px 0;padding-left:24px;">${currentList.join('')}</${tag}>`);
      currentList = [];
      listType = null;
    }
  }

  function inlineFormat(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:13px;">$1</code>');
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Numbered list: "1. item" or "1) item"
    const olMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
    if (olMatch) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      currentList.push(`<li style="${liStyle}">${inlineFormat(olMatch[1])}</li>`);
      continue;
    }

    // Bulleted list: "- item" or "* item" (but not bold like **text**)
    const ulMatch = trimmed.match(/^[-•]\s+(.+)/);
    if (ulMatch) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      currentList.push(`<li style="${liStyle}">${inlineFormat(ulMatch[1])}</li>`);
      continue;
    }

    // Empty line — flush list, add spacing
    if (!trimmed) {
      flushList();
      continue;
    }

    // Regular paragraph
    flushList();
    blocks.push(`<p style="${pStyle}">${inlineFormat(trimmed)}</p>`);
  }

  flushList();
  return blocks.join('\n');
}

/**
 * RFC 2047 encode a header value if it contains non-ASCII characters.
 */
function encodeSubject(subject) {
  // Check if subject contains non-ASCII
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

/**
 * Send a plain-text email (no attachments).
 */
export async function sendEmail({ to, subject, body, cc, bcc, tenantId, threadId, inReplyTo, references }) {
  const { gmail, sender } = getGmailClient(tenantId);

  const bodyBase64 = Buffer.from(body, 'utf-8').toString('base64');
  const headers = [
    `From: ${sender}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${encodeSubject(subject)}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);

  const rawMessage = [...headers, '', bodyBase64].join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const requestBody = { raw: encodedMessage };
  if (threadId) requestBody.threadId = threadId;

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  console.log(`Email sent to ${to}: ${result.data.id}`);

  try {
    insertActivity({
      tenantId: tenantId || 'default', type: 'out',
      title: `Email sent to ${to}`,
      subtitle: subject,
      detailJson: JSON.stringify({ to, subject, body: body.slice(0, 5000), cc, bcc }),
      sourceType: 'email', agentId: 'coppice',
    });
  } catch (e) { /* non-critical */ }

  return { messageId: result.data.id, threadId: result.data.threadId };
}

/**
 * Send an email with file attachments.
 * @param {Object} opts
 * @param {string} opts.to - Recipient email
 * @param {string} opts.subject - Subject line
 * @param {string} opts.body - Plain text body
 * @param {Array<{filename: string, path: string, contentType: string}>} opts.attachments
 * @param {string} [opts.tenantId] - Tenant ID for sender resolution
 */
export async function sendEmailWithAttachments({ to, subject, body, html, cc, bcc, attachments = [], tenantId, threadId, inReplyTo, references }) {
  if (attachments.length === 0) {
    if (html) {
      return sendHtmlEmail({ to, subject, html, tenantId, threadId, inReplyTo, references });
    }
    return sendEmail({ to, subject, body, cc, bcc, tenantId, threadId, inReplyTo, references });
  }

  const { gmail, sender } = getGmailClient(tenantId);

  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const headers = [
    `From: ${sender}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${encodeSubject(subject)}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);

  const content = html || body;
  const contentType = html ? 'text/html' : 'text/plain';
  const contentBase64 = Buffer.from(content, 'utf-8').toString('base64');
  let messageParts = [
    ...headers,
    '',
    `--${boundary}`,
    `Content-Type: ${contentType}; charset=utf-8`,
    'Content-Transfer-Encoding: base64',
    '',
    contentBase64,
  ];

  for (const att of attachments) {
    const fileData = readFileSync(att.path);
    const base64Data = fileData.toString('base64');
    const ct = att.contentType || 'application/octet-stream';
    const fn = att.filename || basename(att.path);

    messageParts.push(
      `--${boundary}`,
      `Content-Type: ${ct}; name="${fn}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${fn}"`,
      '',
      base64Data,
    );
  }

  messageParts.push(`--${boundary}--`);

  const rawMessage = messageParts.join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const requestBody2 = { raw: encodedMessage };
  if (threadId) requestBody2.threadId = threadId;

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: requestBody2,
  });

  console.log(`Email with ${attachments.length} attachment(s) sent to ${to}: ${result.data.id}`);
  return { messageId: result.data.id, threadId: result.data.threadId };
}

/**
 * Send a DACP estimate email with the Excel file attached.
 * Used when an email_draft approval is approved.
 */
export async function sendEstimateEmail({ to, subject, body, estimateFilename, tenantId, threadId, inReplyTo, references }) {
  const demoFilesDir = join(__dirname, '../../demo-files');
  const estimatePath = join(demoFilesDir, 'estimates', estimateFilename);

  return sendEmailWithAttachments({
    to,
    subject,
    body,
    tenantId,
    threadId,
    inReplyTo,
    references,
    attachments: [{
      filename: estimateFilename,
      path: estimatePath,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  });
}

/**
 * Send an HTML email.
 */
export async function sendHtmlEmail({ to, subject, html, cc, tenantId, threadId, inReplyTo, references }) {
  const { gmail, sender } = getGmailClient(tenantId);

  const htmlBase64 = Buffer.from(html, 'utf-8').toString('base64');
  const headers = [
    `From: ${sender}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeSubject(subject)}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);

  const rawMessage = [...headers, '', htmlBase64].join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const requestBody = { raw: encodedMessage };
  if (threadId) requestBody.threadId = threadId;

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  console.log(`HTML email sent to ${to}: ${result.data.id}`);

  try {
    insertActivity({
      tenantId: tenantId || 'default', type: 'out',
      title: `Email sent to ${to}`,
      subtitle: subject,
      detailJson: JSON.stringify({ to, subject }),
      sourceType: 'email', agentId: 'coppice',
    });
  } catch (e) { /* non-critical */ }

  return { messageId: result.data.id, threadId: result.data.threadId };
}

export default { sendEmail, sendHtmlEmail, sendEmailWithAttachments, sendEstimateEmail };
