/**
 * Email Guard — Spam filtering, trusted sender verification, and anti-spoofing.
 *
 * Every inbound email is classified before processing:
 *   trusted  → known sender, verified domain → auto-process
 *   known    → in le_contacts but not explicitly trusted → auto-process, flag for review
 *   unknown  → no record of this sender → log only, NO auto-reply
 *   spam     → detected as bulk/marketing/spam → ignore entirely
 *   spoofed  → display name matches trusted contact but wrong domain → BLOCK + alert
 *
 * Anti-spoofing checks:
 *   1. Gmail Authentication-Results header (DKIM/SPF/DMARC)
 *   2. Display name impersonation (name matches trusted contact, email doesn't)
 *   3. Domain mismatch (trusted contact's domain vs sender's actual domain)
 */

import {
  getTrustedSenderByEmail,
  getTrustedSenderByDomain,
  getTrustedSenders,
  addTrustedSender,
  logEmailSecurity,
  insertActivity,
} from '../cache/database.js';

/**
 * Classification verdicts:
 *   'trusted'  — verified sender, safe to auto-process/auto-reply
 *   'known'    — recognized contact (le_contacts match), safe to process
 *   'unknown'  — unrecognized sender, log only
 *   'spam'     — bulk/marketing email, skip entirely
 *   'spoofed'  — impersonation attempt, block and alert
 */

// ─── Sender Rate Limiting ───────────────────────────────────────────────────
// Track email frequency per sender. Auto-block if they exceed the threshold.
// Key: "tenantId:email" → { count, firstSeen }

const senderRateMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_EMAILS = 5;              // max emails per window before auto-block

/**
 * Check if a sender is spamming (too many emails in the rate window).
 * If they exceed the limit, auto-add them to the blocked list.
 * Returns a reason string if blocked, null otherwise.
 */
function checkSenderRateLimit(tenantId, senderEmail) {
  const key = `${tenantId}:${senderEmail}`;
  const now = Date.now();
  const entry = senderRateMap.get(key);

  if (!entry || (now - entry.firstSeen) > RATE_LIMIT_WINDOW_MS) {
    // Reset window
    senderRateMap.set(key, { count: 1, firstSeen: now });
    return null;
  }

  entry.count++;

  if (entry.count > RATE_LIMIT_MAX_EMAILS) {
    // Auto-block this sender
    try {
      addTrustedSender({
        tenantId,
        email: senderEmail,
        displayName: null,
        trustLevel: 'blocked',
        notes: `Auto-blocked: ${entry.count} emails in ${Math.round((now - entry.firstSeen) / 60000)} min`,
      });
      console.log(`[EmailGuard] Auto-blocked ${senderEmail} for tenant ${tenantId} (${entry.count} emails in ${Math.round((now - entry.firstSeen) / 60000)} min)`);
      try {
        insertActivity({
          tenantId,
          type: 'alert',
          title: `Sender auto-blocked: ${senderEmail}`,
          subtitle: `${entry.count} emails in ${Math.round((now - entry.firstSeen) / 60000)} minutes`,
          sourceType: 'email-guard',
          agentId: 'email-guard',
        });
      } catch (e) { /* non-critical */ }
    } catch (e) {
      // May fail if already blocked (unique constraint) — that's fine
    }
    return `Rate limit exceeded: ${entry.count} emails in ${Math.round((now - entry.firstSeen) / 60000)} min`;
  }

  return null;
}

// Clean up stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of senderRateMap) {
    if ((now - entry.firstSeen) > RATE_LIMIT_WINDOW_MS * 2) {
      senderRateMap.delete(key);
    }
  }
}, 30 * 60 * 1000);

// ─── Spam Signals ────────────────────────────────────────────────────────────

const SPAM_HEADER_PATTERNS = [
  'list-unsubscribe',       // mailing list / marketing
  'x-mailer',               // bulk mailers often set this
  'x-campaign',             // email campaign tool
  'x-mailchimp',
  'x-sg-eid',               // SendGrid
  'x-mandrill',             // Mandrill
  'x-pm-message-id',        // Postmark bulk
];

