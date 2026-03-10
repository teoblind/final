#!/usr/bin/env node
/**
 * Sangha Lead Engine — Real Discovery Pipeline
 *
 * Runs 10 Perplexity queries targeting IPPs, solar/wind developers,
 * Bitcoin miners, and data center companies in ERCOT. Parses, deduplicates,
 * enriches contacts, generates outreach, creates Excel, seeds approval queue.
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dns from 'dns';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '../data/cache.db');
const DEMO_FILES_DIR = join(__dirname, '../demo-files');
const db = new Database(DB_PATH);

const TENANT = 'default';
const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!PERPLEXITY_KEY) { console.error('Missing PERPLEXITY_API_KEY'); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

// ─── API Clients ─────────────────────────────────────────────────────────────

async function callPerplexity(system, user) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERPLEXITY_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Perplexity ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callClaude(model, system, user) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const msg = await client.messages.create({
    model, max_tokens: 2048, system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractJSON(raw) {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
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

// ─── Step 1: Discovery Queries ───────────────────────────────────────────────

const DISCOVERY_QUERIES = [
  // IPPs with renewable assets in ERCOT
  'Independent power producers (IPPs) with solar or wind assets in ERCOT Texas 2025-2026, list company names, capacity, and locations',
  'Solar IPPs operating in ERCOT Texas experiencing negative LMP pricing or curtailment, company names and portfolio sizes',
  'Wind energy developers with operating wind farms in West Texas and the Texas Panhandle, ERCOT interconnection',
  // Bitcoin miners in ERCOT
  'Bitcoin mining companies operating in ERCOT Texas 2025-2026, list company names, locations, and megawatt capacity',
  'Large-scale Bitcoin mining operations co-located with renewable energy in Texas, behind-the-meter mining setups',
  // Data centers / AI compute in ERCOT
  'Data center companies building or expanding in ERCOT Texas 2025-2026, company names and megawatt capacity planned',
  'Hyperscale data center operators with Texas facilities or planned builds, power requirements and locations',
  // Broader IPP targets
  'Renewable energy IPPs in PJM and MISO with underperforming assets looking for alternative revenue streams 2025-2026',
  'Companies developing behind-the-meter bitcoin mining at renewable energy sites in the US, partnerships with IPPs',
  // Insurance / risk management adjacent
  'Energy companies or bitcoin miners seeking hash price hedging, hash rate derivatives, or mining revenue insurance products',
];

const SYSTEM_PROMPT = `You are a lead researcher for Sangha Renewables, a company that co-locates Bitcoin mining with renewable energy assets and builds hash price insurance products.

For each company found, return a JSON array of objects with these exact fields:
- name: Company name (string)
- region: Operating region/market (e.g. "ERCOT", "PJM", "Texas", "US")
- industry: One of "Solar IPP", "Wind IPP", "Renewable IPP", "Bitcoin Miner", "Data Center", "Energy Developer", "Mixed"
- website: Company website URL if known
- capacity_mw: Portfolio capacity in MW if mentioned (number or null)
- hq_location: HQ city/state if known
- triggerNews: Brief description of why this company is relevant NOW (recent news, expansion, challenges)
- priorityScore: 1-100 score based on fit — higher for ERCOT-based IPPs facing curtailment/negative LMPs, Bitcoin miners needing hash price hedging, data centers needing power

Return ONLY valid JSON array, no commentary or explanation. Include 5-10 companies per query. Only include US-based companies.`;

async function runDiscovery() {
  console.log('\n═══ STEP 1: Running 10 Perplexity Discovery Queries ═══\n');
  const allLeads = [];

  for (let i = 0; i < DISCOVERY_QUERIES.length; i++) {
    const query = DISCOVERY_QUERIES[i];
    console.log(`  [${i + 1}/10] ${query.slice(0, 80)}...`);

    try {
      const raw = await callPerplexity(SYSTEM_PROMPT, query);
      const leads = extractJSON(raw);

      if (!leads || !Array.isArray(leads)) {
        console.log(`    → No parseable JSON returned`);
        continue;
      }

      console.log(`    → Found ${leads.length} companies`);
      for (const lead of leads) {
        if (!lead.name) continue;
        allLeads.push({
          ...lead,
          sourceQuery: query,
        });
      }
    } catch (err) {
      console.error(`    → Error: ${err.message}`);
    }

    // Rate limit: 1 second between queries
    if (i < DISCOVERY_QUERIES.length - 1) await sleep(1500);
  }

  console.log(`\n  Total raw leads: ${allLeads.length}`);
  return allLeads;
}

// ─── Step 2: Dedup & Score ───────────────────────────────────────────────────

function deduplicateAndScore(rawLeads) {
  console.log('\n═══ STEP 2: Deduplicating & Scoring ═══\n');

  const seen = new Map();

  for (const lead of rawLeads) {
    const key = lead.name.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (seen.has(key)) {
      // Merge: keep highest score, combine trigger news
      const existing = seen.get(key);
      if ((lead.priorityScore || 0) > (existing.priorityScore || 0)) {
        existing.priorityScore = lead.priorityScore;
      }
      if (lead.triggerNews && !existing.triggerNews.includes(lead.triggerNews)) {
        existing.triggerNews += '; ' + lead.triggerNews;
      }
      if (lead.capacity_mw && !existing.capacity_mw) {
        existing.capacity_mw = lead.capacity_mw;
      }
      existing.sourceQueries.push(lead.sourceQuery);
    } else {
      seen.set(key, {
        ...lead,
        sourceQueries: [lead.sourceQuery],
      });
    }
  }

  // Remove existing demo leads by checking the database
  const existingLeads = db.prepare('SELECT venue_name FROM le_leads WHERE tenant_id = ?').all(TENANT);
  const existingNames = new Set(existingLeads.map(l => l.venue_name.toLowerCase().replace(/[^a-z0-9]/g, '')));

  const deduped = [...seen.values()]
    .filter(l => !existingNames.has(l.name.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .sort((a, b) => (b.priorityScore || 50) - (a.priorityScore || 50));

  console.log(`  Unique new leads: ${deduped.length} (after removing ${rawLeads.length - deduped.length} duplicates/existing)`);

  // Boost scores for ERCOT-based companies
  for (const lead of deduped) {
    const r = (lead.region || '').toLowerCase();
    if (r.includes('ercot') || r.includes('texas')) {
      lead.priorityScore = Math.min(100, (lead.priorityScore || 50) + 10);
    }
    // Boost for bitcoin miners (hash price insurance is the product)
    if ((lead.industry || '').toLowerCase().includes('bitcoin') || (lead.industry || '').toLowerCase().includes('miner')) {
      lead.priorityScore = Math.min(100, (lead.priorityScore || 50) + 5);
    }
  }

  deduped.sort((a, b) => (b.priorityScore || 50) - (a.priorityScore || 50));
  return deduped;
}

// ─── Step 3: Contact Enrichment ──────────────────────────────────────────────

async function enrichContacts(leads, maxLeads = 25) {
  console.log(`\n═══ STEP 3: Enriching Contacts (top ${maxLeads} leads) ═══\n`);

  const top = leads.slice(0, maxLeads);
  const enriched = [];

  const CONTACT_SYSTEM = `You are a contact researcher. Find real email addresses and titles for key decision-makers at the given company. Focus on:
- VP/Director/Head of Business Development
- VP/Director of Energy or Operations
- CFO or CEO (for smaller companies)
- Head of Mining Operations (for Bitcoin miners)
- VP of Strategy or Partnerships

Return a JSON array of objects with fields: name, email, title, linkedin_url (if known).
Return ONLY valid JSON array. If you can't find real emails, return an empty array []. Do NOT make up email addresses.`;

  for (let i = 0; i < top.length; i++) {
    const lead = top[i];
    console.log(`  [${i + 1}/${top.length}] ${lead.name}...`);

    try {
      const raw = await callPerplexity(
        CONTACT_SYSTEM,
        `Find contact information for decision-makers at ${lead.name}${lead.website ? ' (' + lead.website + ')' : ''}. Company industry: ${lead.industry}. Location: ${lead.region || 'US'}.`
      );

      const contacts = extractJSON(raw);
      if (contacts && Array.isArray(contacts) && contacts.length > 0) {
        const valid = [];
        for (const c of contacts) {
          if (!c.email) continue;
          // Skip generic/junk emails
          const lower = c.email.toLowerCase();
          const junk = ['noreply', 'no-reply', 'info@', 'support@', 'admin@', 'hello@', 'contact@', 'sales@', 'marketing@', 'webmaster@'];
          if (junk.some(j => lower.startsWith(j))) continue;
          const junkDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'facebook.com', 'twitter.com', 'linkedin.com'];
          const domain = lower.split('@')[1];
          if (junkDomains.includes(domain)) continue;

          const mxValid = await validateMx(c.email);
          valid.push({ ...c, mxValid });
        }
        lead.contacts = valid;
        console.log(`    → ${valid.length} contacts (${valid.filter(c => c.mxValid).length} MX-verified)`);
        if (valid.length > 0) enriched.push(lead);
      } else {
        console.log(`    → No contacts found`);
        lead.contacts = [];
      }
    } catch (err) {
      console.error(`    → Error: ${err.message}`);
      lead.contacts = [];
    }

    if (i < top.length - 1) await sleep(1500);
  }

  console.log(`\n  Leads with contacts: ${enriched.length}`);
  return { allLeads: leads, enrichedLeads: enriched };
}

// ─── Step 4: Save to Database ────────────────────────────────────────────────

function saveToDatabase(leads) {
  console.log('\n═══ STEP 4: Saving to SQLite Database ═══\n');

  const insertLead = db.prepare(`
    INSERT OR IGNORE INTO le_leads (id, tenant_id, venue_name, region, industry, trigger_news, priority_score, website, status, source, source_query, discovered_at, notes, agent_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO le_contacts (id, tenant_id, lead_id, name, email, title, phone, source, mx_valid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let leadsInserted = 0;
  let contactsInserted = 0;

  const now = new Date().toISOString();

  for (const lead of leads) {
    const id = `le-${uuidv4().slice(0, 8)}`;
    lead.dbId = id;

    const status = (lead.contacts && lead.contacts.length > 0) ? 'enriched' : 'new';
    const notes = lead.capacity_mw ? `Capacity: ${lead.capacity_mw} MW` : null;
    const agentNotes = lead.hq_location ? `HQ: ${lead.hq_location}` : null;

    const result = insertLead.run(
      id, TENANT, lead.name, lead.region || null, lead.industry || null,
      lead.triggerNews || null, lead.priorityScore || 50, lead.website || null,
      status, 'discovery', (lead.sourceQueries || []).join(' | ').slice(0, 500),
      now, notes, agentNotes
    );

    if (result.changes > 0) {
      leadsInserted++;

      // Insert contacts
      if (lead.contacts) {
        for (const c of lead.contacts) {
          const cId = `lc-${uuidv4().slice(0, 8)}`;
          const cResult = insertContact.run(
            cId, TENANT, id, c.name || null, c.email, c.title || null,
            null, 'enrichment', c.mxValid ? 1 : 0
          );
          if (cResult.changes > 0) {
            contactsInserted++;
            if (!lead.primaryContactId) lead.primaryContactId = cId;
          }
        }
      }
    }
  }

  console.log(`  Leads inserted: ${leadsInserted}`);
  console.log(`  Contacts inserted: ${contactsInserted}`);
  return { leadsInserted, contactsInserted };
}

// ─── Step 5: Generate Excel Workbook ─────────────────────────────────────────

async function generateExcel(leads) {
  console.log('\n═══ STEP 5: Generating Excel Workbook ═══\n');

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Coppice Lead Engine';
  wb.created = new Date();

  // Sheet 1: Leads Pipeline
  const ws1 = wb.addWorksheet('Leads Pipeline');
  ws1.columns = [
    { header: 'Company', key: 'name', width: 30 },
    { header: 'Industry', key: 'industry', width: 20 },
    { header: 'Region', key: 'region', width: 15 },
    { header: 'Capacity (MW)', key: 'capacity', width: 15 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Website', key: 'website', width: 30 },
    { header: 'Trigger / Relevance', key: 'trigger', width: 50 },
    { header: 'Contacts', key: 'contacts', width: 10 },
  ];

  // Style header
  ws1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a5632' } };

  for (const lead of leads) {
    ws1.addRow({
      name: lead.name,
      industry: lead.industry || '',
      region: lead.region || '',
      capacity: lead.capacity_mw || '',
      priority: lead.priorityScore || 50,
      status: (lead.contacts && lead.contacts.length > 0) ? 'Enriched' : 'New',
      website: lead.website || '',
      trigger: lead.triggerNews || '',
      contacts: lead.contacts ? lead.contacts.length : 0,
    });
  }

  // Sheet 2: Contacts
  const ws2 = wb.addWorksheet('Contacts');
  ws2.columns = [
    { header: 'Company', key: 'company', width: 30 },
    { header: 'Contact Name', key: 'name', width: 25 },
    { header: 'Title', key: 'title', width: 30 },
    { header: 'Email', key: 'email', width: 35 },
    { header: 'MX Valid', key: 'mx', width: 10 },
  ];

  ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a5632' } };

  for (const lead of leads) {
    if (!lead.contacts) continue;
    for (const c of lead.contacts) {
      ws2.addRow({
        company: lead.name,
        name: c.name || '',
        title: c.title || '',
        email: c.email,
        mx: c.mxValid ? 'Yes' : 'No',
      });
    }
  }

  // Sheet 3: Outreach Drafts (populated in step 6)
  const ws3 = wb.addWorksheet('Outreach Drafts');
  ws3.columns = [
    { header: 'Company', key: 'company', width: 30 },
    { header: 'Contact', key: 'contact', width: 25 },
    { header: 'Subject', key: 'subject', width: 40 },
    { header: 'Body', key: 'body', width: 80 },
    { header: 'Status', key: 'status', width: 12 },
  ];

  ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a5632' } };

  return { wb, ws3 };
}

// ─── Step 6: Generate Outreach ───────────────────────────────────────────────

async function generateOutreach(leads, ws3) {
  console.log('\n═══ STEP 6: Generating Outreach (top 5 enriched leads) ═══\n');

  const enrichedWithContacts = leads
    .filter(l => l.contacts && l.contacts.length > 0 && l.contacts.some(c => c.mxValid))
    .slice(0, 5);

  const outreachDrafts = [];

  const insertOutreach = db.prepare(`
    INSERT INTO le_outreach_log (id, tenant_id, lead_id, contact_id, email_type, subject, body, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < enrichedWithContacts.length; i++) {
    const lead = enrichedWithContacts[i];
    const contact = lead.contacts.find(c => c.mxValid) || lead.contacts[0];
    console.log(`  [${i + 1}/5] ${lead.name} → ${contact.name || contact.email}`);

    try {
      const bodyPrompt = `Write a personalized cold outreach email from Spencer Marr at Sangha Renewables to ${contact.name || 'the team'} (${contact.title || 'Decision Maker'}) at ${lead.name}.

Context about Sangha: Sangha Renewables co-locates behind-the-meter Bitcoin mining with renewable energy assets. They also build hash price insurance products — guaranteeing a minimum IRR for energy companies deploying capital into Bitcoin mining. They have 8+ years of operational experience and proprietary hash price modeling.

About ${lead.name}: ${lead.industry} in ${lead.region}. ${lead.triggerNews || ''}. ${lead.capacity_mw ? 'Capacity: ' + lead.capacity_mw + ' MW.' : ''}

Write a concise (under 120 words), direct email that:
1. References something specific about their company
2. Briefly explains the value prop (BTM mining + hash price insurance)
3. Ends with a soft ask for a call

Sign off as: Spencer Marr, Sangha Renewables

Output ONLY the email body, no subject line or headers.`;

      const body = await callClaude('claude-sonnet-4-20250514',
        'You write concise, professional cold outreach emails for energy/bitcoin mining partnerships. No fluff, no generic templates. Direct and specific.',
        bodyPrompt
      );

      const subjectPrompt = `Generate a short (5-8 word) email subject line for a cold outreach email from Sangha Renewables to ${contact.name} at ${lead.name}. The email is about behind-the-meter Bitcoin mining co-location and hash price insurance. Output ONLY the subject line.`;
      const subject = await callClaude('claude-haiku-4-5-20251001',
        'You write compelling email subject lines.',
        subjectPrompt
      );

      const outreachId = `lo-${uuidv4().slice(0, 8)}`;
      const now = new Date().toISOString();

      insertOutreach.run(outreachId, TENANT, lead.dbId, lead.primaryContactId || null, 'initial', subject.trim(), body.trim(), 'draft', now);

      // Update lead status
      db.prepare('UPDATE le_leads SET status = ? WHERE id = ? AND tenant_id = ?').run('contacted', lead.dbId, TENANT);

      outreachDrafts.push({
        company: lead.name,
        contact: contact.name || contact.email,
        subject: subject.trim(),
        body: body.trim(),
        outreachId,
        leadId: lead.dbId,
      });

      // Add to Excel
      ws3.addRow({
        company: lead.name,
        contact: contact.name || contact.email,
        subject: subject.trim(),
        body: body.trim(),
        status: 'Draft',
      });

      console.log(`    → Subject: ${subject.trim()}`);
    } catch (err) {
      console.error(`    → Error: ${err.message}`);
    }

    if (i < enrichedWithContacts.length - 1) await sleep(2000);
  }

  console.log(`\n  Outreach drafts generated: ${outreachDrafts.length}`);
  return outreachDrafts;
}

// ─── Step 7: Save Excel, Update Files Dashboard, Seed Approvals ──────────────

async function saveAndRegister(wb, outreachDrafts) {
  console.log('\n═══ STEP 7: Saving Excel & Seeding Approval Queue ═══\n');

  // Save Excel to demo-files/reports/
  const reportsDir = join(DEMO_FILES_DIR, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const filename = `Sangha_Lead_Pipeline_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const filepath = join(reportsDir, filename);
  await wb.xlsx.writeFile(filepath);
  const stats = fs.statSync(filepath);

  console.log(`  Excel saved: ${filepath} (${(stats.size / 1024).toFixed(1)} KB)`);

  // Register in tenant_files
  const fileId = `tf-${uuidv4().slice(0, 8)}`;
  db.prepare(`
    INSERT OR REPLACE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(fileId, TENANT, filename, 'reports', 'xlsx', stats.size, new Date().toISOString());

  console.log(`  Registered in Files dashboard: ${filename}`);

  // Seed approval queue with outreach drafts
  const insertApproval = db.prepare(`
    INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const draft of outreachDrafts) {
    insertApproval.run(
      TENANT,
      'lead-engine',
      `Outreach draft: ${draft.company}`,
      `Cold email to ${draft.contact} at ${draft.company}. Subject: "${draft.subject}"`,
      'email_draft',
      JSON.stringify({
        to: draft.contact,
        subject: draft.subject,
        body: draft.body,
        lead_id: draft.leadId,
        outreach_id: draft.outreachId,
      }),
      'pending'
    );
  }

  console.log(`  Approval items seeded: ${outreachDrafts.length}`);

  // Also register a "discovery report" approval
  insertApproval.run(
    TENANT,
    'lead-engine',
    'Lead Discovery Report — March 2026',
    `New lead pipeline generated with real Perplexity discovery. Excel workbook with ${outreachDrafts.length} outreach drafts ready for review.`,
    'report',
    JSON.stringify({
      filename,
      file_id: fileId,
      generated_at: new Date().toISOString(),
    }),
    'pending'
  );

  console.log(`  Discovery report approval seeded`);
}

// ─── Step 8: Update Discovery Config ─────────────────────────────────────────

function updateDiscoveryConfig() {
  console.log('\n═══ STEP 8: Updating Discovery Config ═══\n');

  const newQueries = JSON.stringify(DISCOVERY_QUERIES);
  const newRegions = JSON.stringify(['ERCOT', 'PJM', 'MISO', 'SPP', 'CAISO']);

  db.prepare(`
    UPDATE le_discovery_config
    SET queries_json = ?, regions_json = ?, current_position = 0, queries_per_cycle = 5, mode = 'copilot', sender_name = 'Spencer Marr', sender_email = 'spencer@sangha.io'
    WHERE tenant_id = ?
  `).run(newQueries, newRegions, TENANT);

  console.log(`  Discovery config updated with ${DISCOVERY_QUERIES.length} real queries`);
  console.log(`  Sender: Spencer Marr <spencer@sangha.io>`);
  console.log(`  Mode: copilot (manual approval)`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Sangha Lead Engine — Real Discovery Pipeline              ║');
  console.log('║   Target: IPPs, Solar/Wind, BTC Miners, Data Centers       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  // Step 1: Run Perplexity discovery
  const rawLeads = await runDiscovery();

  // Step 2: Deduplicate and score
  const uniqueLeads = deduplicateAndScore(rawLeads);

  if (uniqueLeads.length === 0) {
    console.log('\nNo new leads discovered. Exiting.');
    process.exit(0);
  }

  // Step 3: Enrich contacts for top 25
  const { allLeads, enrichedLeads } = await enrichContacts(uniqueLeads, 25);

  // Step 4: Save to database
  saveToDatabase(allLeads);

  // Step 5: Generate Excel workbook
  const { wb, ws3 } = await generateExcel(allLeads);

  // Step 6: Generate outreach for top 5
  const outreachDrafts = await generateOutreach(allLeads, ws3);

  // Step 7: Save Excel, register files, seed approvals
  await saveAndRegister(wb, outreachDrafts);

  // Step 8: Update discovery config
  updateDiscoveryConfig();

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   PIPELINE COMPLETE                                        ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║   Total leads discovered:    ${String(allLeads.length).padStart(4)}                           ║`);
  console.log(`║   Leads with contacts:       ${String(enrichedLeads.length).padStart(4)}                           ║`);
  console.log(`║   Outreach drafts:           ${String(outreachDrafts.length).padStart(4)}                           ║`);
  console.log(`║   Time elapsed:           ${elapsed.padStart(7)}s                         ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n  → Spencer can view leads at sangha.coppice.ai → Lead Engine tab');
  console.log('  → Outreach drafts pending approval in the Approvals queue');
  console.log('  → Excel report available in Files → Reports\n');
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
