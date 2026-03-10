/**
 * DACP Construction Demo Seed Script
 *
 * Seeds realistic demo data for tenant 'dacp-construction-001' into the
 * existing SQLite database. Clears all existing DACP data first, then
 * re-loads pricing + jobs + bid requests + estimates + field reports +
 * approval items + notifications + chat messages + knowledge entries +
 * GC profiles.
 *
 * Usage:  node seed-dacp-demo.js
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDatabase } from './src/cache/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure all tables exist before seeding
initDatabase();

const DB_PATH = join(__dirname, 'data', 'cache.db');
const TENANT = 'dacp-construction-001';

console.log(`\n=== DACP Construction Demo Seed ===`);
console.log(`Database: ${DB_PATH}`);
console.log(`Tenant:   ${TENANT}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── 1. CLEAR EXISTING DATA ─────────────────────────────────────────────────

const tablesToClear = [
  'dacp_pricing',
  'dacp_jobs',
  'dacp_bid_requests',
  'dacp_estimates',
  'dacp_field_reports',
  'approval_items',
  'platform_notifications',
  'chat_messages',
  'knowledge_entries',
  'knowledge_entities',
  'knowledge_links',
];

console.log('1. Clearing existing DACP data...');

// Helper: check if a table exists
function tableExists(name) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) != null;
}

// knowledge_links doesn't have tenant_id — clear by entry_id/entity_id referencing DACP entries
const clearTransaction = db.transaction(() => {
  // Clear knowledge_links that reference DACP entries or entities
  if (tableExists('knowledge_links') && tableExists('knowledge_entries') && tableExists('knowledge_entities')) {
    db.prepare(`
      DELETE FROM knowledge_links WHERE entry_id IN (
        SELECT id FROM knowledge_entries WHERE tenant_id = ?
      ) OR entity_id IN (
        SELECT id FROM knowledge_entities WHERE tenant_id = ?
      )
    `).run(TENANT, TENANT);
  }

  for (const table of tablesToClear) {
    if (table === 'knowledge_links') continue; // already handled
    if (!tableExists(table)) {
      console.log(`   ${table}: skipped (table not found)`);
      continue;
    }
    const result = db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(TENANT);
    console.log(`   ${table}: deleted ${result.changes} rows`);
  }
});
clearTransaction();

// ─── 2. SEED PRICING ────────────────────────────────────────────────────────

console.log('\n2. Loading pricing from pricing_master.json...');

const pricingPath = join(__dirname, 'src', 'data', 'dacp', 'pricing_master.json');
const pricing = JSON.parse(fs.readFileSync(pricingPath, 'utf-8'));

const insertPricing = db.prepare(`
  INSERT OR REPLACE INTO dacp_pricing (id, tenant_id, category, item, unit, material_cost, labor_cost, equipment_cost, unit_price, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const seedPricing = db.transaction(() => {
  for (const p of pricing) {
    insertPricing.run(p.id, TENANT, p.category, p.item, p.unit, p.material_cost, p.labor_cost, p.equipment_cost, p.unit_price, p.notes);
  }
});
seedPricing();
console.log(`   Inserted ${pricing.length} pricing items`);

// ─── 3. SEED JOBS ────────────────────────────────────────────────────────────

console.log('\n3. Inserting 12 jobs...');

const jobs = [
  // COMPLETED
  { id: 'J-001', estimate_id: null, project_name: 'Memorial Hermann Phase 1', gc_name: 'Turner Construction', project_type: 'commercial', location: 'Houston TX', status: 'complete', estimated_cost: 198200, actual_cost: 198200, bid_amount: 214500, margin_pct: 7.6, start_date: '2024-01-15', end_date: '2024-06-30', notes: 'SOG 6,200 SF, curb 800 LF, sidewalk 1,800 SF, 22 piers. Under budget on concrete, over on rebar by 8%' },
  { id: 'J-002', estimate_id: null, project_name: 'Frisco Station Mixed-Use', gc_name: 'DPR Construction', project_type: 'commercial', location: 'Frisco TX', status: 'complete', estimated_cost: 462300, actual_cost: 462300, bid_amount: 445000, margin_pct: -3.9, start_date: '2024-03-01', end_date: '2024-09-15', notes: "SOG 12,000 SF, elevated slab 8,000 SF, grade beams 400 LF. Rock at 28' on 6 piers caused overrun. Geotech report was inaccurate." },
  { id: 'J-003', estimate_id: null, project_name: 'Methodist Hospital Expansion', gc_name: 'McCarthy Building', project_type: 'commercial', location: 'Houston TX', status: 'complete', estimated_cost: 172400, actual_cost: 172400, bid_amount: 186000, margin_pct: 7.3, start_date: '2023-10-01', end_date: '2024-03-15', notes: 'SOG 4,800 SF, retaining wall 220 LF, 36 piers. Clean job, no change orders' },
  { id: 'J-004', estimate_id: null, project_name: 'Westchase Office Tower', gc_name: 'Skanska', project_type: 'commercial', location: 'Houston TX', status: 'lost', estimated_cost: null, actual_cost: null, bid_amount: 892000, margin_pct: null, start_date: null, end_date: null, notes: "Elevated slab 22,000 SF, grade beams 600 LF, 48 piers. Lost — Skanska went with lower bid ($845K). Lost by 5.3%." },
  { id: 'J-005', estimate_id: null, project_name: 'TMC Building 7', gc_name: 'DPR Construction', project_type: 'commercial', location: 'Houston TX', status: 'complete', estimated_cost: 431200, actual_cost: 431200, bid_amount: 445000, margin_pct: 3.1, start_date: '2024-05-01', end_date: '2024-11-30', notes: 'SOG 8,500 SF, curb 600 LF. Tight margin due to material price increases mid-project' },
  { id: 'J-006', estimate_id: null, project_name: 'Legacy West Tower', gc_name: 'Hensel Phelps', project_type: 'commercial', location: 'Plano TX', status: 'lost', estimated_cost: null, actual_cost: null, bid_amount: 624000, margin_pct: null, start_date: null, end_date: null, notes: 'SOG 15,000 SF, retaining wall 340 LF, sidewalk 3,200 SF. Lost — GC went with incumbent sub. First time bidding with Hensel Phelps.' },
  { id: 'J-007', estimate_id: null, project_name: 'Cypress Creek Elementary', gc_name: 'Rogers-O\'Brien', project_type: 'municipal', location: 'Houston TX', status: 'complete', estimated_cost: 305800, actual_cost: 305800, bid_amount: 328000, margin_pct: 6.8, start_date: '2024-07-01', end_date: '2025-01-15', notes: 'SOG 9,800 SF, curb 1,100 LF, sidewalk 2,400 SF. School project, tight timeline, weekend pours required' },
  { id: 'J-008', estimate_id: null, project_name: 'Galleria Area Retail', gc_name: 'Turner Construction', project_type: 'commercial', location: 'Houston TX', status: 'complete', estimated_cost: 189500, actual_cost: 189500, bid_amount: 198000, margin_pct: 4.3, start_date: '2025-02-01', end_date: '2025-08-15', notes: 'SOG 5,400 SF, curb 900 LF, decorative sidewalk 1,600 SF. Exposed aggregate sidewalks were slow.' },
  // ACTIVE
  { id: 'J-009', estimate_id: null, project_name: 'Westpark Retail Center', gc_name: 'McCarthy Building', project_type: 'commercial', location: 'Houston TX', status: 'active', estimated_cost: 412000, actual_cost: null, bid_amount: 412000, margin_pct: null, start_date: '2026-01-15', end_date: null, notes: 'SOG 11,000 SF, curb 1,400 LF, sidewalk 2,800 SF, 18 piers. 40% complete. Budget remaining $186,400. Rebar usage 18% over estimate on pier caps.' },
  { id: 'J-010', estimate_id: null, project_name: 'St. Luke\'s Parking Structure', gc_name: 'DPR Construction', project_type: 'commercial', location: 'Houston TX', status: 'active', estimated_cost: 678000, actual_cost: null, bid_amount: 678000, margin_pct: null, start_date: '2026-02-01', end_date: null, notes: 'Elevated slab 18,000 SF, retaining wall 180 LF, 32 piers. 20% complete. Budget remaining $542,400. Pier drilling starting next week.' },
  { id: 'J-011', estimate_id: null, project_name: 'Samsung Fab Expansion (Equipment Pads)', gc_name: 'DPR Construction', project_type: 'industrial', location: 'Austin TX', status: 'active', estimated_cost: 185000, actual_cost: null, bid_amount: 185000, margin_pct: null, start_date: null, end_date: null, notes: 'Equipment pads 45 units, grade beams 800 LF, SOG 6,000 SF. Pending — estimate revised from $165K, awaiting GC approval. +12% material increase' },
  { id: 'J-012', estimate_id: null, project_name: 'Bishop Arts Mixed-Use', gc_name: 'Rogers-O\'Brien', project_type: 'commercial', location: 'Dallas TX', status: 'active', estimated_cost: 847300, actual_cost: null, bid_amount: 847300, margin_pct: null, start_date: null, end_date: null, notes: 'SOG 45,000 SF, curb 2,800 LF. Auto-generated estimate by bot. 18% margin. Pending approval.' },
];

const insertJob = db.prepare(`
  INSERT OR REPLACE INTO dacp_jobs (id, tenant_id, estimate_id, project_name, gc_name, project_type, location, status, estimated_cost, actual_cost, bid_amount, margin_pct, start_date, end_date, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const seedJobs = db.transaction(() => {
  for (const j of jobs) {
    insertJob.run(j.id, TENANT, j.estimate_id, j.project_name, j.gc_name, j.project_type, j.location, j.status, j.estimated_cost, j.actual_cost, j.bid_amount, j.margin_pct, j.start_date, j.end_date, j.notes);
  }
});
seedJobs();
console.log(`   Inserted ${jobs.length} jobs`);

// ─── 4. SEED BID REQUESTS ───────────────────────────────────────────────────

console.log('\n4. Inserting 5 bid requests...');

const bidRequests = [
  {
    id: 'BR-001',
    from_email: 'dkim@rogers-obrien.com',
    from_name: 'David Kim',
    gc_name: 'Rogers-O\'Brien',
    subject: 'RFQ: Bishop Arts Mixed-Use — Concrete Package',
    body: 'David, here are the plans for Bishop Arts. We need pricing on SOG 45,000 SF and curb 2,800 LF. Bid due 3/19.',
    attachments: [],
    scope: ['6" SOG - 45,000 SF', 'Curb & gutter - 2,800 LF'],
    due_date: '2026-03-19',
    status: 'estimated',
    urgency: 'high',
    missing_info: [],
    received_at: '2026-03-09T06:42:00Z',
  },
  {
    id: 'BR-002',
    from_email: 'lchen@henselphelps.com',
    from_name: 'Lisa Chen',
    gc_name: 'Hensel Phelps',
    subject: 'ITB: I-35 Retaining Walls — Concrete Package',
    body: 'Soliciting bids for cantilever retaining walls along I-35 corridor. TxDOT specs apply.',
    attachments: [],
    scope: ['Cantilever retaining wall - 2,150 LF', 'Grade beams - 400 LF'],
    due_date: '2026-03-21',
    status: 'estimated',
    urgency: 'high',
    missing_info: [],
    received_at: '2026-03-08T14:15:00Z',
  },
  {
    id: 'BR-003',
    from_email: 'estimating@austincommercial.com',
    from_name: 'Austin Commercial',
    gc_name: 'Austin Commercial',
    subject: 'RFQ: McKinney Town Center — Full Concrete Package',
    body: 'Attached 48-page spec document for McKinney Town Center. Full concrete package needed.',
    attachments: [],
    scope: ['SOG (TBD)', 'Curb & gutter (TBD)', 'Sidewalk (TBD)', 'Piers (TBD)'],
    due_date: '2026-03-25',
    status: 'in_progress',
    urgency: 'medium',
    missing_info: ['Quantities still being parsed from 48-page spec'],
    received_at: '2026-03-08T09:30:00Z',
  },
  {
    id: 'BR-004',
    from_email: 'mrodriguez@turner.com',
    from_name: 'Mike Rodriguez',
    gc_name: 'Turner Construction',
    subject: 'RFQ: Memorial Hermann Phase 2 — Concrete',
    body: 'Phase 2 scope: SOG 8,500 SF, curb 1,200 LF, sidewalk 2,250 SF. Plans attached. Bid due Friday.',
    attachments: [],
    scope: ['6" SOG - 8,500 SF', 'Curb & gutter - 1,200 LF', 'Sidewalk 6" - 2,250 SF'],
    due_date: '2026-03-14',
    status: 'sent',
    urgency: 'high',
    missing_info: [],
    received_at: '2026-03-06T10:00:00Z',
  },
  {
    id: 'BR-005',
    from_email: 'rtorres@skanska.com',
    from_name: 'Robert Torres',
    gc_name: 'Skanska',
    subject: 'RFQ: Plano ISD Natatorium — Concrete & Specialty',
    body: 'Pool deck 12,000 SF, specialty coatings, underwater finishing. See attached.',
    attachments: [],
    scope: ['Pool deck - 12,000 SF', 'Specialty coatings', 'Underwater concrete finishing'],
    due_date: '2026-03-28',
    status: 'declined',
    urgency: 'low',
    missing_info: [],
    received_at: '2026-03-05T11:00:00Z',
  },
];

const insertBid = db.prepare(`
  INSERT OR REPLACE INTO dacp_bid_requests (id, tenant_id, from_email, from_name, gc_name, subject, body, attachments_json, scope_json, due_date, status, urgency, missing_info_json, received_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const seedBids = db.transaction(() => {
  for (const b of bidRequests) {
    insertBid.run(b.id, TENANT, b.from_email, b.from_name, b.gc_name, b.subject, b.body,
      JSON.stringify(b.attachments), JSON.stringify(b.scope), b.due_date, b.status, b.urgency,
      JSON.stringify(b.missing_info), b.received_at);
  }
});
seedBids();
console.log(`   Inserted ${bidRequests.length} bid requests`);

// ─── 5. SEED ESTIMATES ──────────────────────────────────────────────────────

console.log('\n5. Inserting 3 estimates...');

const estimates = [
  {
    id: 'EST-001',
    bid_request_id: 'BR-001',
    project_name: 'Bishop Arts Mixed-Use',
    gc_name: 'Rogers-O\'Brien',
    status: 'draft',
    line_items: [
      { description: '6" SOG - 45,000 SF', pricingItem: '6" Slab on Grade', quantity: 45000, unit: 'SF', unitPrice: 6.90, extended: 310500 },
      { description: 'Curb & gutter - 2,800 LF', pricingItem: 'Standard Curb & Gutter', quantity: 2800, unit: 'LF', unitPrice: 18.00, extended: 50400 },
      { description: 'Mobilization', pricingItem: 'Mobilization', quantity: 1, unit: 'LS', unitPrice: 3500, extended: 3500 },
      { description: 'Concrete Testing', pricingItem: 'Testing Allowance', quantity: 1, unit: 'LS', unitPrice: 2400, extended: 2400 },
      { description: 'Rebar (supply + install)', pricingItem: '#5 Rebar Install', quantity: 42000, unit: 'LB', unitPrice: 1.17, extended: 49140 },
    ],
    subtotal: 415940,
    overhead_pct: 10,
    profit_pct: 15,
    mobilization: 5900,
    total_bid: 847300,
    confidence: 'high',
    notes: 'Auto-generated from SOW. 5 line items. 18% margin.',
  },
  {
    id: 'EST-002',
    bid_request_id: 'BR-002',
    project_name: 'I-35 Retaining Walls',
    gc_name: 'Hensel Phelps',
    status: 'draft',
    line_items: [
      { description: 'Cantilever retaining wall - 2,150 LF', pricingItem: 'Cast-in-Place Wall (12")', quantity: 2150, unit: 'LF', unitPrice: 39.00, extended: 83850 },
      { description: 'Grade beams - 400 LF', pricingItem: 'Grade Beam (18"x24")', quantity: 400, unit: 'LF', unitPrice: 45.00, extended: 18000 },
      { description: 'Mobilization', pricingItem: 'Mobilization', quantity: 1, unit: 'LS', unitPrice: 3500, extended: 3500 },
      { description: 'Concrete Testing', pricingItem: 'Testing Allowance', quantity: 1, unit: 'LS', unitPrice: 1200, extended: 1200 },
    ],
    subtotal: 106550,
    overhead_pct: 10,
    profit_pct: 15,
    mobilization: 4700,
    total_bid: 312000,
    confidence: 'medium',
    notes: 'Estimated. Email drafted, pending approval.',
  },
  {
    id: 'EST-003',
    bid_request_id: 'BR-004',
    project_name: 'Memorial Hermann Phase 2',
    gc_name: 'Turner Construction',
    status: 'sent',
    line_items: [
      { description: '6" SOG - 8,500 SF', pricingItem: '6" Slab on Grade', quantity: 8500, unit: 'SF', unitPrice: 6.90, extended: 58650 },
      { description: 'Curb & gutter - 1,200 LF', pricingItem: 'Standard Curb & Gutter', quantity: 1200, unit: 'LF', unitPrice: 18.00, extended: 21600 },
      { description: 'Sidewalk 6" - 2,250 SF', pricingItem: 'Concrete Sidewalk (4")', quantity: 2250, unit: 'SF', unitPrice: 5.75, extended: 12937.50 },
      { description: 'Mobilization', pricingItem: 'Mobilization', quantity: 1, unit: 'LS', unitPrice: 2500, extended: 2500 },
      { description: 'Concrete Testing', pricingItem: 'Testing Allowance', quantity: 1, unit: 'LS', unitPrice: 1200, extended: 1200 },
    ],
    subtotal: 96887.50,
    overhead_pct: 10,
    profit_pct: 15,
    mobilization: 3700,
    total_bid: 266000,
    confidence: 'high',
    notes: 'Approved and sent to Mike Rodriguez at Turner.',
  },
];

const insertEstimate = db.prepare(`
  INSERT OR REPLACE INTO dacp_estimates (id, tenant_id, bid_request_id, project_name, gc_name, status, line_items_json, subtotal, overhead_pct, profit_pct, mobilization, total_bid, confidence, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const seedEstimates = db.transaction(() => {
  for (const e of estimates) {
    insertEstimate.run(e.id, TENANT, e.bid_request_id, e.project_name, e.gc_name, e.status,
      JSON.stringify(e.line_items), e.subtotal, e.overhead_pct, e.profit_pct, e.mobilization,
      e.total_bid, e.confidence, e.notes);
  }
});
seedEstimates();
console.log(`   Inserted ${estimates.length} estimates`);

// ─── 6. SEED APPROVAL ITEMS ─────────────────────────────────────────────────

console.log('\n6. Inserting 5 approval items...');

const insertApproval = db.prepare(`
  INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status, required_role, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const approvalItems = [
  { agent_id: 'estimating', title: 'Estimate ready for review: Bishop Arts Mixed-Use', description: "Rogers-O'Brien — 5 line items, $847K total, 18% margin — auto-generated from SOW", type: 'estimate', status: 'pending', offset: '-20 minutes' },
  { agent_id: 'field', title: "Field report flagged: Rock at 28' on pier P-5", description: 'Job J-002, Frisco Station — geotech discrepancy, estimated cost impact ~$8K', type: 'report', status: 'pending', offset: '-1 hours' },
  { agent_id: 'estimating', title: 'Revised estimate: Samsung Fab Expansion', description: 'DPR Construction — equipment pads updated from $165K to $185K (+12%) based on material price changes', type: 'estimate', status: 'pending', offset: '-3 hours' },
  { agent_id: 'bid_mgr', title: 'Bid deadline alert: I-35 Retaining Walls', description: 'Hensel Phelps — due 3/21, 12 days remaining. Estimate complete but not yet submitted.', type: 'estimate', status: 'pending', offset: '-4 hours' },
  { agent_id: 'estimating', title: 'New estimate started: McKinney Town Center', description: 'Austin Commercial — parsing 48-page spec document, 3 line items identified so far', type: 'estimate', status: 'pending', offset: '-5 hours' },
];

const seedApprovals = db.transaction(() => {
  for (const a of approvalItems) {
    insertApproval.run(TENANT, a.agent_id, a.title, a.description, a.type, null, a.status, 'admin', a.offset);
  }
});
seedApprovals();
console.log(`   Inserted ${approvalItems.length} approval items`);

// ─── 7. SEED NOTIFICATIONS ──────────────────────────────────────────────────

console.log('\n7. Inserting 4 notifications...');

const insertNotif = db.prepare(`
  INSERT INTO platform_notifications (tenant_id, user_id, agent_id, title, body, type, link_tab, read, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const notifications = [
  { agent_id: 'estimating', title: 'New estimate ready — Bishop Arts Mixed-Use', body: "$847,300 — Rogers-O'Brien — 5 line items, 18% margin", type: 'action', link_tab: 'estimating', read: 0, offset: '-20 minutes' },
  { agent_id: 'field', title: 'Rock flagged at Frisco Station pier P-5', body: 'Cost impact ~$8K — geotech discrepancy on Job J-002', type: 'warning', link_tab: 'field-reports', read: 0, offset: '-1 hours' },
  { agent_id: 'bid_mgr', title: 'Memorial Hermann Phase 2 bid due tomorrow', body: 'No response from Turner yet — sent 3 days ago', type: 'warning', link_tab: 'estimating', read: 0, offset: '-3 hours' },
  { agent_id: 'lead_engine', title: '6 new GC contacts discovered in DFW', body: 'Austin Commercial, Balfour Beatty + 4 others added to pipeline', type: 'info', link_tab: 'command', read: 0, offset: '-8 hours' },
];

const seedNotifs = db.transaction(() => {
  for (const n of notifications) {
    insertNotif.run(TENANT, 'dacp-admin-001', n.agent_id, n.title, n.body, n.type, n.link_tab, n.read, n.offset);
  }
});
seedNotifs();
console.log(`   Inserted ${notifications.length} notifications`);

// ─── 8. SEED CHAT MESSAGES ──────────────────────────────────────────────────

console.log('\n8. Inserting 3 chat conversations (12 messages)...');

const insertChat = db.prepare(`
  INSERT INTO chat_messages (tenant_id, agent_id, user_id, role, content, metadata_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const AGENT = 'estimating-chat';
const USER = 'dacp-admin-001';

const chatMessages = [
  // Conversation 1 — Memorial Hermann Phase 2 (3 days ago)
  { role: 'user', content: 'Turner just sent over the Memorial Hermann Phase 2 scope. 8,500 SF slab, 1,200 LF curb, 2,250 SF sidewalk. Bid due Friday.', offset: '-3 days', meta: null },
  { role: 'assistant', content: "I've pulled the scope and matched it against our pricing database. Here's the breakdown:\n\n\u2022 6\" SOG \u2014 8,500 SF \u00d7 $6.90 = $58,650\n\u2022 Curb & gutter \u2014 1,200 LF \u00d7 $18.00 = $21,600\n\u2022 Sidewalk \u2014 2,250 SF \u00d7 $5.75 = $12,938\n\u2022 Mobilization \u2014 $2,500\n\u2022 Testing \u2014 $1,200\n\nSubtotal: $96,888\nOverhead (10%): $9,689\nProfit (15%): $15,987\n\n**Total Bid: $266,000** (92% confidence)\n\nThis is consistent with Phase 1 pricing. Want me to draft the email to Mike Rodriguez?", offset: '-3 days', meta: null },
  { role: 'user', content: "Sidewalk should be $11.00 not $5.75 \u2014 we adjusted this last month for 6-inch.", offset: '-3 days', meta: null },
  { role: 'assistant', content: "Updated sidewalk to $11.00/SF (6\" heavy-duty). New total:\n\n\u2022 Sidewalk \u2014 2,250 SF \u00d7 $11.00 = $24,750\n\n**Revised Total: $266,000** (rounded). Here's the draft email to Mike Rodriguez at Turner...", offset: '-3 days', meta: null },
  { role: 'user', content: 'Looks good, send it.', offset: '-3 days', meta: null },
  { role: 'assistant', content: "Sent the estimate to mrodriguez@turner.com. I'll track for a response and flag you if we don't hear back in 48 hours.", offset: '-3 days', meta: null },

  // Conversation 2 — Samsung Fab revision (5 days ago)
  { role: 'user', content: "DPR says Samsung is adding 15 more equipment pads. Also concrete is up 8%. Can you revise the estimate?", offset: '-5 days', meta: null },
  { role: 'assistant', content: "I'll recalculate with 60 total pads (was 45) and updated TXI pricing at $158/CY (was $149).\n\nOriginal estimate: $165,000\nAdditional pads (15 \u00d7 ~$1,200): +$18,000\nMaterial increase (8% on concrete): +$2,400\n\n**Revised Total: $185,000** (+12%)\n\nI've attached the TXI price letter showing the 8% increase. Want me to send this to Sarah Williams at DPR?", offset: '-5 days', meta: null },
  { role: 'user', content: 'Send it to Sarah at DPR with a note about the price increase.', offset: '-5 days', meta: null },
  { role: 'assistant', content: 'Drafted email to swilliams@dpr.com with the revised estimate and TXI price letter reference. Sending now.', offset: '-5 days', meta: null },

  // Conversation 3 — Natatorium decline (4 days ago)
  { role: 'user', content: "Skanska sent a bid for a natatorium at Plano ISD. Can you look at the scope?", offset: '-4 days', meta: null },
  { role: 'assistant', content: "I've reviewed the Plano ISD Natatorium scope:\n\n\u2022 Pool deck \u2014 12,000 SF\n\u2022 Specialty coatings\n\u2022 Underwater concrete finishing\n\n\u26a0\ufe0f **Recommendation: Decline this bid.**\n\nThis includes pool deck coatings, underwater concrete finishing, and specialty waterproofing \u2014 all outside DACP's typical concrete scope. Your win rate on specialty work is 12% vs 62% on foundation/flatwork.\n\nI'd recommend focusing on the McKinney Town Center and I-35 opportunities instead. Both are in your wheelhouse and due within 2 weeks.", offset: '-4 days', meta: null },
  { role: 'user', content: 'Good call, pass on it.', offset: '-4 days', meta: null },
  { role: 'assistant', content: "Marked as declined. I'll send a polite pass to Robert Torres at Skanska and keep DACP on their bid list for future flatwork/foundation projects.", offset: '-4 days', meta: null },
];

const seedChat = db.transaction(() => {
  for (const m of chatMessages) {
    insertChat.run(TENANT, AGENT, USER, m.role, m.content, m.meta, m.offset);
  }
});
seedChat();
console.log(`   Inserted ${chatMessages.length} chat messages`);

// ─── 9. SEED KNOWLEDGE ENTRIES (MEETING SUMMARIES) ──────────────────────────

console.log('\n9. Inserting 3 knowledge entries (meetings)...');

const insertKnowledge = db.prepare(`
  INSERT OR REPLACE INTO knowledge_entries (id, tenant_id, type, title, summary, transcript, content, source, source_agent, duration_seconds, recorded_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

const knowledgeEntries = [
  {
    id: 'MEET-001',
    type: 'meeting',
    title: 'Turner Coordination Call — Memorial Hermann Phase 2',
    summary: 'Reviewed concrete pour schedule for Phase 2. Turner wants pours to start March 24. DACP confirmed crew availability. Mike mentioned possible Phase 3 scope — additional parking structure. Asked for pricing on 36" piers to 35\' depth.',
    transcript: null,
    content: "Action Items:\n- DACP to confirm rebar delivery date with CMC Steel (Marcel, by March 10)\n- DACP to provide Phase 3 pier pricing (Estimating Bot, by March 12)",
    source: 'meeting_bot',
    source_agent: 'meeting_bot',
    duration_seconds: 2280,
    recorded_at: '2026-03-06T14:00:00Z',
  },
  {
    id: 'MEET-002',
    type: 'meeting',
    title: 'Weekly Team Standup',
    summary: "Reviewed active job status. Westpark Retail on track. St. Luke's pier drilling starts next week — geotech shows rock at 22'. Samsung Fab estimate needs revision due to material cost increase. Bishop Arts RFQ came in — Juan will review specs.",
    transcript: null,
    content: "Action Items:\n- Juan to review Bishop Arts specs (done — bot generated estimate)\n- Marcel to call TXI about concrete price lock for Q2 (by March 7)\n- Carlos to document rock conditions at Frisco Station for change order (by March 8)\n- David to follow up with Hensel Phelps on I-35 relationship (ongoing)",
    source: 'meeting_bot',
    source_agent: 'meeting_bot',
    duration_seconds: 2700,
    recorded_at: '2026-03-05T15:00:00Z',
  },
  {
    id: 'MEET-003',
    type: 'meeting',
    title: 'DPR Samsung Fab Scope Review',
    summary: 'DPR informed DACP that Samsung is adding 15 additional equipment pads. Original bid was $165K. Sarah asked for revised pricing by end of week. Material costs up 8% — DPR wants DACP to absorb half. David pushed back, said full pass-through is industry standard.',
    transcript: null,
    content: "Action Items:\n- DACP to submit revised estimate with additional pads + updated material costs (Estimating Bot, by March 7)\n- David to send DPR the TXI price letter showing 8% increase (Marcel, by March 5)",
    source: 'meeting_bot',
    source_agent: 'meeting_bot',
    duration_seconds: 1500,
    recorded_at: '2026-03-03T10:00:00Z',
  },
];

const seedKnowledge = db.transaction(() => {
  for (const k of knowledgeEntries) {
    insertKnowledge.run(k.id, TENANT, k.type, k.title, k.summary, k.transcript, k.content, k.source, k.source_agent, k.duration_seconds, k.recorded_at);
  }
});
seedKnowledge();
console.log(`   Inserted ${knowledgeEntries.length} knowledge entries`);

// ─── 10. SEED KNOWLEDGE ENTITIES (GC PROFILES) ─────────────────────────────

console.log('\n10. Inserting 7 GC profiles (knowledge entities)...');

const insertEntity = db.prepare(`
  INSERT OR REPLACE INTO knowledge_entities (id, tenant_id, entity_type, name, metadata_json)
  VALUES (?, ?, ?, ?, ?)
`);

const gcProfiles = [
  { id: 'GC-001', name: 'Turner Construction', metadata: { type: 'gc', contact: 'Mike Rodriguez', email: 'mrodriguez@turner.com', role: 'PM', jobs_bid: 6, jobs_won: 4, win_rate: 67, avg_margin: 6.0, payment_terms: 'Net 30', payment_reliability: 'Good', notes: 'Best GC relationship. Mike responds within 24 hours. Always fair on scope.' } },
  { id: 'GC-002', name: 'DPR Construction', metadata: { type: 'gc', contact: 'Sarah Williams', email: 'swilliams@dpr.com', role: 'PM', jobs_bid: 5, jobs_won: 3, win_rate: 60, avg_margin: 2.1, payment_terms: 'Net 45', payment_reliability: 'Slow but reliable', notes: 'High volume but tight margins. Good for keeping crews busy.' } },
  { id: 'GC-003', name: 'McCarthy Building Companies', metadata: { type: 'gc', contact: 'James Park', email: 'jpark@mccarthy.com', role: 'PM', jobs_bid: 4, jobs_won: 2, win_rate: 50, avg_margin: 7.1, payment_terms: 'Net 30', payment_reliability: 'Excellent', notes: 'Best margins. Quality-focused, less price-sensitive.' } },
  { id: 'GC-004', name: 'Hensel Phelps', metadata: { type: 'gc', contact: 'Lisa Chen', email: 'lchen@henselphelps.com', role: 'PM', jobs_bid: 2, jobs_won: 0, win_rate: 0, payment_terms: 'Net 60', payment_reliability: 'Unknown', notes: 'Trying to break in. Lost both bids. Need relationship building.' } },
  { id: 'GC-005', name: 'Skanska', metadata: { type: 'gc', contact: 'Robert Torres', email: 'rtorres@skanska.com', role: 'PM', jobs_bid: 3, jobs_won: 0, win_rate: 0, payment_terms: 'Net 45', payment_reliability: 'Unknown', notes: 'Price-focused. Hard to win without being cheapest. Consider avoiding.' } },
  { id: 'GC-006', name: "Rogers-O'Brien", metadata: { type: 'gc', contact: 'David Kim', email: 'dkim@rogers-obrien.com', role: 'PM', jobs_bid: 3, jobs_won: 2, win_rate: 67, avg_margin: 6.8, payment_terms: 'Net 30', payment_reliability: 'Good', notes: 'Dallas-based. Growing relationship. Good school/retail work.' } },
  { id: 'GC-007', name: 'Austin Commercial', metadata: { type: 'gc', contact: 'pending', jobs_bid: 0, notes: 'New GC contact. Lead Engine discovered them. Large healthcare pipeline in Houston.' } },
];

const seedEntities = db.transaction(() => {
  for (const g of gcProfiles) {
    insertEntity.run(g.id, TENANT, 'company', g.name, JSON.stringify(g.metadata));
  }
});
seedEntities();
console.log(`   Inserted ${gcProfiles.length} GC profiles`);

// ─── 11. SEED FIELD REPORTS ─────────────────────────────────────────────────

console.log('\n11. Inserting 3 field reports...');

const insertReport = db.prepare(`
  INSERT OR REPLACE INTO dacp_field_reports (id, tenant_id, job_id, date, reported_by, work_json, materials_json, labor_json, equipment_json, weather, notes, issues_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const fieldReports = [
  {
    id: 'FR-001',
    job_id: 'J-009',
    date: '2026-03-07',
    reported_by: 'Carlos Mendez',
    work: ['Poured 52 CY slab section B', 'Finished and cured section A from yesterday', 'Set forms for section C'],
    materials: [
      { item: '4000 PSI concrete', quantity: 52, unit: 'CY' },
      { item: '#5 rebar', quantity: 2400, unit: 'LB' },
      { item: 'Wire mesh', quantity: 3200, unit: 'SF' },
    ],
    labor: { crew_size: 6, hours: 48, overtime: 4, cost: 4800 },
    equipment: ['42m boom pump', '2x vibrators', 'Power trowel'],
    weather: 'Clear, 78\u00b0F',
    notes: 'Good pour day. Section B went smooth.',
    issues: [],
  },
  {
    id: 'FR-002',
    job_id: 'J-009',
    date: '2026-03-08',
    reported_by: 'Carlos Mendez',
    work: ['Set rebar for section C', 'Curb forms along west side - 200 LF', 'Graded subbase for section D'],
    materials: [
      { item: '#5 rebar', quantity: 1800, unit: 'LB' },
      { item: 'Form lumber', quantity: 1, unit: 'LS' },
    ],
    labor: { crew_size: 5, hours: 40, overtime: 0, cost: 3800 },
    equipment: ['Skid steer', 'Plate compactor'],
    weather: 'Partly cloudy, 82\u00b0F',
    notes: 'Rebar usage 18% over estimate on pier caps — flagging for review.',
    issues: ['Rebar usage over estimate on pier caps'],
  },
  {
    id: 'FR-003',
    job_id: 'J-010',
    date: '2026-03-07',
    reported_by: 'Juan Reyes',
    work: ["Drilled 4 piers (P-1 through P-4) to 22'", 'Installed rebar cages in P-1 and P-2', 'Poured P-1'],
    materials: [
      { item: '5000 PSI concrete', quantity: 18, unit: 'CY' },
      { item: '#8 rebar cages', quantity: 2, unit: 'EA' },
    ],
    labor: { crew_size: 4, hours: 36, overtime: 2, cost: 3600 },
    equipment: ['Drill rig', 'Crane (25T)', 'Tremie pipe'],
    weather: 'Clear, 75\u00b0F',
    notes: "Rock encountered at 22' as geotech predicted. No issues so far.",
    issues: [],
  },
];

const seedReports = db.transaction(() => {
  for (const f of fieldReports) {
    insertReport.run(f.id, TENANT, f.job_id, f.date, f.reported_by,
      JSON.stringify(f.work), JSON.stringify(f.materials), JSON.stringify(f.labor),
      JSON.stringify(f.equipment), f.weather, f.notes, JSON.stringify(f.issues));
  }
});
seedReports();
console.log(`   Inserted ${fieldReports.length} field reports`);

// ─── 12. SEED KNOWLEDGE LINKS ───────────────────────────────────────────────

console.log('\n12. Inserting knowledge links (meeting → GC)...');

const insertLink = db.prepare(`
  INSERT OR REPLACE INTO knowledge_links (id, entry_id, entity_id, relationship)
  VALUES (?, ?, ?, ?)
`);

const knowledgeLinks = [
  { id: 'LNK-001', entry_id: 'MEET-001', entity_id: 'GC-001', relationship: 'discussed' },   // Turner call
  { id: 'LNK-002', entry_id: 'MEET-002', entity_id: 'GC-004', relationship: 'mentioned' },   // Standup — Hensel Phelps
  { id: 'LNK-003', entry_id: 'MEET-002', entity_id: 'GC-002', relationship: 'mentioned' },   // Standup — DPR
  { id: 'LNK-004', entry_id: 'MEET-003', entity_id: 'GC-002', relationship: 'discussed' },   // DPR Samsung call
];

const seedLinks = db.transaction(() => {
  for (const l of knowledgeLinks) {
    insertLink.run(l.id, l.entry_id, l.entity_id, l.relationship);
  }
});
seedLinks();
console.log(`   Inserted ${knowledgeLinks.length} knowledge links`);

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

console.log('\n=== SEED COMPLETE ===\n');

const counts = {
  'dacp_pricing': db.prepare('SELECT COUNT(*) as n FROM dacp_pricing WHERE tenant_id = ?').get(TENANT).n,
  'dacp_jobs': db.prepare('SELECT COUNT(*) as n FROM dacp_jobs WHERE tenant_id = ?').get(TENANT).n,
  'dacp_bid_requests': db.prepare('SELECT COUNT(*) as n FROM dacp_bid_requests WHERE tenant_id = ?').get(TENANT).n,
  'dacp_estimates': db.prepare('SELECT COUNT(*) as n FROM dacp_estimates WHERE tenant_id = ?').get(TENANT).n,
  'dacp_field_reports': db.prepare('SELECT COUNT(*) as n FROM dacp_field_reports WHERE tenant_id = ?').get(TENANT).n,
  'approval_items': db.prepare('SELECT COUNT(*) as n FROM approval_items WHERE tenant_id = ?').get(TENANT).n,
  'platform_notifications': db.prepare('SELECT COUNT(*) as n FROM platform_notifications WHERE tenant_id = ?').get(TENANT).n,
  'chat_messages': db.prepare('SELECT COUNT(*) as n FROM chat_messages WHERE tenant_id = ?').get(TENANT).n,
  'knowledge_entries': db.prepare('SELECT COUNT(*) as n FROM knowledge_entries WHERE tenant_id = ?').get(TENANT).n,
  'knowledge_entities': db.prepare('SELECT COUNT(*) as n FROM knowledge_entities WHERE tenant_id = ?').get(TENANT).n,
  'knowledge_links': db.prepare('SELECT COUNT(*) as n FROM knowledge_links WHERE entry_id LIKE ?').get('MEET-%').n,
};

let total = 0;
for (const [table, count] of Object.entries(counts)) {
  console.log(`  ${table.padEnd(25)} ${String(count).padStart(4)} rows`);
  total += count;
}
console.log(`  ${'─'.repeat(35)}`);
console.log(`  ${'TOTAL'.padEnd(25)} ${String(total).padStart(4)} rows\n`);

db.close();