const SPAM_SUBJECT_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bnewsletter\b/i,
  /\bweekly digest\b/i,
  /\bdaily digest\b/i,
  /\bspecial offer\b/i,
  /\blimited time\b/i,
  /\bfree trial\b/i,
  /\bact now\b/i,
  /\bcongratulations?\b/i,
  /\bwin a\b/i,
  /\byou'?ve been selected\b/i,
  /\bno-?reply@/i,
  /\bdo-?not-?reply@/i,
];

const SPAM_SENDER_PATTERNS = [
  /noreply@/i,
  /no-reply@/i,
  /donotreply@/i,
  /notifications?@/i,
  /updates?@/i,
  /info@.*\.com$/i,         // generic info@ addresses
  /support@.*\.com$/i,      // automated support
  /mailer-daemon/i,
  /postmaster@/i,
];

const SPAM_BODY_SIGNALS = [
  /\bunsubscribe\b/i,
  /\bclick here to unsubscribe\b/i,
  /\bmanage your preferences\b/i,
  /\byou are receiving this because\b/i,
  /\bto stop receiving these emails\b/i,
  /\bpowered by mailchimp\b/i,
  /\bsent via\b.*\b(sendgrid|mailchimp|constant contact|hubspot)\b/i,
];

// ─── Auth Header Parsing ─────────────────────────────────────────────────────

/**
 * Parse Gmail's Authentication-Results header.
 * Returns { dkim: 'pass'|'fail'|'none', spf: 'pass'|'fail'|'none', dmarc: 'pass'|'fail'|'none' }
 */
function parseAuthResults(headers) {
  const authHeader = headers.find(h =>
    h.name.toLowerCase() === 'authentication-results'
  )?.value || '';

  if (!authHeader) return { dkim: 'none', spf: 'none', dmarc: 'none' };

  const dkimMatch = authHeader.match(/dkim=(\w+)/i);
  const spfMatch = authHeader.match(/spf=(\w+)/i);
  const dmarcMatch = authHeader.match(/dmarc=(\w+)/i);

  return {
    dkim: dkimMatch?.[1]?.toLowerCase() || 'none',
    spf: spfMatch?.[1]?.toLowerCase() || 'none',
    dmarc: dmarcMatch?.[1]?.toLowerCase() || 'none',
  };
}

/**
 * Check if the sender domain matches authenticated domain from DKIM.
 * Gmail's Authentication-Results includes the signing domain.
 */
function extractAuthDomain(headers) {
  const authHeader = headers.find(h =>
    h.name.toLowerCase() === 'authentication-results'
  )?.value || '';

  // Extract DKIM signing domain: dkim=pass header.d=example.com
  const dkimDomainMatch = authHeader.match(/dkim=pass[^;]*header\.d=([^\s;]+)/i);
  return dkimDomainMatch?.[1]?.toLowerCase() || null;
}

// ─── Core Classification ─────────────────────────────────────────────────────

/**
 * Classify an inbound email for a given tenant.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Resolved tenant ID
 * @param {string} params.senderEmail - Sender's email address
 * @param {string} params.senderName - Sender's display name
 * @param {string} params.subject - Email subject
 * @param {string} params.body - Email body text
 * @param {Array}  params.headers - Full Gmail message headers
 * @param {string} params.messageId - Gmail message ID
 * @param {Object|null} params.contact - Pre-resolved contact from le_contacts (if any)
 *
 * @returns {{ verdict: string, reason: string, trustLevel: string|null, authResults: object }}
 */
