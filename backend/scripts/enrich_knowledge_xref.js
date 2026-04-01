#!/usr/bin/env node
/**
 * Second-pass Knowledge Base Cross-Reference Enrichment
 *
 * Cross-references HubSpot contact classifications with Sangha's internal
 * knowledge base (entities, entries, Drive files) to correct misclassifications
 * and add deeper context.
 *
 * The first pass (enrich_batched.js) uses HubSpot engagement data only.
 * This second pass checks the Coppice knowledge base for internal context
 * that the engagement-based enrichment misses - e.g., internal employees
 * classified as clients, partners known from meeting transcripts, etc.
 *
 * Usage:
 *   node scripts/enrich_knowledge_xref.js [--limit N] [--batch-size N] [--dry-run]
 *
 * Does NOT call HubSpot API - reads entirely from local DB tables.
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '..', 'data', 'sangha', 'sangha.db');
const TEMP_PROMPT_PATH = '/tmp/enrich_xref_prompt.txt';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const LIMIT = getArg('--limit', 0);
const BATCH_SIZE = getArg('--batch-size', 5);
const DRY_RUN = args.includes('--dry-run');

function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : fallback;
}

// ---------------------------------------------------------------------------
// Name matching utilities
// ---------------------------------------------------------------------------

/**
 * Normalize a name for fuzzy matching: lowercase, strip suffixes/titles,
 * collapse whitespace.
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|phd|md|esq|cpa|pe|cfa)\b\.?/gi, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract first name and last name tokens from a full name.
 */
function nameTokens(name) {
  const parts = normalizeName(name).split(' ').filter(Boolean);
  return parts;
}

/**
 * Check if two names match - either exact normalized match or
 * first+last name match (handles middle names, suffixes, etc.)
 */
function namesMatch(nameA, nameB) {
  if (!nameA || !nameB) return false;
  const normA = normalizeName(nameA);
  const normB = normalizeName(nameB);

  // Exact match
  if (normA === normB) return true;

  // Token-based: both first and last name must match
  const tokA = nameTokens(nameA);
  const tokB = nameTokens(nameB);
  if (tokA.length < 2 || tokB.length < 2) return false;

  // First name match + last name match
  const firstMatch = tokA[0] === tokB[0];
  const lastMatch = tokA[tokA.length - 1] === tokB[tokB.length - 1];
  return firstMatch && lastMatch;
}

/**
 * Check if a contact's name matches an entity name.
 * Returns a score: 0 = no match, 2 = full match
 * We only do full name matching (first + last) to avoid false positives
 * like "Patrick West" matching "ERCOT West" or "Michael Alvarez" matching
 * "Miguel Alvarez".
 */
function nameMatchScore(contactName, entityName) {
  if (!contactName || !entityName) return 0;
  if (namesMatch(contactName, entityName)) return 2;
  return 0;
}

// ---------------------------------------------------------------------------
// Knowledge base search functions
// ---------------------------------------------------------------------------

/**
 * Search knowledge_entities for matches to a contact's name, email, or company.
 * Returns array of matched entities with metadata.
 */
