#!/usr/bin/env node
/**
 * Enrich HubSpot Contact Classification Reasoning with Engagement History
 *
 * Fetches actual engagement history (emails, meetings, notes, calls) from
 * HubSpot API and uses Claude CLI to generate reasoning that references
 * specific conversations and interactions.
 *
 * Usage:
 *   node scripts/enrich_with_history.js [--limit N] [--dry-run] [--include-other]
 *
 * By default processes non-Other contacts first, sorted by confidence DESC.
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DB_PATH = join(__dirname, '..', 'data', 'sangha', 'sangha.db');
const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY || (process.argv.includes('--key') ? process.argv[process.argv.indexOf('--key') + 1] : null);
if (!HUBSPOT_API_KEY) { console.error('ERROR: Pass --key <api_key> or set HUBSPOT_API_KEY env'); process.exit(1); }
const HUBSPOT_BASE = 'https://api.hubapi.com';
const HUBSPOT_DELAY_MS = 200;
const CLAUDE_DELAY_MS = 1000;
const TEMP_PROMPT_PATH = '/tmp/enrich_prompt.txt';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const INCLUDE_OTHER = args.includes('--include-other');
const LIMIT = getArgNum('--limit', 50);

function getArgNum(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return fallback;
}

// ---------------------------------------------------------------------------
// HubSpot API helpers
// ---------------------------------------------------------------------------

async function hubspotGet(urlPath) {
  const url = urlPath.startsWith('http') ? urlPath : `${HUBSPOT_BASE}${urlPath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${HUBSPOT_API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API ${res.status}: ${text.substring(0, 300)}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all engagements for a contact using the v1 API.
 * Returns an array of { type, timestamp, metadata } objects.
 * Paginates if hasMore is true.
 */
async function fetchEngagements(contactId) {
  const allResults = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const data = await hubspotGet(
        `/engagements/v1/engagements/associated/CONTACT/${contactId}/paged?limit=100&offset=${offset}`
      );
      const results = data.results || [];
      for (const r of results) {
        allResults.push({
          type: r.engagement.type,
          timestamp: r.engagement.timestamp,
          metadata: r.metadata || {},
        });
      }
      hasMore = data.hasMore === true;
      offset = data.offset || 0;
      if (hasMore) await sleep(HUBSPOT_DELAY_MS);
    } catch (err) {
      console.error(`    [WARN] Failed to fetch engagements for contact ${contactId}: ${err.message}`);
      hasMore = false;
    }
  }

  return allResults;
}

/**
 * Build a human-readable engagement summary from raw engagements.
 */