export function classifyEmail({ tenantId, senderEmail, senderName, subject, body, headers, messageId, contact }) {
  const lowerEmail = (senderEmail || '').toLowerCase();
  const senderDomain = lowerEmail.split('@')[1] || '';
  const authResults = parseAuthResults(headers || []);
  const authDomain = extractAuthDomain(headers || []);

  // 1. Check trusted sender registry (exact email match) — before spoofing so
  //    explicitly trusted emails aren't blocked by display-name mismatch
  const trustedByEmail = getTrustedSenderByEmail(tenantId, lowerEmail);

  // 2. Check if sender is already blocked
  if (trustedByEmail && trustedByEmail.trust_level === 'blocked') {
    logEmailSecurity({
      tenantId, messageId, senderEmail: lowerEmail, senderName, subject,
      verdict: 'blocked', reason: 'Sender is on block list', authResults: JSON.stringify(authResults),
    });
    return { verdict: 'spam', reason: 'Blocked sender', trustLevel: 'blocked', authResults };
  }

  // 3. If explicitly trusted by email, skip spoofing check entirely
  if (trustedByEmail) {
    return { verdict: 'trusted', reason: 'Registered trusted sender', trustLevel: trustedByEmail.trust_level, authResults };
  }

  // 4. Check for spoofing — only for non-trusted senders
  const spoofCheck = checkSpoofing({ tenantId, senderEmail: lowerEmail, senderName, senderDomain, authResults, authDomain });
  if (spoofCheck) {
    logEmailSecurity({
      tenantId, messageId, senderEmail: lowerEmail, senderName, subject,
      verdict: 'spoofed', reason: spoofCheck, authResults: JSON.stringify(authResults),
    });
    return { verdict: 'spoofed', reason: spoofCheck, trustLevel: null, authResults };
  }

  // 5. Rate limit check — auto-block senders who send too many emails
  const rateBlock = checkSenderRateLimit(tenantId, lowerEmail);
  if (rateBlock) {
    logEmailSecurity({
      tenantId, messageId, senderEmail: lowerEmail, senderName, subject,
      verdict: 'spam', reason: rateBlock, authResults: JSON.stringify(authResults),
    });
    return { verdict: 'spam', reason: rateBlock, trustLevel: 'blocked', authResults };
  }

  // 5. Check trusted domain
  const trustedByDomain = getTrustedSenderByDomain(tenantId, senderDomain);
  if (trustedByDomain && trustedByDomain.trust_level !== 'blocked') {
    return { verdict: 'trusted', reason: `Domain ${senderDomain} is trusted`, trustLevel: trustedByDomain.trust_level, authResults };
  }

  // 6. Check spam signals
  const spamReason = detectSpam({ senderEmail: lowerEmail, senderName, subject, body, headers: headers || [] });
  if (spamReason) {
    logEmailSecurity({
      tenantId, messageId, senderEmail: lowerEmail, senderName, subject,
      verdict: 'spam', reason: spamReason, authResults: JSON.stringify(authResults),
    });
    return { verdict: 'spam', reason: spamReason, trustLevel: null, authResults };
  }

  // 7. Check if sender is a known contact (le_contacts match, passed in)
  if (contact) {
    return { verdict: 'known', reason: 'Recognized contact in pipeline', trustLevel: null, authResults };
  }

  // 8. Check DMARC — if it fails for an unknown sender, that's suspicious
  if (authResults.dmarc === 'fail') {
    logEmailSecurity({
      tenantId, messageId, senderEmail: lowerEmail, senderName, subject,
      verdict: 'unknown', reason: 'DMARC failed — sender domain may be spoofed', authResults: JSON.stringify(authResults),
    });
    return { verdict: 'unknown', reason: 'DMARC failed — treat with caution', trustLevel: null, authResults };
  }

  // 9. Unknown sender — log only, no auto-reply
  return { verdict: 'unknown', reason: 'Unrecognized sender', trustLevel: null, authResults };
}

// ─── Spoofing Detection ──────────────────────────────────────────────────────

/**
 * Check if the sender is trying to impersonate a trusted contact.
 * Returns a reason string if spoofing is detected, null otherwise.
 */
