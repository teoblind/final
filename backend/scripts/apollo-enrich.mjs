#!/usr/bin/env node
/**
 * Apollo.io Contact Enrichment — Two-step approach
 * Step 1: Perplexity finds decision-maker names at each company
 * Step 2: Apollo bulk_match verifies their emails
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

const APOLLO_KEY = process.env.APOLLO_API_KEY;
const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY;
if (!APOLLO_KEY) { console.error('Missing APOLLO_API_KEY'); process.exit(1); }
if (!PERPLEXITY_KEY) { console.error('Missing PERPLEXITY_API_KEY'); process.exit(1); }

// ─── API Clients ─────────────────────────────────────────────────────────────

async function callPerplexity(system, user) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PERPLEXITY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sonar', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 2048 }),
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function apolloBulkMatch(details) {
  const res = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
    method: 'POST',
    headers: { 'x-api-key': APOLLO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ details }),
  });
  if (!res.ok) throw new Error(`Apollo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.matches || []).filter(Boolean).map(p => ({
    name: [p.first_name, p.last_name].filter(Boolean).join(' '),
    email: p.email,
    title: p.title || null,
    phone: p.phone_number || (p.phone_numbers?.[0]?.sanitized_number) || null,
    linkedin: p.linkedin_url || null,
    verified: p.email_status === 'verified',
    org: p.organization?.name || null,
  }));
}

function extractJSON(raw) {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function validateMx(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;
  try { const r = await dns.promises.resolveMx(domain); return r && r.length > 0; } catch { return false; }
}

function isJunkEmail(email) {
  const lower = email.toLowerCase();
  const junk = ['noreply', 'no-reply', 'donotreply', 'info@', 'support@', 'admin@', 'webmaster@', 'hello@', 'contact@', 'sales@', 'marketing@'];
  if (junk.some(j => lower.startsWith(j))) return true;
  const domain = lower.split('@')[1];
  return ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'].includes(domain);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Two-Step Enrichment ─────────────────────────────────────────────────────

async function findNamesViaPerplexity(companyName, website) {
  const raw = await callPerplexity(
    'You are a contact researcher. Return ONLY a valid JSON array, no commentary.',
    `Find the names and titles of key executives and leaders at ${companyName}${website ? ' (' + website + ')' : ''}. Focus on: CEO, President, CFO, VP Business Development, VP Strategy, VP Operations, VP Energy, Head of Mining Operations, VP Partnerships, Director BD.
Return a JSON array of objects with fields: first_name, last_name, title. Return 3-5 people maximum. ONLY return valid JSON.`
  );
  return extractJSON(raw) || [];
}

async function verifyViaApollo(people, companyName) {
  const details = people
    .filter(p => p.first_name && p.last_name)
    .map(p => ({ first_name: p.first_name, last_name: p.last_name, organization_name: companyName }));
  if (details.length === 0) return [];
  return apolloBulkMatch(details);
}

// ─── Enrichment Runner ───────────────────────────────────────────────────────

async function enrichTenant(tenantId, maxLeads) {
  const leads = db.prepare(`
    SELECT l.* FROM le_leads l
    LEFT JOIN (SELECT lead_id, COUNT(*) as cnt FROM le_contacts WHERE tenant_id = ? AND source = 'apollo' GROUP BY lead_id) c ON l.id = c.lead_id
    WHERE l.tenant_id = ? AND (c.cnt IS NULL OR c.cnt = 0)
    ORDER BY l.priority_score DESC LIMIT ?
  `).all(tenantId, tenantId, maxLeads);

  console.log(`  Found ${leads.length} leads needing enrichment`);

  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO le_contacts (id, tenant_id, lead_id, name, email, title, phone, source, mx_valid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalContacts = 0;
  let enrichedCount = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    console.log(`  [${i + 1}/${leads.length}] ${lead.venue_name}...`);

    try {
      // Step 1: Perplexity finds names
      const people = await findNamesViaPerplexity(lead.venue_name, lead.website);
      if (people.length === 0) {
        console.log(`    → No names found by Perplexity`);
        continue;
      }
      console.log(`    → Perplexity found: ${people.map(p => p.first_name + ' ' + p.last_name).join(', ')}`);

      // Step 2: Apollo verifies emails
      await sleep(500);
      const verified = await verifyViaApollo(people, lead.venue_name);

      if (verified.length === 0) {
        console.log(`    → Apollo: no matches`);
        continue;
      }

      let addedAny = false;
      for (const c of verified) {
        if (!c.email || isJunkEmail(c.email)) continue;
        const mxValid = c.verified || await validateMx(c.email);
        const contactId = `lc-${uuidv4().slice(0, 8)}`;
        const result = insertContact.run(contactId, tenantId, lead.id, c.name, c.email, c.title, c.phone, 'apollo', mxValid ? 1 : 0);
        if (result.changes > 0) { addedAny = true; totalContacts++; }
      }

      if (addedAny) {
        db.prepare('UPDATE le_leads SET status = ? WHERE id = ? AND tenant_id = ?').run('enriched', lead.id, tenantId);
        enrichedCount++;
      }

      console.log(`    → Apollo verified: ${verified.map(c => c.name + ' <' + c.email + '> ' + (c.verified ? '✓' : '?')).join(', ')}`);

    } catch (err) {
      console.error(`    → Error: ${err.message}`);
    }

    if (i < leads.length - 1) await sleep(1500);
  }

  return { enrichedCount, totalContacts };
}

// ─── Excel Regeneration ──────────────────────────────────────────────────────

async function regenerateExcel(tenantId, filename) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const hs = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a5632' } } };

  const ws1 = wb.addWorksheet('Leads Pipeline');
  ws1.columns = [
    { header: 'Company', key: 'name', width: 30 }, { header: 'Industry', key: 'industry', width: 20 },
    { header: 'Region', key: 'region', width: 15 }, { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Status', key: 'status', width: 12 }, { header: 'Website', key: 'website', width: 30 },
    { header: 'Trigger', key: 'trigger', width: 50 },
  ];
  ws1.getRow(1).font = hs.font; ws1.getRow(1).fill = hs.fill;
  const leads = db.prepare('SELECT * FROM le_leads WHERE tenant_id = ? ORDER BY priority_score DESC').all(tenantId);
  for (const l of leads) ws1.addRow({ name: l.venue_name, industry: l.industry, region: l.region, priority: l.priority_score, status: l.status, website: l.website, trigger: l.trigger_news });

  const ws2 = wb.addWorksheet('Contacts');
  ws2.columns = [
    { header: 'Company', key: 'company', width: 28 }, { header: 'Name', key: 'name', width: 22 },
    { header: 'Title', key: 'title', width: 30 }, { header: 'Email', key: 'email', width: 32 },
    { header: 'Phone', key: 'phone', width: 18 }, { header: 'Verified', key: 'mx', width: 10 },
    { header: 'Source', key: 'source', width: 10 },
  ];
  ws2.getRow(1).font = hs.font; ws2.getRow(1).fill = hs.fill;
  const contacts = db.prepare('SELECT c.*, l.venue_name FROM le_contacts c JOIN le_leads l ON c.lead_id = l.id WHERE c.tenant_id = ? ORDER BY l.priority_score DESC').all(tenantId);
  for (const c of contacts) ws2.addRow({ company: c.venue_name, name: c.name, title: c.title, email: c.email, phone: c.phone, mx: c.mx_valid ? 'Yes' : 'No', source: c.source });

  const ws3 = wb.addWorksheet('Outreach Drafts');
  ws3.columns = [
    { header: 'Company', key: 'company', width: 28 }, { header: 'Contact', key: 'contact', width: 22 },
    { header: 'Subject', key: 'subject', width: 40 }, { header: 'Body', key: 'body', width: 80 },
    { header: 'Status', key: 'status', width: 12 },
  ];
  ws3.getRow(1).font = hs.font; ws3.getRow(1).fill = hs.fill;
  const outreach = db.prepare('SELECT o.*, l.venue_name, c.name as cn FROM le_outreach_log o LEFT JOIN le_leads l ON o.lead_id = l.id LEFT JOIN le_contacts c ON o.contact_id = c.id WHERE o.tenant_id = ? ORDER BY o.created_at DESC').all(tenantId);
  for (const o of outreach) ws3.addRow({ company: o.venue_name, contact: o.cn, subject: o.subject, body: o.body, status: o.status });

  const reportsDir = join(DEMO_FILES_DIR, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const filepath = join(reportsDir, filename);
  await wb.xlsx.writeFile(filepath);
  const stats = fs.statSync(filepath);
  db.prepare('INSERT OR REPLACE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`tf-${uuidv4().slice(0, 8)}`, tenantId, filename, 'reports', 'xlsx', stats.size, new Date().toISOString());
  return { filepath, size: stats.size, leads: leads.length, contacts: contacts.length };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Apollo + Perplexity Two-Step Contact Enrichment           ║');
  console.log('║   Perplexity finds names → Apollo verifies emails           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log('\n═══ SANGHA RENEWABLES — Top 25 ═══');
  const sangha = await enrichTenant('default', 25);
  console.log(`\n  Results: ${sangha.enrichedCount} leads enriched, ${sangha.totalContacts} contacts added`);

  console.log('\n═══ DACP CONSTRUCTION — Top 20 ═══');
  const dacp = await enrichTenant('dacp-construction-001', 20);
  console.log(`\n  Results: ${dacp.enrichedCount} leads enriched, ${dacp.totalContacts} contacts added`);

  console.log('\n═══ Regenerating Excel ═══');
  const s = await regenerateExcel('default', `Sangha_Lead_Pipeline_${new Date().toISOString().slice(0, 10)}.xlsx`);
  console.log(`  Sangha: ${(s.size / 1024).toFixed(1)} KB, ${s.leads} leads, ${s.contacts} contacts`);
  const d = await regenerateExcel('dacp-construction-001', `DACP_Lead_Pipeline_${new Date().toISOString().slice(0, 10)}.xlsx`);
  console.log(`  DACP:   ${(d.size / 1024).toFixed(1)} KB, ${d.leads} leads, ${d.contacts} contacts`);

  const ac = db.prepare("SELECT COUNT(*) as c FROM le_contacts WHERE source = 'apollo'").get();
  const sc = db.prepare("SELECT COUNT(*) as c FROM le_contacts WHERE tenant_id = 'default'").get();
  const dc = db.prepare("SELECT COUNT(*) as c FROM le_contacts WHERE tenant_id = 'dacp-construction-001'").get();
  console.log(`\n  Total Apollo-verified contacts: ${ac.c}`);
  console.log(`  Sangha contacts: ${sc.c} | DACP contacts: ${dc.c}`);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
