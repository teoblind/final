#!/usr/bin/env node
/**
 * DACP Construction — Real Lead Engine Discovery
 *
 * Runs 10 Perplexity queries for Houston/DFW GC leads,
 * parses/scores/dedupes, enriches contacts, generates outreach,
 * creates Excel workbook, seeds approval queue.
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'cache.db');
const TENANT_ID = 'dacp-construction-001';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ─── API Clients ────────────────────────────────────────────────────────────

async function callPerplexity(system, user) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY not set');

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Perplexity API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callClaude(model, system, user) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model, max_tokens: 4096, system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function validateMx(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;
  try {
    const records = await dns.promises.resolveMx(domain);
    return records && records.length > 0;
  } catch { return false; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── DACP Scoring ───────────────────────────────────────────────────────────

const KNOWN_GCS = ['turner', 'dpr', 'mccarthy', 'hensel phelps', 'skanska', 'rogers-o\'brien', 'rogers o\'brien', 'austin commercial'];

function scoreLead(lead) {
  let score = 0;
  const loc = (lead.location || '').toLowerCase();
  const gc = (lead.gc_name || '').toLowerCase();
  const scope = (lead.concrete_scope || '').toLowerCase();
  const type = (lead.project_type || '').toLowerCase();
  const status = (lead.status || '').toLowerCase();
  const value = lead.estimated_value || '';

  // Location
  if (/houston|katy|sugar land|pasadena|baytown|the woodlands|pearland|league city|galveston|humble|spring|cypress|tomball|conroe/.test(loc)) score += 25;
  else if (/dallas|fort worth|dfw|arlington|plano|frisco|mckinney|irving|denton|garland|richardson/.test(loc)) score += 15;
  else if (/austin|san antonio|texas|tx/.test(loc)) score += 10;

  // Known GCs
  if (KNOWN_GCS.some(k => gc.includes(k))) score += 20;

  // Concrete scope mentioned
  if (/concrete|foundation|slab|pier|retaining|curb|gutter|sidewalk|flatwork|post.?tension|tilt.?wall|grade beam|footing/.test(scope)) score += 15;

  // Status
  if (/bidding|pre.?con|pre.?construction|rfq|rfp/.test(status)) score += 15;
  else if (/planned|approved|permitted/.test(status)) score += 10;
  else if (/under.?construction/.test(status)) score -= 20;

  // Value
  const valMatch = value.match(/\$?\s*(\d+(?:\.\d+)?)\s*(million|m|billion|b)/i);
  if (valMatch) {
    let num = parseFloat(valMatch[1]);
    if (/billion|b/i.test(valMatch[2])) num *= 1000;
    if (num > 10) score += 10;
  }

  // Project type
  if (/healthcare|hospital|medical/.test(type)) score += 10;
  else if (/education|school|university/.test(type)) score += 10;
  else if (/commercial|office|retail/.test(type)) score += 10;
  else if (/data.?center|industrial|warehouse/.test(type)) score += 8;
  else if (/residential|apartment/.test(type)) score -= 10;

  // Texas filter
  if (!/texas|tx|houston|dallas|dfw|austin|san antonio|fort worth/.test(loc) && loc.length > 0) score -= 15;

  return Math.max(0, Math.min(100, score));
}

// ─── Discovery Queries ──────────────────────────────────────────────────────

const QUERIES = [
  'commercial construction project Houston 2026 general contractor concrete',
  'hospital expansion Houston Texas 2026 contractor bid invitation',
  'new warehouse construction DFW Texas general contractor 2026',
  'school bond construction Texas 2026 concrete subcontractor RFQ',
  'mixed use development Houston 2026 concrete foundation',
  'data center construction Texas 2026 general contractor foundation',
  'apartment complex construction Houston Dallas 2026 contractor',
  'retail center development Houston Texas 2026 new construction',
  'Turner McCarthy DPR Hensel Phelps Houston project 2026',
  'concrete subcontractor bid opportunity Texas commercial 2026',
];

const PERPLEXITY_SYSTEM = `You are a construction industry research analyst. Search for REAL, specific construction projects and general contractors.

For each result, return a JSON array of objects with these exact fields:
- project_name: the actual project name
- gc_name: the general contractor company name
- gc_contact_name: a specific person's name if found (or null)
- gc_contact_email: a specific email if found (or null)
- location: "City, TX" format
- project_type: one of: healthcare, education, retail, commercial, industrial, data_center, mixed_use, residential, hospitality, infrastructure
- estimated_value: dollar amount if known (e.g. "$50 million") or null
- concrete_scope: description of likely concrete work (foundations, slabs, etc.)
- bid_date: if known, or null
- status: one of: bidding, pre_construction, under_construction, planned
- source_url: source URL if available
- trigger_news: why this is a lead right now (1 sentence)

Return ONLY valid JSON array. No commentary before or after. Include 3-8 results per query. Focus on Texas projects only.`;

// ─── Main Pipeline ──────────────────────────────────────────────────────────

async function runDiscovery() {
  console.log('=== DACP Discovery Pipeline ===\n');

  // STEP 1: Run Perplexity queries
  console.log('STEP 1: Running 10 Perplexity discovery queries...');
  const allRawLeads = [];

  for (let i = 0; i < QUERIES.length; i += 2) {
    const pair = QUERIES.slice(i, i + 2);
    console.log(`  Queries ${i + 1}-${i + 2}: "${pair[0].slice(0, 50)}..." and "${pair[1]?.slice(0, 50) || 'N/A'}..."`);

    for (const query of pair) {
      try {
        const raw = await callPerplexity(PERPLEXITY_SYSTEM, query);
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const lead of parsed) {
            lead._source_query = query;
            allRawLeads.push(lead);
          }
          console.log(`    → ${parsed.length} results from query`);
        } else {
          console.log(`    → No JSON in response`);
        }
      } catch (err) {
        console.error(`    → Error: ${err.message}`);
      }
    }

    if (i + 2 < QUERIES.length) {
      console.log('  Waiting 30s...');
      await sleep(30000);
    }
  }

  console.log(`\n  Total raw results: ${allRawLeads.length}`);

  // STEP 2: Deduplicate and score
  console.log('\nSTEP 2: Deduplicating and scoring...');
  const seen = new Set();
  const leads = [];

  for (const lead of allRawLeads) {
    if (!lead.project_name || !lead.gc_name) continue;
    const key = `${lead.project_name.toLowerCase().trim()}|${lead.gc_name.toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    lead.priority_score = scoreLead(lead);
    leads.push(lead);
  }

  // Sort by priority
  leads.sort((a, b) => b.priority_score - a.priority_score);
  console.log(`  Unique leads after dedup: ${leads.length}`);
  console.log(`  Top 5 by score:`);
  for (const l of leads.slice(0, 5)) {
    console.log(`    ${l.priority_score} — ${l.gc_name}: ${l.project_name} (${l.location})`);
  }

  // STEP 3: Save to database
  console.log('\nSTEP 3: Saving leads to database...');

  // Clear old discovery leads for DACP — delete contacts/outreach first (FK constraints)
  const oldLeadIds = db.prepare('SELECT id FROM le_leads WHERE tenant_id = ? AND source = ?').all(TENANT_ID, 'discovery').map(r => r.id);
  if (oldLeadIds.length > 0) {
    for (const lid of oldLeadIds) {
      db.prepare('DELETE FROM le_outreach_log WHERE tenant_id = ? AND lead_id = ?').run(TENANT_ID, lid);
      db.prepare('DELETE FROM le_contacts WHERE tenant_id = ? AND lead_id = ?').run(TENANT_ID, lid);
    }
    db.prepare('DELETE FROM le_leads WHERE tenant_id = ? AND source = ?').run(TENANT_ID, 'discovery');
  }

  const insertLead = db.prepare(`
    INSERT OR IGNORE INTO le_leads (id, tenant_id, venue_name, region, industry, trigger_news, priority_score, website, status, source, source_query, discovered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', 'discovery', ?, datetime('now'))
  `);

  const leadMap = new Map(); // gc+project → leadId

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const leadId = `LEAD-DACP-${Date.now()}-${i}`;
    lead._id = leadId;

    const venueName = `${lead.project_name} (${lead.gc_name})`;
    const result = insertLead.run(
      leadId, TENANT_ID, venueName, lead.location || 'Texas',
      lead.project_type || 'commercial', lead.trigger_news || null,
      lead.priority_score, lead.source_url || null, lead._source_query || null
    );

    if (result.changes > 0) {
      leadMap.set(leadId, lead);
    }
  }

  console.log(`  Inserted ${leadMap.size} leads into database`);

  // STEP 4: Contact enrichment for top 20
  console.log('\nSTEP 4: Enriching contacts for top 20 leads...');
  const topLeads = leads.slice(0, 20);

  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO le_contacts (id, tenant_id, lead_id, name, email, title, phone, source, mx_valid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'enrichment', ?, datetime('now'))
  `);

  const updateLeadStatus = db.prepare('UPDATE le_leads SET status = ? WHERE id = ? AND tenant_id = ?');
  let totalContacts = 0;

  // First, insert any contacts found during discovery
  for (const lead of leads) {
    if (lead.gc_contact_email && lead._id) {
      const mx = await validateMx(lead.gc_contact_email);
      const contactId = `CONTACT-DACP-${Date.now()}-disc-${totalContacts}`;
      try {
        insertContact.run(contactId, TENANT_ID, lead._id, lead.gc_contact_name || null, lead.gc_contact_email, null, null, mx ? 1 : 0);
        totalContacts++;
      } catch (e) { /* dup */ }
    }
  }

  // Enrich top 20 via Perplexity
  for (let i = 0; i < topLeads.length; i += 2) {
    const batch = topLeads.slice(i, i + 2);

    for (const lead of batch) {
      if (!lead._id || !leadMap.has(lead._id)) continue;

      try {
        const enrichSystem = `You are a contact researcher for the construction industry. Find email addresses for estimating/preconstruction contacts at the given general contractor.

Target these titles in priority order:
1. Preconstruction Manager
2. Senior Estimator
3. Project Manager
4. VP of Preconstruction
5. General estimating inbox (estimating@company.com)

Return a JSON array of objects with: name, email, title, phone (if available).
Return ONLY valid JSON. Max 3 contacts per GC. Do NOT include noreply@, info@, contact@, support@, careers@, or social media emails.`;

        const enrichQuery = `Find estimating/preconstruction contact emails for ${lead.gc_name}. Focus on their Houston or Texas office. Their website may be ${lead.source_url || 'unknown'}. Check for estimating@${lead.gc_name.toLowerCase().replace(/[^a-z]/g, '')}.com or similar.`;

        const raw = await callPerplexity(enrichSystem, enrichQuery);
        const jsonMatch = raw.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
          const contacts = JSON.parse(jsonMatch[0]);
          let addedAny = false;

          for (let j = 0; j < Math.min(contacts.length, 3); j++) {
            const c = contacts[j];
            if (!c.email) continue;

            // Filter junk
            const lower = c.email.toLowerCase();
            if (/^(noreply|no-reply|info@|support@|admin@|contact@|hello@|careers@|marketing@|webmaster@|sales@)/.test(lower)) continue;
            if (/(facebook|twitter|linkedin|instagram|gmail|yahoo|hotmail|outlook)\.com/.test(lower)) continue;

            const mx = await validateMx(c.email);
            const contactId = `CONTACT-DACP-${Date.now()}-${totalContacts}`;
            try {
              insertContact.run(contactId, TENANT_ID, lead._id, c.name || null, c.email, c.title || null, c.phone || null, mx ? 1 : 0);
              addedAny = true;
              totalContacts++;
              lead._contacts = lead._contacts || [];
              lead._contacts.push({ id: contactId, ...c, mx_valid: mx });
            } catch (e) { /* dup */ }
          }

          if (addedAny) {
            updateLeadStatus.run('enriched', lead._id, TENANT_ID);
          }
          console.log(`  ${lead.gc_name}: ${contacts.length} contacts found, ${addedAny ? 'saved' : 'none valid'}`);
        }
      } catch (err) {
        console.error(`  ${lead.gc_name}: enrichment error — ${err.message}`);
      }
    }

    if (i + 2 < topLeads.length) {
      console.log('  Waiting 15s...');
      await sleep(15000);
    }
  }

  console.log(`  Total contacts saved: ${totalContacts}`);

  // STEP 5: Generate outreach for top 5
  console.log('\nSTEP 5: Generating outreach emails for top 5 leads...');

  const insertOutreach = db.prepare(`
    INSERT INTO le_outreach_log (id, tenant_id, lead_id, contact_id, email_type, subject, body, status, created_at)
    VALUES (?, ?, ?, ?, 'initial', ?, ?, 'pending_approval', datetime('now'))
  `);

  const outreachDrafts = [];
  const outreachLeads = topLeads.filter(l => l._contacts && l._contacts.length > 0).slice(0, 5);

  for (let i = 0; i < outreachLeads.length; i++) {
    const lead = outreachLeads[i];
    const contact = lead._contacts[0];

    try {
      const emailContent = await callClaude('claude-sonnet-4-20250514',
        `You are drafting a cold outreach email from David Castillo at DACP Construction, a concrete subcontractor in Houston, TX.

DACP specializes in:
- Slab-on-grade (commercial, industrial)
- Foundations (drilled piers, grade beams, strip footings)
- Curb & gutter, sidewalks
- Retaining walls (cantilever, segmental)
- Elevated slabs and post-tension

Recent completed projects (use ONE as social proof):
- Memorial Hermann Phase 2 ($266K concrete package, Turner Construction)
- Samsung Fab Equipment Pads ($185K, DPR Construction)
- Cypress Creek Elementary ($328K, Rogers-O'Brien)
- TMC Building 7 ($445K, DPR Construction)

DACP's edge: AI-powered estimating that turns around detailed bids within 24 hours.
Win rate: 62% on foundation work.

Write in a blue-collar professional voice. Short, direct, no fluff. Concrete subs don't write corporate emails. Keep under 120 words. End with a phone number (832-555-0147) and CTA.

Format your response EXACTLY as:
SUBJECT: [subject line]
---
[email body]`,

        `Draft outreach to:
GC: ${lead.gc_name}
Project: ${lead.project_name}
Location: ${lead.location || 'Houston, TX'}
Type: ${lead.project_type || 'commercial'}
Value: ${lead.estimated_value || 'unknown'}
Concrete Scope: ${lead.concrete_scope || 'typical commercial concrete package'}
Contact: ${contact.name || 'Estimating Department'}
Title: ${contact.title || ''}`
      );

      const parts = emailContent.split('---');
      const subject = (parts[0] || '').replace(/SUBJECT:\s*/i, '').trim();
      const body = parts.slice(1).join('---').trim();

      if (subject && body) {
        const outreachId = `OUT-DACP-${Date.now()}-${i}`;
        insertOutreach.run(outreachId, TENANT_ID, lead._id, contact.id, subject, body);
        updateLeadStatus.run('contacted', lead._id, TENANT_ID);

        outreachDrafts.push({
          outreach_id: outreachId,
          lead_id: lead._id,
          gc_name: lead.gc_name,
          project_name: lead.project_name,
          contact_name: contact.name,
          contact_email: contact.email,
          subject, body,
        });

        console.log(`  ✓ ${lead.gc_name} — "${subject}"`);
      }
    } catch (err) {
      console.error(`  ✗ ${lead.gc_name}: ${err.message}`);
    }
  }

  // STEP 6: Generate Excel
  console.log('\nSTEP 6: Generating Excel workbook...');

  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Coppice Lead Engine';
  workbook.created = new Date();

  // Sheet 1: GC Leads & Projects
  const sheet1 = workbook.addWorksheet('GC Leads & Projects');

  // Title rows
  sheet1.mergeCells('A1:K1');
  sheet1.getCell('A1').value = 'DACP CONSTRUCTION — GC LEAD DISCOVERY REPORT';
  sheet1.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  sheet1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };

  sheet1.mergeCells('A2:K2');
  sheet1.getCell('A2').value = `Generated: March 9, 2026 | Source: Coppice Lead Engine (Perplexity Sonar) | Market: Houston / DFW Metro`;
  sheet1.getCell('A2').font = { size: 10, italic: true };

  // Header row
  const headers1 = ['Priority', 'General Contractor', 'Project Name', 'Location', 'Project Type', 'Estimated Value', 'Concrete Scope', 'Status', 'Bid Date', 'Why Now', 'Source URL'];
  const headerRow1 = sheet1.addRow(headers1);
  headerRow1.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  for (const lead of leads) {
    const isKnownGC = KNOWN_GCS.some(k => (lead.gc_name || '').toLowerCase().includes(k));
    const row = sheet1.addRow([
      lead.priority_score,
      lead.gc_name,
      lead.project_name,
      lead.location || '',
      lead.project_type || '',
      lead.estimated_value || '',
      lead.concrete_scope || '',
      lead.status || '',
      lead.bid_date || '',
      lead.trigger_news || '',
      lead.source_url || '',
    ]);

    if (isKnownGC) {
      row.getCell(2).font = { bold: true };
    }
    if (lead.priority_score >= 80) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
      });
    }
  }

  // Auto-fit columns
  sheet1.columns.forEach(col => { col.width = 18; });
  sheet1.getColumn(1).width = 8;
  sheet1.getColumn(7).width = 30;
  sheet1.getColumn(10).width = 35;
  sheet1.getColumn(11).width = 40;

  // Freeze header
  sheet1.views = [{ state: 'frozen', ySplit: 3 }];

  // Sheet 2: GC Contacts
  const sheet2 = workbook.addWorksheet('GC Contacts');
  const headers2 = ['General Contractor', 'Contact Name', 'Title', 'Email', 'Phone', 'Office / Region', 'Email Verified', 'Relationship Status'];
  const headerRow2 = sheet2.addRow(headers2);
  headerRow2.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  });

  // Get all contacts from DB
  const allContacts = db.prepare(`
    SELECT c.*, l.venue_name FROM le_contacts c
    JOIN le_leads l ON c.lead_id = l.id AND c.tenant_id = l.tenant_id
    WHERE c.tenant_id = ? ORDER BY l.venue_name
  `).all(TENANT_ID);

  for (const c of allContacts) {
    const gcName = (c.venue_name || '').replace(/\s*\(.*\)/, '').replace(/.*\(/, '').replace(/\)/, '');
    const isExisting = KNOWN_GCS.some(k => (c.venue_name || '').toLowerCase().includes(k));
    sheet2.addRow([
      gcName || c.venue_name,
      c.name || '',
      c.title || '',
      c.email || '',
      c.phone || '',
      'Houston / Texas',
      c.mx_valid ? 'Yes' : 'No',
      isExisting ? 'Existing' : 'New',
    ]);
  }

  sheet2.columns.forEach(col => { col.width = 22; });
  sheet2.views = [{ state: 'frozen', ySplit: 1 }];

  // Sheet 3: Outreach Drafts
  const sheet3 = workbook.addWorksheet('Outreach Drafts');
  const headers3 = ['General Contractor', 'Contact Name', 'Subject Line', 'Email Body', 'Status'];
  const headerRow3 = sheet3.addRow(headers3);
  headerRow3.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  });

  for (const draft of outreachDrafts) {
    const row = sheet3.addRow([
      draft.gc_name, draft.contact_name || '', draft.subject, draft.body, 'Draft',
    ]);
    row.getCell(4).alignment = { wrapText: true };
  }

  sheet3.getColumn(1).width = 25;
  sheet3.getColumn(2).width = 20;
  sheet3.getColumn(3).width = 35;
  sheet3.getColumn(4).width = 80;
  sheet3.getColumn(5).width = 10;
  sheet3.views = [{ state: 'frozen', ySplit: 1 }];

  const excelPath = '/root/coppice/demo-files/leads/DACP_GC_Leads_Houston_Mar2026.xlsx';
  await workbook.xlsx.writeFile(excelPath);
  const { statSync } = await import('fs');
  const fileSize = statSync(excelPath).size;
  console.log(`  Excel saved: ${excelPath} (${(fileSize / 1024).toFixed(1)} KB)`);

  // STEP 7: Add to tenant_files
  console.log('\nSTEP 7: Adding to Files dashboard...');
  db.prepare(`
    INSERT OR REPLACE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('DF-LEADS-001', TENANT_ID, 'DACP_GC_Leads_Houston_Mar2026.xlsx', 'Leads', 'xlsx', fileSize, new Date().toISOString().slice(0, 10));
  console.log('  ✓ Added to tenant_files');

  // STEP 8: Seed approval queue
  console.log('\nSTEP 8: Seeding approval queue...');

  // Check if agent_approvals has tenant_id column
  const approvalCols = db.prepare("PRAGMA table_info(agent_approvals)").all().map(c => c.name);

  if (!approvalCols.includes('tenant_id')) {
    try { db.exec('ALTER TABLE agent_approvals ADD COLUMN tenant_id TEXT'); } catch (e) { /* exists */ }
  }
  if (!approvalCols.includes('title')) {
    try { db.exec('ALTER TABLE agent_approvals ADD COLUMN title TEXT'); } catch (e) { /* exists */ }
  }
  if (!approvalCols.includes('description')) {
    try { db.exec('ALTER TABLE agent_approvals ADD COLUMN description TEXT'); } catch (e) { /* exists */ }
  }
  if (!approvalCols.includes('payload')) {
    try { db.exec('ALTER TABLE agent_approvals ADD COLUMN payload TEXT'); } catch (e) { /* exists */ }
  }
  if (!approvalCols.includes('actions')) {
    try { db.exec('ALTER TABLE agent_approvals ADD COLUMN actions TEXT'); } catch (e) { /* exists */ }
  }

  const insertApproval = db.prepare(`
    INSERT OR IGNORE INTO agent_approvals (agent_id, tenant_id, created_at, status, title, description, payload, actions, decision_json)
    VALUES (?, ?, datetime('now'), 'pending', ?, ?, ?, ?, '{}')
  `);

  for (let i = 0; i < Math.min(outreachDrafts.length, 3); i++) {
    const draft = outreachDrafts[i];
    insertApproval.run(
      'lead_engine', TENANT_ID,
      `GC Outreach: ${draft.gc_name}`,
      `Email to ${draft.contact_name || 'Estimating'} re: ${draft.project_name}`,
      JSON.stringify({
        outreach_id: draft.outreach_id,
        lead_id: draft.lead_id,
        to_email: draft.contact_email,
        subject: draft.subject,
        body: draft.body,
      }),
      '["approve_and_send","edit","reject"]'
    );
    console.log(`  ✓ Approval: ${draft.gc_name} → ${draft.contact_name || 'Estimating'}`);
  }

  // STEP 9: Update discovery config
  console.log('\nSTEP 9: Updating discovery config...');
  db.prepare(`
    UPDATE le_discovery_config
    SET current_position = current_position + 10, last_full_cycle = datetime('now')
    WHERE tenant_id = ?
  `).run(TENANT_ID);
  console.log('  ✓ Config updated');

  // Summary
  console.log('\n=== DISCOVERY COMPLETE ===');
  console.log(`  Leads found: ${leads.length}`);
  console.log(`  Leads saved: ${leadMap.size}`);
  console.log(`  Contacts enriched: ${totalContacts}`);
  console.log(`  Outreach drafts: ${outreachDrafts.length}`);
  console.log(`  Approvals seeded: ${Math.min(outreachDrafts.length, 3)}`);
  console.log(`  Excel: ${excelPath}`);

  db.close();
}

runDiscovery().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