function searchEntities(db, contact) {
  const matches = [];

  // Get all entities (both 'default' and 'sangha' tenant IDs, since Sangha
  // data lives under tenant_id = 'default')
  const entities = db.prepare(
    "SELECT id, entity_type, name, metadata_json FROM knowledge_entities WHERE tenant_id IN ('default', 'sangha')"
  ).all();

  for (const entity of entities) {
    let matchType = null;
    let score = 0;

    // Match by name
    const nameScore = nameMatchScore(contact.name, entity.name);
    if (nameScore === 2) {
      matchType = 'exact_name';
      score = 10;
    } else if (nameScore === 1) {
      matchType = 'partial_name';
      score = 3;
    }

    // Match company name against company entities
    if (!matchType && entity.entity_type === 'company' && contact.company) {
      const entityNameNorm = normalizeName(entity.name);
      const contactCompanyNorm = normalizeName(contact.company);
      if (entityNameNorm && contactCompanyNorm) {
        if (entityNameNorm === contactCompanyNorm) {
          matchType = 'exact_company';
          score = 8;
        } else {
          // For partial company matching, require:
          // 1. The shorter name is at least 5 chars (avoid "aes" matching everything)
          // 2. The match is on a meaningful word, not just a common word like "energy"/"renewables"
          const shorter = entityNameNorm.length <= contactCompanyNorm.length ? entityNameNorm : contactCompanyNorm;
          const longer = entityNameNorm.length > contactCompanyNorm.length ? entityNameNorm : contactCompanyNorm;
          const commonWords = new Set([
            'energy', 'energies', 'renewables', 'renewable', 'power', 'solar',
            'partners', 'capital', 'systems', 'group', 'inc', 'llc', 'corp',
            'company', 'the', 'investments', 'electric', 'grid', 'scale',
            'technologies', 'technology', 'services', 'solutions', 'global',
            'international', 'management', 'resources', 'development',
          ]);
          // Get meaningful words (non-common, 4+ chars) from both names
          const entityWords = entityNameNorm.split(' ').filter(w => w.length >= 4 && !commonWords.has(w));
          const companyWords = contactCompanyNorm.split(' ').filter(w => w.length >= 4 && !commonWords.has(w));
          // Check if any meaningful word overlaps
          const meaningfulOverlap = entityWords.some(w => companyWords.includes(w));
          if (meaningfulOverlap && shorter.length >= 5) {
            matchType = 'partial_company';
            score = 5;
          } else if (shorter.length >= 6 && longer.startsWith(shorter)) {
            // Also match if one is a prefix of the other (e.g., "Sangha" in "Sangha Renewables")
            matchType = 'partial_company';
            score = 5;
          }
        }
      }
    }

    // Match email domain against company entities
    if (!matchType && entity.entity_type === 'company' && contact.email) {
      const fullDomain = (contact.email.split('@')[1] || '').toLowerCase();
      const domainBase = fullDomain.split('.')[0];
      const entityNameNorm = entity.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (domainBase && domainBase.length >= 4 && entityNameNorm) {
        // Check if domain starts with entity name or vice versa
        // This catches "sangharenewables.com" -> "sangharenewables" starts with "sangha"
        // But avoids "renewa.com" -> "renewa" being found inside "sangharenewables"
        if (entityNameNorm.startsWith(domainBase) || domainBase.startsWith(entityNameNorm)) {
          matchType = 'domain_company';
          score = 6;
        }
        // Also allow exact domain match (e.g., "totalenergies.com" and entity "Total Energies" -> "totalenergies")
        if (!matchType && domainBase === entityNameNorm) {
          matchType = 'domain_company';
          score = 6;
        }
      }
    }

    if (matchType) {
      let metadata = {};
      try { metadata = entity.metadata_json ? JSON.parse(entity.metadata_json) : {}; } catch {}
      matches.push({
        entity_id: entity.id,
        entity_type: entity.entity_type,
        entity_name: entity.name,
        match_type: matchType,
        score,
        role: metadata.role || null,
        metadata,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

/**
 * Search knowledge_entries linked to matched entities via knowledge_links.
 * Returns array of entry summaries.
 */
function searchLinkedEntries(db, entityIds) {
  if (!entityIds.length) return [];

  const placeholders = entityIds.map(() => '?').join(',');
  const links = db.prepare(
    `SELECT kl.entry_id, kl.entity_id, kl.relationship, ke.type, ke.title,
            substr(ke.summary, 1, 500) as summary, substr(ke.content, 1, 500) as content_preview,
            ke.source, ke.created_at
     FROM knowledge_links kl
     JOIN knowledge_entries ke ON kl.entry_id = ke.id
     WHERE kl.entity_id IN (${placeholders})
     ORDER BY ke.created_at DESC
     LIMIT 10`
  ).all(...entityIds);

  return links.map(l => ({
    entry_id: l.entry_id,
    entity_id: l.entity_id,
    relationship: l.relationship,
    type: l.type,
    title: l.title,
    summary: l.summary || l.content_preview || '',
    source: l.source,
    created_at: l.created_at,
  }));
}

/**
 * Search drive_fts (full-text search) for mentions of a contact's name.
 * Returns array of matching Drive file references.
 */
function searchDriveFiles(db, contactName) {
  if (!contactName || contactName.length < 3) return [];

  const tokens = nameTokens(contactName);
  if (tokens.length < 2) return [];

  // Use the full name as FTS query - quote it to search as phrase
  const ftsQuery = `"${tokens.join(' ')}"`;

  try {
    // Check if drive_fts has any rows first
    const ftsCount = db.prepare('SELECT COUNT(*) as cnt FROM drive_fts').get().cnt;
    if (ftsCount === 0) return [];

    const results = db.prepare(
      `SELECT drive_file_id, name, substr(content_text, 1, 300) as snippet
       FROM drive_fts
       WHERE drive_fts MATCH ?
       ORDER BY rank
       LIMIT 5`
    ).all(ftsQuery);

    return results.map(r => ({
      drive_file_id: r.drive_file_id,
      file_name: r.name,
      snippet: r.snippet || '',
    }));
  } catch {
    // FTS query can fail on certain inputs - just return empty
    return [];
  }
}

/**
 * Also check drive_synced_files directly if FTS is empty
 * (searches file names for the contact's name)
 */
function searchDriveFilesByName(db, contactName) {
  if (!contactName || contactName.length < 3) return [];

  const tokens = nameTokens(contactName);
  if (tokens.length < 2) return [];

  // Search file names containing the last name
  const lastName = tokens[tokens.length - 1];
  if (lastName.length < 3) return [];

  try {
    const results = db.prepare(
      `SELECT id, name, substr(content_text, 1, 300) as snippet, has_content
       FROM drive_synced_files
       WHERE tenant_id IN ('default', 'sangha')
         AND LOWER(name) LIKE ?
       LIMIT 5`
    ).all(`%${lastName}%`);

    return results.map(r => ({
      drive_file_id: r.id,
      file_name: r.name,
      snippet: r.has_content ? (r.snippet || '') : '',
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Build context package for a contact
// ---------------------------------------------------------------------------

function buildKnowledgeContext(db, contact) {
  // 1. Search entities
  const entityMatches = searchEntities(db, contact);
  if (entityMatches.length === 0) return null;

  // 2. Search linked entries
  const entityIds = entityMatches.map(e => e.entity_id);
  const linkedEntries = searchLinkedEntries(db, entityIds);

  // 3. Search Drive files (FTS first, then filename fallback)
  let driveFiles = searchDriveFiles(db, contact.name);
  if (driveFiles.length === 0) {
    driveFiles = searchDriveFilesByName(db, contact.name);
  }

  // Build context object
  return {
    entities: entityMatches,
    linkedEntries,
    driveFiles,
    hasStrongMatch: entityMatches.some(e => e.score >= 8),
    isInternalEmployee: entityMatches.some(
      e => e.entity_type === 'person' && e.score >= 8 && e.role
    ),
    bestEntityMatch: entityMatches[0] || null,
  };
}

/**
 * Format knowledge context into a human-readable string for the Claude prompt.
 */
function formatKnowledgeContext(ctx) {
  const lines = [];

  // Entity matches
  if (ctx.entities.length > 0) {
    lines.push('KNOWLEDGE BASE ENTITIES:');
    for (const e of ctx.entities) {
      let desc = `  - [${e.entity_type}] "${e.entity_name}" (match: ${e.match_type}, score: ${e.score})`;
      if (e.role) desc += ` - Role: ${e.role}`;
      if (Object.keys(e.metadata).length > 0 && !e.role) {
        desc += ` - Metadata: ${JSON.stringify(e.metadata)}`;
      }
      lines.push(desc);
    }
  }

  // Linked knowledge entries
  if (ctx.linkedEntries.length > 0) {
    lines.push('LINKED KNOWLEDGE ENTRIES:');
    for (const entry of ctx.linkedEntries) {
      lines.push(`  - [${entry.type}] "${entry.title}" (${entry.created_at || 'unknown date'})`);
      lines.push(`    Relationship: ${entry.relationship || 'mentioned'}`);
      if (entry.summary) {
        lines.push(`    Summary: ${entry.summary.slice(0, 300)}`);
      }
    }
  }

  // Drive file mentions
  if (ctx.driveFiles.length > 0) {
    lines.push('DRIVE FILE MENTIONS:');
    for (const df of ctx.driveFiles) {
      lines.push(`  - File: "${df.file_name}"`);
      if (df.snippet) {
        lines.push(`    Snippet: ${df.snippet.slice(0, 200)}`);
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Claude CLI integration
// ---------------------------------------------------------------------------

function callClaude(prompt) {
  fs.writeFileSync(TEMP_PROMPT_PATH, prompt, 'utf8');
  const env = { ...process.env };
  delete env.CLAUDECODE;
  try {
    const result = execSync(`claude -p < "${TEMP_PROMPT_PATH}"`, {
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 2 * 1024 * 1024,
      shell: true,
      env,
    });
    return result.trim();
  } catch (err) {
    console.error(`  [WARN] Claude CLI error: ${(err.stderr || err.message || '').slice(0, 300)}`);
    return null;
  }
}

function buildBatchPrompt(contactsWithContext) {
  let prompt = `You are performing a second-pass knowledge base cross-reference for Sangha Systems (a renewable energy developer and Bitcoin mining infrastructure company). The first pass classified HubSpot contacts using engagement data only. Now you have INTERNAL knowledge base context - entities, meeting notes, and Drive files from Sangha's Coppice platform.

Your job:
1. Check if the current classification is correct given the internal context
2. If the person is an internal Sangha employee or founder (appears in knowledge_entities as a person with a role), classify them as industry="Renewable Energy", reason="Friend"
3. If meeting notes or Drive files reveal they are a different type of contact than currently classified, correct the classification
4. Reference specific knowledge entries (entity descriptions, meeting titles, Drive docs) in your reasoning
5. If the current classification seems fine, keep it but enrich the reasoning with the internal context

IMPORTANT RULES:
- Do NOT use em dashes (the long dash character). Use regular hyphens only.
- Return ONLY a JSON array. No markdown, no explanation outside the JSON.
- Format: [{"id": "hubspot_id", "industry": "...", "reason": "...", "reasoning": "...", "changed": true/false}]
- "changed" should be true only if you modified industry or reason from the original
- Valid industry values: "Renewable Energy", "Bitcoin mining", "Bitcoin services", "Investment/Finance", "Legal", "Insurance", "Engineering", "Construction", "Real Estate", "Electrical Equipment", "Operations Management", "SaaS - Web 2", "Other"
- Valid reason values: "Potential IPP Client", "Technical Support", "Marketing Opportunities", "Friend", "Investment - DevCo", "Advisor", "Other"

`;

  for (let i = 0; i < contactsWithContext.length; i++) {
    const { contact, context } = contactsWithContext[i];
    const c = contact;
    const ctxStr = formatKnowledgeContext(context);

    prompt += `--- CONTACT ${i + 1} ---
HubSpot ID: ${c.hubspot_id}
Name: ${c.name || '(unknown)'}
Email: ${c.email || '?'}
Company: ${c.company || '?'}
Title: ${c.title || '?'}
Domain: ${c.domain || '?'}
Current Classification: ${c.industry} / ${c.reason}
Current Reasoning: ${(c.reasoning || '').slice(0, 300)}

${ctxStr}

`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Markers to detect if already cross-referenced
// ---------------------------------------------------------------------------

const XREF_MARKERS = [
  'knowledge base',
  'internal employee',
  'internal contact identified',
  'knowledge entity',
  'cross-reference',
  'coppice knowledge',
  'sangha employee',
  'sangha team member',
  'internal team member',
  'knowledge entry',
];

function isAlreadyXrefEnriched(reasoning) {
  if (!reasoning) return false;
  const lower = reasoning.toLowerCase();
  return XREF_MARKERS.some(m => lower.includes(m));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Knowledge Base Cross-Reference Enrichment (Second Pass) ===\n');
  console.log(`DB: ${DB_PATH}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} contacts`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  if (DRY_RUN) console.log('** DRY RUN - no DB writes **');
  console.log('');

  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // Stats
  const totalContacts = db.prepare('SELECT COUNT(*) as cnt FROM hubspot_classifications').get().cnt;
  const entityCount = db.prepare("SELECT COUNT(*) as cnt FROM knowledge_entities WHERE tenant_id IN ('default', 'sangha')").get().cnt;
  const entryCount = db.prepare("SELECT COUNT(*) as cnt FROM knowledge_entries WHERE tenant_id IN ('default', 'sangha')").get().cnt;
  const driveCount = db.prepare("SELECT COUNT(*) as cnt FROM drive_synced_files WHERE tenant_id IN ('default', 'sangha')").get().cnt;
  let ftsCount = 0;
  try { ftsCount = db.prepare('SELECT COUNT(*) as cnt FROM drive_fts').get().cnt; } catch {}

  console.log(`HubSpot contacts: ${totalContacts}`);
  console.log(`Knowledge entities: ${entityCount}`);
  console.log(`Knowledge entries: ${entryCount}`);
  console.log(`Drive synced files: ${driveCount}`);
  console.log(`Drive FTS entries: ${ftsCount}`);
  console.log('');

  // Load all contacts
  const allContacts = db.prepare(
    'SELECT * FROM hubspot_classifications ORDER BY confidence DESC'
  ).all();

  // Phase 1: Find contacts with knowledge base matches
  console.log('Phase 1: Scanning contacts for knowledge base matches...\n');

  const contactsWithContext = [];
  let scanned = 0;
  let matchFound = 0;
  let skippedAlreadyXref = 0;

  for (const contact of allContacts) {
    if (LIMIT && contactsWithContext.length >= LIMIT) break;

    // Skip already cross-referenced
    if (isAlreadyXrefEnriched(contact.reasoning)) {
      skippedAlreadyXref++;
      continue;
    }

    scanned++;
    const context = buildKnowledgeContext(db, contact);
    if (context) {
      contactsWithContext.push({ contact, context });
      matchFound++;
    }
  }

  console.log(`Scanned: ${scanned} contacts`);
  console.log(`Knowledge base matches found: ${matchFound}`);
  console.log(`Skipped (already cross-referenced): ${skippedAlreadyXref}`);
  console.log('');

  if (contactsWithContext.length === 0) {
    console.log('No contacts with knowledge base matches to process. Done.');
    db.close();
    return;
  }

  // Summarize match types
  const strongMatches = contactsWithContext.filter(c => c.context.hasStrongMatch);
  const internalEmployees = contactsWithContext.filter(c => c.context.isInternalEmployee);
  console.log(`Strong matches (score >= 8): ${strongMatches.length}`);
  console.log(`Likely internal employees: ${internalEmployees.length}`);
  console.log('');

  // Print all matches in dry-run or verbose mode
  console.log('--- MATCHED CONTACTS ---');
  for (let i = 0; i < contactsWithContext.length; i++) {
    const { contact, context } = contactsWithContext[i];
    const c = contact;
    const best = context.bestEntityMatch;
    const flag = context.isInternalEmployee ? ' [INTERNAL]' : '';
    console.log(
      `  ${i + 1}. ${c.name || c.email || '(unknown)'} | ${c.company || c.domain || '?'} | ` +
      `Currently: ${c.industry}/${c.reason} | ` +
      `Best match: [${best.entity_type}] "${best.entity_name}" (${best.match_type}, score=${best.score})${flag}`
    );
    if (context.linkedEntries.length > 0) {
      console.log(`     Linked entries: ${context.linkedEntries.map(e => `"${e.title}"`).join(', ')}`);
    }
    if (context.driveFiles.length > 0) {
      console.log(`     Drive files: ${context.driveFiles.map(f => `"${f.file_name}"`).join(', ')}`);
    }
  }
  console.log('');

  // Phase 2: Send batches to Claude for classification correction
  if (DRY_RUN) {
    console.log('** DRY RUN - skipping Claude calls and DB updates **');
    console.log(`Would process ${contactsWithContext.length} contacts in ${Math.ceil(contactsWithContext.length / BATCH_SIZE)} batches\n`);

    // Show sample prompt for first batch
    const sampleBatch = contactsWithContext.slice(0, Math.min(BATCH_SIZE, contactsWithContext.length));
    const samplePrompt = buildBatchPrompt(sampleBatch);
    console.log('--- SAMPLE PROMPT (first batch) ---');
    console.log(samplePrompt.slice(0, 2000));
    if (samplePrompt.length > 2000) console.log(`... (${samplePrompt.length} total chars)`);
    console.log('--- END SAMPLE PROMPT ---\n');

    db.close();
    return;
  }

  console.log(`Phase 2: Sending ${contactsWithContext.length} contacts to Claude in batches of ${BATCH_SIZE}...\n`);

  const updateStmt = db.prepare(
    'UPDATE hubspot_classifications SET industry = ?, reason = ?, reasoning = ? WHERE hubspot_id = ?'
  );
  let totalUpdated = 0;
  let totalChanged = 0;
  let totalErrors = 0;

  for (let batchStart = 0; batchStart < contactsWithContext.length; batchStart += BATCH_SIZE) {
    const batch = contactsWithContext.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(contactsWithContext.length / BATCH_SIZE);

    console.log(`\n--- Batch ${batchNum}/${totalBatches} (${batch.length} contacts) ---`);

    const prompt = buildBatchPrompt(batch);
    console.log(`  Prompt size: ${prompt.length} chars`);

    const response = callClaude(prompt);
    if (!response) {
      console.log('  [ERROR] Claude returned nothing for this batch');
      totalErrors += batch.length;
      continue;
    }

    // Parse JSON response
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      const results = JSON.parse(jsonMatch[0]);

      const tx = db.transaction(() => {
        for (const r of results) {
          if (!r.id || !r.reasoning || r.reasoning.length < 20) continue;
          const clean = r.reasoning.replace(/\u2014/g, ' - ').replace(/\u2013/g, '-');
          const industry = r.industry || 'Other';
          const reason = r.reason || 'Other';

          updateStmt.run(industry, reason, clean, r.id);
          totalUpdated++;
          if (r.changed) totalChanged++;

          const changeLabel = r.changed ? ' [CHANGED]' : '';
          console.log(`  Updated: ${r.id} -> ${industry}/${reason}${changeLabel}`);
        }
      });
      tx();

      console.log(`  Batch complete: ${results.length} processed`);
    } catch (parseErr) {
      console.error(`  [ERROR] Failed to parse Claude response: ${parseErr.message}`);
      console.error(`  Response preview: ${response.slice(0, 400)}`);
      totalErrors += batch.length;
    }
  }

  // Cleanup
  try { fs.unlinkSync(TEMP_PROMPT_PATH); } catch {}

  console.log('\n=== RESULTS ===');
  console.log(`Contacts with knowledge matches: ${contactsWithContext.length}`);
  console.log(`Updated: ${totalUpdated}`);
  console.log(`Classifications changed: ${totalChanged}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Skipped (already cross-referenced): ${skippedAlreadyXref}`);

  db.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
