#!/usr/bin/env node
/**
 * DACP Construction — Apollo.io Contact Enrichment (v2)
 *
 * Uses api_search → people/match flow:
 * 1. Search by org name + construction titles + Texas location
 * 2. Enrich each person by Apollo ID to get email/phone
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'cache.db');
const TENANT_ID = 'dacp-construction-001';
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

if (!APOLLO_API_KEY) { console.error('APOLLO_API_KEY not set'); process.exit(1); }

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const KNOWN_GCS = ['turner', 'dpr', 'mccarthy', 'hensel phelps', 'skanska', 'rogers-o\'brien', 'rogers o\'brien', 'austin commercial'];
const TITLES = ['Preconstruction Manager', 'Senior Estimator', 'Chief Estimator', 'VP Preconstruction', 'Director of Preconstruction', 'Project Manager'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function validateMx(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;
  try { return (await dns.promises.resolveMx(domain)).length > 0; } catch { return false; }
}

function isJunkEmail(email) {
  const lower = email.toLowerCase();
  if (/^(noreply|no-reply|donotreply|info@|support@|admin@|contact@|hello@|careers@|marketing@|hr@|recruiting@)/.test(lower)) return true;
  return /(facebook|twitter|linkedin|instagram|gmail|yahoo|hotmail|outlook)\.com/.test(lower.split('@')[1] || '');
}

function extractGcName(venueName) {
  const match = venueName.match(/\(([^)]+)\)$/);
  return match ? match[1].trim() : venueName;
}

async function apolloSearch(orgName) {
  const params = new URLSearchParams();
  params.append('q_organization_name', orgName);
  for (const t of TITLES) params.append('person_titles[]', t);
  params.append('person_locations[]', 'Texas, United States');
  params.append('per_page', '3');

  const res = await fetch(`https://api.apollo.io/api/v1/mixed_people/api_search?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': APOLLO_API_KEY },
  });

  if (!res.ok) throw new Error(`Search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).people || [];
}

async function apolloEnrich(personId) {
  const res = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': APOLLO_API_KEY },
    body: JSON.stringify({ id: personId, reveal_personal_emails: false }),
  });

  if (!res.ok) throw new Error(`Enrich ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).person || null;
}

async function run() {
  console.log('=== DACP Apollo Contact Enrichment (v2) ===\n');

  const leads = db.prepare('SELECT * FROM le_leads WHERE tenant_id = ? ORDER BY priority_score DESC').all(TENANT_ID);
  console.log(`Found ${leads.length} DACP leads\n`);

  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO le_contacts (id, tenant_id, lead_id, name, email, title, phone, source, mx_valid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'apollo', ?, datetime('now'))
  `);
  const updateLeadStatus = db.prepare('UPDATE le_leads SET status = ? WHERE id = ? AND tenant_id = ?');

  let totalNew = 0;
  let totalEnriched = 0;
  const gcsSeen = new Map(); // gcKey → [enriched contacts]

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const gcName = extractGcName(lead.venue_name);
    const gcKey = gcName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // If we already searched this GC, link existing contacts to this lead
    if (gcsSeen.has(gcKey)) {
      const cached = gcsSeen.get(gcKey);
      let linked = 0;
      for (const c of cached) {
        const cid = `lc-apl-${Date.now()}-${totalNew + linked}`;
        try {
          const r = insertContact.run(cid, TENANT_ID, lead.id, c.name, c.email, c.title, c.phone, c.mx ? 1 : 0);
          if (r.changes > 0) linked++;
        } catch (e) { /* dup */ }
      }
      if (linked > 0) { updateLeadStatus.run('enriched', lead.id, TENANT_ID); totalNew += linked; }
      console.log(`  ${gcName}: linked ${linked} cached contacts`);
      continue;
    }

    try {
      console.log(`  Searching: "${gcName}"...`);
      const people = await apolloSearch(gcName);

      if (people.length === 0) {
        console.log(`    → 0 results`);
        gcsSeen.set(gcKey, []);
        await sleep(1000);
        continue;
      }

      console.log(`    → ${people.length} candidates, enriching...`);
      const enriched = [];

      for (const p of people) {
        await sleep(500); // rate limit
        try {
          const full = await apolloEnrich(p.id);
          if (!full || !full.email || isJunkEmail(full.email)) continue;

          const mx = await validateMx(full.email);
          const name = full.name || [full.first_name, full.last_name].filter(Boolean).join(' ');
          const title = full.title || null;
          const phone = full.phone_numbers?.[0]?.sanitized_number || full.organization?.phone || null;
          const contactId = `lc-apl-${Date.now()}-${totalNew}`;

          const result = insertContact.run(contactId, TENANT_ID, lead.id, name, full.email, title, phone, mx ? 1 : 0);

          if (result.changes > 0) {
            totalNew++;
            enriched.push({ name, email: full.email, title, phone, mx });
            console.log(`    ✓ ${name} — ${title || 'N/A'} — ${full.email}${phone ? ` — ${phone}` : ''}${mx ? '' : ' (MX fail)'}`);
          }
        } catch (err) {
          console.error(`    ✗ Enrich error: ${err.message}`);
        }
      }

      gcsSeen.set(gcKey, enriched);
      if (enriched.length > 0) {
        updateLeadStatus.run('enriched', lead.id, TENANT_ID);
        totalEnriched++;
      }
    } catch (err) {
      console.error(`    ✗ ${gcName}: ${err.message}`);
      gcsSeen.set(gcKey, []);
    }

    await sleep(1000);
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Leads: ${leads.length}`);
  console.log(`  Unique GCs searched: ${gcsSeen.size}`);
  console.log(`  New contacts: ${totalNew}`);
  console.log(`  Leads enriched: ${totalEnriched}`);

  // Regenerate Excel
  console.log('\nRegenerating Excel...');
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Leads
  const s1 = workbook.addWorksheet('GC Leads & Projects');
  s1.mergeCells('A1:K1');
  s1.getCell('A1').value = 'DACP CONSTRUCTION — GC LEAD DISCOVERY REPORT';
  s1.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  s1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  s1.mergeCells('A2:K2');
  s1.getCell('A2').value = 'Generated: March 9, 2026 | Source: Coppice Lead Engine (Perplexity + Apollo.io) | Market: Houston / DFW Metro';
  s1.getCell('A2').font = { size: 10, italic: true };

  const h1 = s1.addRow(['Priority', 'General Contractor', 'Project Name', 'Location', 'Project Type', 'Est. Value', 'Concrete Scope', 'Status', 'Bid Date', 'Why Now', 'Source URL']);
  h1.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; });

  for (const l of db.prepare('SELECT * FROM le_leads WHERE tenant_id = ? ORDER BY priority_score DESC').all(TENANT_ID)) {
    const gc = extractGcName(l.venue_name);
    const proj = l.venue_name.replace(/\s*\([^)]+\)$/, '');
    const row = s1.addRow([l.priority_score, gc, proj, l.region || '', l.industry || '', '', '', l.status || '', '', l.trigger_news || '', l.website || '']);
    if (KNOWN_GCS.some(k => gc.toLowerCase().includes(k))) row.getCell(2).font = { bold: true };
    if (l.priority_score >= 80) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } }; });
  }
  s1.columns.forEach(c => { c.width = 18; }); s1.getColumn(1).width = 8; s1.getColumn(10).width = 35; s1.getColumn(11).width = 40;
  s1.views = [{ state: 'frozen', ySplit: 3 }];

  // Sheet 2: Contacts
  const s2 = workbook.addWorksheet('GC Contacts');
  const h2 = s2.addRow(['General Contractor', 'Contact Name', 'Title', 'Email', 'Phone', 'Region', 'Email Verified', 'Source', 'Relationship']);
  h2.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; });

  const seen = new Set();
  for (const c of db.prepare('SELECT c.*, l.venue_name FROM le_contacts c JOIN le_leads l ON c.lead_id=l.id AND c.tenant_id=l.tenant_id WHERE c.tenant_id=? ORDER BY l.venue_name').all(TENANT_ID)) {
    if (seen.has(c.email)) continue; seen.add(c.email);
    const gc = extractGcName(c.venue_name);
    s2.addRow([gc, c.name || '', c.title || '', c.email, c.phone || '', 'Texas', c.mx_valid ? 'Yes' : 'No', c.source || '', KNOWN_GCS.some(k => gc.toLowerCase().includes(k)) ? 'Existing' : 'New']);
  }
  s2.columns.forEach(c => { c.width = 22; }); s2.views = [{ state: 'frozen', ySplit: 1 }];

  // Sheet 3: Outreach
  const s3 = workbook.addWorksheet('Outreach Drafts');
  const h3 = s3.addRow(['General Contractor', 'Contact', 'Subject', 'Email Body', 'Status']);
  h3.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; });
  for (const o of db.prepare('SELECT o.*, l.venue_name, c.name as cn FROM le_outreach_log o JOIN le_leads l ON o.lead_id=l.id AND o.tenant_id=l.tenant_id LEFT JOIN le_contacts c ON o.contact_id=c.id WHERE o.tenant_id=?').all(TENANT_ID)) {
    const row = s3.addRow([extractGcName(o.venue_name), o.cn || '', o.subject || '', o.body || '', o.status || 'draft']);
    row.getCell(4).alignment = { wrapText: true };
  }
  s3.getColumn(1).width = 25; s3.getColumn(3).width = 35; s3.getColumn(4).width = 80;
  s3.views = [{ state: 'frozen', ySplit: 1 }];

  const xlPath = '/root/coppice/demo-files/leads/DACP_GC_Leads_Houston_Mar2026.xlsx';
  await workbook.xlsx.writeFile(xlPath);
  const sz = (await import('fs')).statSync(xlPath).size;
  db.prepare('INSERT OR REPLACE INTO tenant_files (id,tenant_id,name,category,file_type,size_bytes,modified_at) VALUES (?,?,?,?,?,?,?)').run('DF-LEADS-001', TENANT_ID, 'DACP_GC_Leads_Houston_Mar2026.xlsx', 'Leads', 'xlsx', sz, new Date().toISOString().slice(0, 10));
  console.log(`  Excel: ${xlPath} (${(sz/1024).toFixed(1)} KB)`);
  console.log('\n=== DONE ===');
  db.close();
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