function buildEngagementSummary(engagements) {
  if (!engagements || engagements.length === 0) {
    return 'No engagement history found in HubSpot.';
  }

  // Sort by timestamp desc (newest first)
  const sorted = [...engagements].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // Count by type
  const counts = {};
  for (const e of sorted) {
    const t = e.type || 'UNKNOWN';
    counts[t] = (counts[t] || 0) + 1;
  }

  const lines = [];
  lines.push(`Total engagements: ${sorted.length}`);
  lines.push(`Breakdown: ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}`);

  // Date range
  const oldest = sorted[sorted.length - 1];
  const newest = sorted[0];
  if (oldest && newest) {
    lines.push(
      `Date range: ${formatDate(oldest.timestamp)} to ${formatDate(newest.timestamp)}`
    );
  }

  lines.push('');

  // Detailed items - meetings and notes first (they have content), then email counts
  const meetings = sorted.filter((e) => e.type === 'MEETING');
  const notes = sorted.filter((e) => e.type === 'NOTE');
  const calls = sorted.filter((e) => e.type === 'CALL');
  const emails = sorted.filter((e) => e.type === 'EMAIL' || e.type === 'INCOMING_EMAIL');

  if (meetings.length > 0) {
    lines.push(`MEETINGS (${meetings.length}):`);
    for (const m of meetings.slice(0, 10)) {
      const title = m.metadata.title || '(no title)';
      const body = stripHtml(m.metadata.body || '').substring(0, 300);
      lines.push(`  - ${formatDate(m.timestamp)}: "${title}"`);
      if (body && body.length > 5) {
        lines.push(`    Notes: ${body}`);
      }
    }
    lines.push('');
  }

  if (notes.length > 0) {
    lines.push(`NOTES (${notes.length}):`);
    for (const n of notes.slice(0, 10)) {
      const body = stripHtml(n.metadata.body || '').substring(0, 400);
      lines.push(`  - ${formatDate(n.timestamp)}: ${body || '(empty note)'}`);
    }
    lines.push('');
  }

  if (calls.length > 0) {
    lines.push(`CALLS (${calls.length}):`);
    for (const c of calls.slice(0, 10)) {
      const title = c.metadata.title || c.metadata.subject || '(no title)';
      const body = stripHtml(c.metadata.body || '').substring(0, 200);
      lines.push(`  - ${formatDate(c.timestamp)}: "${title}"`);
      if (body && body.length > 5) {
        lines.push(`    Notes: ${body}`);
      }
    }
    lines.push('');
  }

  if (emails.length > 0) {
    const outbound = emails.filter((e) => e.type === 'EMAIL').length;
    const inbound = emails.filter((e) => e.type === 'INCOMING_EMAIL').length;
    lines.push(`EMAILS (${emails.length} total - ${outbound} outbound, ${inbound} inbound):`);
    // Email content is redacted without sales-email-read scope, but we have timestamps
    const emailDates = emails.slice(0, 10).map((e) => formatDate(e.timestamp));
    lines.push(`  Most recent exchanges: ${emailDates.join(', ')}`);

    // Check for email subjects if available (sometimes present)
    const withSubject = emails.filter((e) => e.metadata.subject);
    if (withSubject.length > 0) {
      lines.push('  Subjects:');
      for (const e of withSubject.slice(0, 5)) {
        lines.push(`    - ${formatDate(e.timestamp)}: "${e.metadata.subject}"`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatDate(ts) {
  if (!ts) return '(unknown date)';
  const d = new Date(ts);
  return d.toISOString().split('T')[0];
}

function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|table|tr|td|th|span|a|b|i|em|strong|blockquote)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Claude CLI helper
// ---------------------------------------------------------------------------

function callClaude(prompt) {
  // Write prompt to temp file to handle long prompts safely
  fs.writeFileSync(TEMP_PROMPT_PATH, prompt, 'utf8');

  // Build env without CLAUDECODE to allow nested invocation
  const env = { ...process.env };
  delete env.CLAUDECODE;

  try {
    const result = execSync(`claude -p < "${TEMP_PROMPT_PATH}"`, {
      encoding: 'utf8',
      timeout: 120000, // 2 minute timeout
      maxBuffer: 1024 * 1024,
      shell: true,
      env,
    });
    return result.trim();
  } catch (err) {
    const stderr = (err.stderr || '').trim();
    const stdout = (err.stdout || '').trim();
    console.error(`    [WARN] Claude CLI error: ${stderr || stdout || (err.message || '').substring(0, 200)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resume detection
// ---------------------------------------------------------------------------

const ENRICHED_MARKERS = [
  'email thread',
  'email exchange',
  'conversation about',
  'discussed',
  'meeting about',
  'meeting titled',
  'meeting on',
  'note from',
  'note indicates',
  'engagement history',
  'no engagement history',
  'outbound email',
  'inbound email',
  'exchanges between',
];

function isAlreadyEnriched(reasoning) {
  if (!reasoning) return false;
  const lower = reasoning.toLowerCase();
  return ENRICHED_MARKERS.some((marker) => lower.includes(marker));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== HubSpot Classification Reasoning Enrichment (with Engagement History) ===\n');
  console.log(`DB: ${DB_PATH}`);
  console.log(`Limit: ${LIMIT} contacts`);
  if (DRY_RUN) console.log('** DRY RUN - no DB writes **');
  if (INCLUDE_OTHER) console.log('** Including Other contacts **');
  console.log('');

  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const nonOtherCount = db
    .prepare("SELECT COUNT(*) as cnt FROM hubspot_classifications WHERE industry != 'Other'")
    .get().cnt;
  const otherCount = db
    .prepare("SELECT COUNT(*) as cnt FROM hubspot_classifications WHERE industry = 'Other'")
    .get().cnt;
  console.log(`Total contacts: ${nonOtherCount + otherCount}`);
  console.log(`  Non-Other: ${nonOtherCount}`);
  console.log(`  Other: ${otherCount}\n`);

  // Build the query - non-Other first, sorted by confidence DESC
  let query;
  if (INCLUDE_OTHER) {
    query = `SELECT * FROM hubspot_classifications
             ORDER BY CASE WHEN industry != 'Other' THEN 0 ELSE 1 END, confidence DESC`;
  } else {
    query = `SELECT * FROM hubspot_classifications
             WHERE industry != 'Other'
             ORDER BY confidence DESC`;
  }

  const contacts = db.prepare(query).all();
  const toProcess = Math.min(contacts.length, LIMIT);

  console.log(`Contacts to scan: ${toProcess}\n`);

  const updateStmt = db.prepare(
    'UPDATE hubspot_classifications SET reasoning = ? WHERE hubspot_id = ?'
  );

  let processed = 0;
  let updated = 0;
  let skippedAlreadyEnriched = 0;
  let skippedNoEngagements = 0;
  let errors = 0;

  for (let i = 0; i < toProcess; i++) {
    const c = contacts[i];
    const label = `[${i + 1}/${toProcess}]`;

    // Check if already enriched
    if (isAlreadyEnriched(c.reasoning)) {
      skippedAlreadyEnriched++;
      if (i < 5) console.log(`${label} SKIP (already enriched): ${c.name || c.email}`);
      continue;
    }

    console.log(
      `${label} Processing: ${c.name || '(no name)'} | ${c.company || c.domain || '(unknown)'} | ${c.industry}/${c.reason}`
    );

    // Fetch engagements from HubSpot
    const engagements = await fetchEngagements(c.hubspot_id);
    await sleep(HUBSPOT_DELAY_MS);

    const engagementSummary = buildEngagementSummary(engagements);
    const engagementCount = engagements.length;

    if (engagementCount === 0) {
      skippedNoEngagements++;
      // For contacts with no engagements, add a note but keep existing reasoning
      if (!DRY_RUN && c.reasoning) {
        const updatedReasoning = c.reasoning + ' No engagement history found in HubSpot to further contextualize this classification.';
        updateStmt.run(updatedReasoning, c.hubspot_id);
      }
      console.log(`    No engagements found - keeping existing reasoning`);
      processed++;
      continue;
    }

    console.log(`    Found ${engagementCount} engagements`);

    // Build Claude prompt
    const prompt = buildPrompt(c, engagementSummary);

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would send to Claude (${prompt.length} chars)`);
      if (i < 3) {
        console.log(`    --- PROMPT PREVIEW ---`);
        console.log(prompt.substring(0, 600));
        console.log(`    --- END PREVIEW ---`);
        console.log(`    --- ENGAGEMENT SUMMARY ---`);
        console.log(engagementSummary.substring(0, 400));
        console.log(`    --- END SUMMARY ---`);
      }
      processed++;
      continue;
    }

    // Call Claude
    const newReasoning = callClaude(prompt);
    await sleep(CLAUDE_DELAY_MS);

    if (!newReasoning || newReasoning.length < 20) {
      console.log(`    [ERROR] Claude returned empty or too-short response, skipping`);
      errors++;
      processed++;
      continue;
    }

    // Validate: no em dashes
    const cleanReasoning = newReasoning.replace(/\u2014/g, ' - ').replace(/\u2013/g, '-');

    // Update DB
    updateStmt.run(cleanReasoning, c.hubspot_id);
    updated++;
    processed++;

    console.log(`    Updated reasoning (${cleanReasoning.length} chars):`);
    console.log(`    "${cleanReasoning.substring(0, 200)}${cleanReasoning.length > 200 ? '...' : ''}"`);
  }

  // Cleanup temp file
  try {
    fs.unlinkSync(TEMP_PROMPT_PATH);
  } catch (_) {}

  console.log('\n=== RESULTS ===');
  console.log(`Processed: ${processed}`);
  console.log(`Updated with enriched reasoning: ${updated}`);
  console.log(`Skipped (already enriched): ${skippedAlreadyEnriched}`);
  console.log(`Skipped (no engagements): ${skippedNoEngagements}`);
  console.log(`Errors: ${errors}`);
  if (DRY_RUN) console.log('(Dry run - no changes written to DB)');

  db.close();
}

function buildPrompt(contact, engagementSummary) {
  return `You are analyzing a HubSpot contact for Sangha Systems, a renewable energy developer and Bitcoin mining infrastructure company. Based on the contact's profile and their engagement history below, write 2-3 sentences explaining why this contact is classified the way they are. Reference specific emails, notes, meetings, or conversations where relevant. Be specific about dates, topics, and interaction patterns.

CONTACT:
- Name: ${contact.name || '(unknown)'}
- Email: ${contact.email || '(unknown)'}
- Company: ${contact.company || '(unknown)'}
- Title: ${contact.title || '(unknown)'}
- Domain: ${contact.domain || '(unknown)'}
- Current Classification: ${contact.industry} / ${contact.reason} / ${contact.materials}

ENGAGEMENT HISTORY:
${engagementSummary}

Rules:
- Write exactly 2-3 sentences of classification reasoning
- Reference specific interactions, meeting titles, dates, or email patterns if available
- Do not use em dashes (the long dash character) - use regular hyphens instead
- Output ONLY the reasoning text, nothing else - no quotes, no labels, no prefixes`;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
