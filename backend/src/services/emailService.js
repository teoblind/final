/**
 * Email Service - Multi-tenant Gmail API sender
 *
 * Each tenant can have its own Gmail account (sender email + refresh token).
 * Falls back to the default agent@zhan.coppice.ai account from env vars.
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { insertActivity, getTenantEmailConfig, getAllTenantEmailConfigs, SANGHA_TENANT_ID } from '../cache/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dual OAuth app credentials - tokens may be issued by either client
function getOAuthClients() {
  return [
    { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET },
    { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET },
  ].filter(c => c.id && c.secret);
}

function getFallbackRefreshToken() { return process.env.GMAIL_REFRESH_TOKEN; }
const FALLBACK_SENDER = 'Coppice <agent@zhan.coppice.ai>';

/**
 * Get a Gmail client + sender identity for a tenant.
 * Looks up tenant_email_config in DB; falls back to env var defaults.
 * Tries both OAuth clients since tokens may be issued by either one.
 */
async function getGmailClient(tenantId, senderEmail, senderName) {
  let refreshToken = getFallbackRefreshToken();
  let sender = FALLBACK_SENDER;

  if (tenantId) {
    try {
      const config = getTenantEmailConfig(tenantId);
      if (config) {
        refreshToken = config.gmailRefreshToken;
        sender = `${config.senderName} <${config.senderEmail}>`;
      }
    } catch (e) {
      // DB not initialized yet (startup) - use fallback
    }
  }

  // If a specific sender email was requested, try to find its refresh token
  if (senderEmail) {
    try {
      // Check if this email matches a different tenant's config
      const allConfigs = getAllTenantEmailConfigs();
      const match = allConfigs.find(c => c.senderEmail === senderEmail);
      if (match) {
        refreshToken = match.gmailRefreshToken;
        sender = `${senderName || match.senderName} <${match.senderEmail}>`;
      } else {
        // Just override the display name, keep the same sending account
        sender = `${senderName || senderEmail.split('@')[0]} <${senderEmail}>`;
      }
    } catch {
      // If lookup fails, just override display name on current account
      sender = `${senderName || 'Coppice'} <${senderEmail}>`;
    }
  } else if (senderName) {
    // Override just the display name
    const emailMatch = sender.match(/<(.+)>/);
    const email = emailMatch ? emailMatch[1] : '';
    sender = `${senderName} <${email}>`;
  }

  // Try each OAuth client until one works with this refresh token
  const oauthClients = getOAuthClients();
  for (const client of oauthClients) {
    try {
      const oAuth2Client = new google.auth.OAuth2(client.id, client.secret, 'http://localhost:8099');
      oAuth2Client.setCredentials({ refresh_token: refreshToken });
      await oAuth2Client.getAccessToken(); // test that it works
      const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
      return { gmail, sender };
    } catch {
      // Try next client
    }
  }

  // Last resort - use first client without testing (will fail at send time with clear error)
  const fallback = oauthClients[0];
  const oAuth2Client = new google.auth.OAuth2(fallback.id, fallback.secret, 'http://localhost:8099');
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

    // Empty line - flush list, add spacing
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

// ─── Email Signatures ────────────────────────────────────────────────────────

const SIGNATURES = {
  'zhan-capital': {
    html: `
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e0e0;font-family:Arial,sans-serif;">
  <p style="margin:0 0 2px;font-size:13px;color:#333;font-weight:600;">Coppice</p>
  <p style="margin:0 0 6px;font-size:12px;color:#666;font-style:italic;">AI Agent, Zhan Capital</p>
  <p style="margin:0;font-size:12px;color:#999;">
    <a href="https://www.zhan.capital" style="color:#1a73e8;text-decoration:none;">zhan.capital</a>
    &nbsp;·&nbsp;
    <a href="https://www.zhan.capital/portal" style="color:#1a73e8;text-decoration:none;">Investor Portal</a>
  </p>
</div>`,
    text: '\n\n-\nCoppice\nAI Agent, Zhan Capital\nzhan.capital | zhan.capital/portal',
  },
  'dacp-construction-001': {
    html: `
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e0e0;font-family:Arial,sans-serif;">
  <p style="margin:0 0 2px;font-size:13px;color:#333;font-weight:600;">Coppice</p>
  <p style="margin:0 0 6px;font-size:12px;color:#666;font-style:italic;">AI Agent, DACP Construction</p>
  <p style="margin:0;font-size:12px;color:#999;">
    <a href="https://dacpconstruction.com" style="color:#1a73e8;text-decoration:none;">dacpconstruction.com</a>
    &nbsp;·&nbsp;
    <a href="https://dacp.coppice.ai" style="color:#1a73e8;text-decoration:none;">dacp.coppice.ai</a>
  </p>
</div>`,
    text: '\n\n-\nCoppice\nAI Agent, DACP Construction\ndacpconstruction.com | dacp.coppice.ai',
  },
  [SANGHA_TENANT_ID]: {
    html: `
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e0e0;font-family:Arial,sans-serif;">
  <p style="margin:0 0 2px;font-size:13px;color:#333;font-weight:600;">Coppice</p>
  <p style="margin:0 0 6px;font-size:12px;color:#666;font-style:italic;">AI Agent, Sangha Renewables</p>
  <p style="margin:0;font-size:12px;color:#999;">
    <a href="https://sangha.coppice.ai" style="color:#1a73e8;text-decoration:none;">sangha.coppice.ai</a>
    &nbsp;·&nbsp;
    <a href="https://sanghasystems.com" style="color:#1a73e8;text-decoration:none;">sanghasystems.com</a>
  </p>
</div>`,
    text: '\n\n-\nCoppice\nAI Agent, Sangha Renewables\nsangha.coppice.ai | sanghasystems.com',
  },
};

function getSignature(tenantId, isHtml = true) {
  // Fallback sender is agent@zhan.coppice.ai, so no tenantId = Zhan signature
  const key = tenantId || 'zhan-capital';
  const sig = SIGNATURES[key] || SIGNATURES['zhan-capital'];
  return isHtml ? sig.html : sig.text;
}

/**
 * Generate a tracking pixel URL for email open tracking.
 * @param {string} tenantId
 * @param {string} messageId - RFC 822 Message-ID or internal ID
 * @returns {string} HTML img tag with 1x1 transparent pixel
 */
function getTrackingPixel(tenantId, messageId) {
  const baseUrl = process.env.APP_BASE_URL || 'https://coppice.ai';
  const trackingId = Buffer.from(`${tenantId || SANGHA_TENANT_ID}__${messageId || 'unknown'}`).toString('base64url');
  return `<img src="${baseUrl}/api/v1/track/open/${trackingId}" width="1" height="1" style="display:none;" alt="" />`;
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
 * Send an email (no attachments).
 * ALWAYS converts body to HTML - plain text emails are never sent.
 * Callers can pass plain text or markdown in `body` - it gets auto-converted.
 */
export async function sendEmail({ to, subject, body, cc, bcc, tenantId, threadId, inReplyTo, references, senderEmail, senderName }) {
  console.warn(`[emailService] sendEmail() called - auto-converting body to HTML for ${to}`);
  const html = markdownToEmailHtml(body || '');
  return sendHtmlEmail({ to, subject, html, cc, bcc, tenantId, threadId, inReplyTo, references, senderEmail, senderName });
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
export async function sendEmailWithAttachments({ to, subject, body, html, cc, bcc, attachments = [], tenantId, threadId, inReplyTo, references, senderEmail, senderName }) {
  if (attachments.length === 0) {
    if (html) {
      return sendHtmlEmail({ to, subject, html, tenantId, threadId, inReplyTo, references, senderEmail, senderName });
    }
    return sendEmail({ to, subject, body, cc, bcc, tenantId, threadId, inReplyTo, references, senderEmail, senderName });
  }

  const { gmail, sender } = await getGmailClient(tenantId, senderEmail, senderName);

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

  // ALWAYS send as HTML - convert body to HTML if no html param provided
  const htmlContent = html || markdownToEmailHtml(body || '');
  if (!html) {
    console.warn(`[emailService] sendEmailWithAttachments() auto-converting body to HTML for ${to}`);
  }
  const rawContent = wrapHtmlBody(htmlContent);
  const withSig = rawContent.replace('</body>', getSignature(tenantId, true) + '\n</body>');
  const content = withSig.replace('</body>', getTrackingPixel(tenantId, inReplyTo || threadId) + '\n</body>');
  const contentType = 'text/html';
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
 * Wrap raw HTML content in a proper <html><body> envelope with default font styling.
 * Skips wrapping if the content already has an <html> or <body> tag.
 */
function wrapHtmlBody(html) {
  if (/<html[\s>]/i.test(html) || /<body[\s>]/i.test(html)) return html;
  return `<html>\n<body style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">\n${html}\n</body>\n</html>`;
}

/**
 * Send an HTML email.
 */
export async function sendHtmlEmail({ to, subject, html, cc, bcc, tenantId, threadId, inReplyTo, references, skipSignature, senderEmail, senderName }) {
  const { gmail, sender } = await getGmailClient(tenantId, senderEmail, senderName);

  const wrappedHtml = wrapHtmlBody(html);
  const htmlWithSig = skipSignature ? wrappedHtml : wrappedHtml.replace('</body>', getSignature(tenantId, true) + '\n</body>');
  const htmlWithTracking = htmlWithSig.replace('</body>', getTrackingPixel(tenantId, inReplyTo || threadId) + '\n</body>');
  const htmlBase64 = Buffer.from(htmlWithTracking, 'utf-8').toString('base64');
  const headers = [
    `From: ${sender}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
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
      tenantId: tenantId || SANGHA_TENANT_ID, type: 'out',
      title: `Email sent to ${to}`,
      subtitle: subject,
      detailJson: JSON.stringify({ to, subject }),
      sourceType: 'email', agentId: 'coppice',
    });
  } catch (e) { /* non-critical */ }

  return { messageId: result.data.id, threadId: result.data.threadId };
}

export default { sendEmail, sendHtmlEmail, sendEmailWithAttachments, sendEstimateEmail };