function checkSpoofing({ tenantId, senderEmail, senderName, senderDomain, authResults, authDomain }) {
  if (!senderName) return null;

  const normalizedName = senderName.toLowerCase().trim();
  if (!normalizedName) return null;

  // Get all trusted senders for this tenant
  let trustedSenders;
  try {
    trustedSenders = getTrustedSenders(tenantId);
  } catch {
    return null;
  }

  for (const trusted of trustedSenders) {
    if (trusted.trust_level === 'blocked') continue;

    const trustedName = (trusted.display_name || '').toLowerCase().trim();
    const trustedEmail = (trusted.email || '').toLowerCase();
    const trustedDomain = (trusted.domain || '').toLowerCase();

    // Skip if no name to compare
    if (!trustedName) continue;

    // Check: display name matches a trusted contact, but email is different
    const nameMatch = normalizedName === trustedName ||
      normalizedName.includes(trustedName) ||
      trustedName.includes(normalizedName);

    if (!nameMatch) continue;

    // If email matches exactly, not a spoof
    if (trustedEmail && senderEmail === trustedEmail) continue;

    // If domain matches the trusted domain, likely legitimate (same org, different person)
    if (trustedDomain && senderDomain === trustedDomain) continue;

    // Name matches but email/domain doesn't — potential impersonation
    // Check DKIM alignment as additional signal
    if (authResults.dmarc === 'fail' || authResults.spf === 'fail') {
      return `Display name "${senderName}" matches trusted contact "${trusted.display_name}" but email ${senderEmail} doesn't match expected ${trustedEmail || `@${trustedDomain}`}. DMARC/SPF also failed — high confidence impersonation.`;
    }

    // Even with passing DMARC, flag if the domain is completely different
    if (trustedEmail && senderEmail !== trustedEmail) {
      const expectedDomain = trustedEmail.split('@')[1];
      if (expectedDomain && senderDomain !== expectedDomain) {
        return `Display name "${senderName}" matches trusted contact "${trusted.display_name}" (${trustedEmail}) but sent from ${senderEmail} — different domain. Possible impersonation.`;
      }
    }

    if (trustedDomain && senderDomain !== trustedDomain) {
      return `Display name "${senderName}" matches trusted contact from @${trustedDomain} but sent from @${senderDomain}. Possible impersonation.`;
    }
  }

  return null;
}

// ─── Spam Detection ──────────────────────────────────────────────────────────

/**
 * Detect spam/marketing emails using header and content heuristics.
 * Returns a reason string if spam is detected, null otherwise.
 */
function detectSpam({ senderEmail, senderName, subject, body, headers }) {
  // Check bulk/marketing headers
  const headerNames = headers.map(h => h.name.toLowerCase());
  for (const pattern of SPAM_HEADER_PATTERNS) {
    if (headerNames.includes(pattern)) {
      return `Marketing header detected: ${pattern}`;
    }
  }

  // Check Precedence: bulk/list header
  const precedence = headers.find(h => h.name.toLowerCase() === 'precedence')?.value?.toLowerCase();
  if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') {
    return `Precedence header: ${precedence}`;
  }

  // Check sender patterns
  for (const pattern of SPAM_SENDER_PATTERNS) {
    if (pattern.test(senderEmail)) {
      return `Automated sender pattern: ${senderEmail}`;
    }
  }

  // Check subject patterns
  for (const pattern of SPAM_SUBJECT_PATTERNS) {
    if (pattern.test(subject)) {
      return `Spam subject pattern: ${subject}`;
    }
  }

  // Check body signals (only first 2000 chars for performance)
  const bodySlice = (body || '').slice(0, 2000);
  let bodySpamSignals = 0;
  for (const pattern of SPAM_BODY_SIGNALS) {
    if (pattern.test(bodySlice)) bodySpamSignals++;
  }
  if (bodySpamSignals >= 2) {
    return `Multiple spam body signals detected (${bodySpamSignals})`;
  }

  return null;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Whether a verdict allows automatic email responses (auto-reply, RFQ response, etc.)
 * Allows trusted, known, AND unknown senders — a business agent should respond to
 * first-time senders (new GCs, prospects, etc.). Only spam/spoofed/blocked are silenced.
 */
export function canAutoRespond(verdict) {
  return verdict === 'trusted' || verdict === 'known' || verdict === 'unknown';
}

/**
 * Whether a verdict allows pipeline processing (logging activity, routing to RFQ/IPP)
 */
export function canProcess(verdict) {
  return verdict === 'trusted' || verdict === 'known' || verdict === 'unknown';
}
