#!/usr/bin/env node
/**
 * Batched HubSpot Classification Reasoning Enrichment
 *
 * Fetches engagement history from HubSpot, sends BATCHES of 10 contacts
 * per Claude CLI call to speed things up dramatically.
 *
 * Usage: node scripts/enrich_batched.js --key <hubspot_key> [--limit N] [--batch-size N] [--include-other]
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '..', 'data', 'sangha', 'sangha.db');
const HUBSPOT_BASE = 'https://api.hubapi.com';
const TEMP_PROMPT_PATH = '/tmp/enrich_batch_prompt.txt';

// CLI args
const args = process.argv.slice(2);
const HUBSPOT_API_KEY = args.includes('--key') ? args[args.indexOf('--key') + 1] : process.env.HUBSPOT_API_KEY;
if (!HUBSPOT_API_KEY) { console.error('ERROR: Pass --key <api_key> or set HUBSPOT_API_KEY'); process.exit(1); }
const LIMIT = getArg('--limit', 5000);
const BATCH_SIZE = getArg('--batch-size', 10);
const INCLUDE_OTHER = args.includes('--include-other');

function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : fallback;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function hubspotGet(path) {
  const url = path.startsWith('http') ? path : `${HUBSPOT_BASE}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${HUBSPOT_API_KEY}` } });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Fetch engagements - cap at 200 to keep prompt size reasonable
async function fetchEngagements(contactId) {
  const results = [];
  let offset = 0, hasMore = true;
  while (hasMore && results.length < 200) {
    try {
      const data = await hubspotGet(`/engagements/v1/engagements/associated/CONTACT/${contactId}/paged?limit=100&offset=${offset}`);
      for (const r of (data.results || [])) {
        results.push({ type: r.engagement.type, timestamp: r.engagement.timestamp, metadata: r.metadata || {} });
      }
      hasMore = data.hasMore === true;
      offset = data.offset || 0;
      if (hasMore && results.length < 200) await sleep(150);
    } catch { hasMore = false; }
  }
  return results;
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function fmtDate(ts) { return ts ? new Date(ts).toISOString().split('T')[0] : '?'; }

// Build a SHORT engagement summary (max ~500 chars) for each contact
function shortEngagementSummary(engagements) {
  if (!engagements.length) return 'No engagement history.';
  const sorted = [...engagements].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const counts = {};
  for (const e of sorted) counts[e.type] = (counts[e.type] || 0) + 1;

  const parts = [`${sorted.length} engagements (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})`];
  parts.push(`Range: ${fmtDate(sorted[sorted.length - 1].timestamp)} to ${fmtDate(sorted[0].timestamp)}`);

  // Key meetings
  const meetings = sorted.filter(e => e.type === 'MEETING').slice(0, 3);
  if (meetings.length) {
    parts.push('Meetings: ' + meetings.map(m => `"${(m.metadata.title || 'untitled').slice(0, 60)}" (${fmtDate(m.timestamp)})`).join('; '));
  }

  // Key notes
  const notes = sorted.filter(e => e.type === 'NOTE').slice(0, 2);
  if (notes.length) {
    parts.push('Notes: ' + notes.map(n => stripHtml(n.metadata.body || '').slice(0, 100)).join('; '));
  }

  // Email subjects
  const emails = sorted.filter(e => e.type === 'EMAIL' || e.type === 'INCOMING_EMAIL');
  const withSubject = emails.filter(e => e.metadata.subject).slice(0, 3);
  if (withSubject.length) {
    parts.push('Email subjects: ' + withSubject.map(e => `"${e.metadata.subject.slice(0, 50)}" (${fmtDate(e.timestamp)})`).join('; '));
  } else if (emails.length) {
    parts.push(`${emails.length} emails, most recent: ${fmtDate(emails[0].timestamp)}`);
  }

  return parts.join('. ');
}

// Resume detection
const ENRICHED_MARKERS = ['email thread', 'email exchange', 'conversation about', 'discussed', 'meeting about',
  'meeting titled', 'meeting on', 'note from', 'note indicates', 'engagement history',
  'no engagement history', 'outbound email', 'inbound email', 'exchanges between',
  'interactions spanning', 'engagements (', 'engagements spanning'];

function isEnriched(reasoning) {
  if (!reasoning) return false;
  const lower = reasoning.toLowerCase();
  return ENRICHED_MARKERS.some(m => lower.includes(m));
}

// Call Claude CLI with batched prompt, parse JSON response
function callClaude(prompt) {
  fs.writeFileSync(TEMP_PROMPT_PATH, prompt, 'utf8');
  const env = { ...process.env };
  delete env.CLAUDECODE;
  try {
    const result = execSync(`claude -p < "${TEMP_PROMPT_PATH}"`, {
      encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024, shell: true, env,
    });
    return result.trim();
  } catch (err) {
    console.error(`  [WARN] Claude CLI error: ${(err.stderr || err.message || '').slice(0, 200)}`);
    return null;
  }
}

async function main() {
  console.log('=== Batched HubSpot Classification Enrichment ===\n');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const query = INCLUDE_OTHER
    ? "SELECT * FROM hubspot_classifications ORDER BY CASE WHEN industry != 'Other' THEN 0 ELSE 1 END, confidence DESC"
    : "SELECT * FROM hubspot_classifications WHERE industry != 'Other' ORDER BY confidence DESC";

  const allContacts = db.prepare(query).all();
  // Filter out already enriched
  const toProcess = allContacts.filter(c => !isEnriched(c.reasoning)).slice(0, LIMIT);
  const skipped = allContacts.length - toProcess.length;
  console.log(`Total: ${allContacts.length} | Already enriched: ${skipped} | To process: ${toProcess.length} | Batch size: ${BATCH_SIZE}\n`);

  const updateStmt = db.prepare('UPDATE hubspot_classifications SET reasoning = ? WHERE hubspot_id = ?');
  let totalUpdated = 0, totalErrors = 0, totalNoEngagements = 0;

  // Process in batches
  for (let batchStart = 0; batchStart < toProcess.length; batchStart += BATCH_SIZE) {
    const batch = toProcess.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
    console.log(`\n--- Batch ${batchNum}/${totalBatches} (contacts ${batchStart + 1}-${batchStart + batch.length}) ---`);

    // Fetch engagements for all contacts in batch
    const batchData = [];
    for (const c of batch) {
      const engagements = await fetchEngagements(c.hubspot_id);
      await sleep(100);
      const summary = shortEngagementSummary(engagements);
      batchData.push({ contact: c, engagements: engagements.length, summary });
      process.stdout.write(`  Fetched ${c.name || c.email} (${engagements.length} engagements)\n`);
    }

    // Separate contacts with and without engagements
    const withEngagements = batchData.filter(d => d.engagements > 0);
    const noEngagements = batchData.filter(d => d.engagements === 0);

    // Handle no-engagement contacts
    for (const d of noEngagements) {
      if (d.contact.reasoning) {
        updateStmt.run(d.contact.reasoning + ' No engagement history found in HubSpot to further contextualize this classification.', d.contact.hubspot_id);
      }
      totalNoEngagements++;
    }

    if (withEngagements.length === 0) {
      console.log('  No contacts with engagements in this batch, skipping Claude call');
      continue;
    }

    // Build batched prompt
    let prompt = `You are analyzing HubSpot contacts for Sangha Systems, a renewable energy developer and Bitcoin mining infrastructure company. For each contact below, write a 2-3 sentence classification reasoning that references their specific engagement history (meetings, emails, notes). Be specific - mention meeting titles, email subjects, dates, and interaction patterns.

Do NOT use em dashes. Use regular hyphens only.

Return ONLY a JSON array like: [{"id": "hubspot_id", "reasoning": "..."}]

`;
    for (let i = 0; i < withEngagements.length; i++) {
      const d = withEngagements[i];
      const c = d.contact;
      prompt += `CONTACT ${i + 1}:
- HubSpot ID: ${c.hubspot_id}
- Name: ${c.name || '(unknown)'}
- Email: ${c.email || '?'}
- Company: ${c.company || '?'}
- Title: ${c.title || '?'}
- Domain: ${c.domain || '?'}
- Classification: ${c.industry} / ${c.reason} / ${c.materials}
- Engagement: ${d.summary}

`;
    }

    // Call Claude
    const response = callClaude(prompt);
    if (!response) {
      console.log('  [ERROR] Claude returned nothing for this batch');
      totalErrors += withEngagements.length;
      continue;
    }

    // Parse JSON from response
    try {
      // Extract JSON array from response (Claude might wrap it in markdown)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');
      const results = JSON.parse(jsonMatch[0]);

      for (const r of results) {
        if (!r.id || !r.reasoning || r.reasoning.length < 20) continue;
        const clean = r.reasoning.replace(/\u2014/g, ' - ').replace(/\u2013/g, '-');
        updateStmt.run(clean, r.id);
        totalUpdated++;
      }
      console.log(`  Updated ${results.length} contacts`);

      // Print first result as sample
      if (results[0]) {
        console.log(`  Sample: "${results[0].reasoning.slice(0, 150)}..."`);
      }
    } catch (parseErr) {
      console.error(`  [ERROR] Failed to parse Claude response: ${parseErr.message}`);
      console.error(`  Response preview: ${response.slice(0, 300)}`);
      totalErrors += withEngagements.length;
    }

    await sleep(500);
  }

  try { fs.unlinkSync(TEMP_PROMPT_PATH); } catch {}

  console.log('\n=== RESULTS ===');
  console.log(`Updated: ${totalUpdated}`);
  console.log(`No engagements: ${totalNoEngagements}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Skipped (already enriched): ${skipped}`);

  db.close();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
