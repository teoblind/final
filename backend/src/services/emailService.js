/**
 * Email Service — sends emails via Gmail API (claude@zhan.capital)
 *
 * Uses OAuth2 refresh token from TJR-Alerts Gmail token.
 * For DACP demo: sends estimate emails with Excel attachments.
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { insertActivity } from '../cache/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Gmail OAuth2 credentials (coppice@zhan.capital with gmail.send scope)
const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost:8099');
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

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
export async function sendEmail({ to, subject, body, cc, bcc, tenantId }) {
  const headers = [
    `From: Coppice <coppice@zhan.capital>`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ].filter(Boolean);

  const rawMessage = [...headers, '', body].join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
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
 */
export async function sendEmailWithAttachments({ to, subject, body, cc, bcc, attachments = [] }) {
  if (attachments.length === 0) {
    return sendEmail({ to, subject, body, cc, bcc });
  }

  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const headers = [
    `From: Coppice <coppice@zhan.capital>`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);

  let messageParts = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
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

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });

  console.log(`Email with ${attachments.length} attachment(s) sent to ${to}: ${result.data.id}`);
  return { messageId: result.data.id, threadId: result.data.threadId };
}

/**
 * Send a DACP estimate email with the Excel file attached.
 * Used when an email_draft approval is approved.
 */
export async function sendEstimateEmail({ to, subject, body, estimateFilename }) {
  const demoFilesDir = join(__dirname, '../../demo-files');
  const estimatePath = join(demoFilesDir, 'estimates', estimateFilename);

  return sendEmailWithAttachments({
    to,
    subject,
    body,
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
export async function sendHtmlEmail({ to, subject, html, tenantId }) {
  const headers = [
    `From: Coppice <coppice@zhan.capital>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ];

  const rawMessage = [...headers, '', html].join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
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
