/**
 * Seed Sangha Weekly Operations Call (March 9, 2026)
 *
 * Run: node scripts/seed-sangha-meeting.js
 *
 * Inserts:
 * - 1 knowledge entry (full meeting transcript)
 * - 10 action items
 * - 3 approval queue items
 * - 5 agent insights
 * - 14 entity profiles (people, companies, sites)
 * - Knowledge links connecting entities to meeting entry
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = new Database(join(__dirname, '../data/cache.db'));

const TENANT_ID = 'default'; // Sangha tenant
const MEETING_ID = 'KN-SANGHA-WEEKLY-0309';

console.log('Seeding Sangha weekly meeting data...\n');

// ─── 1. Knowledge Entry ─────────────────────────────────────────────────────

const meetingContent = `SANGHA WEEKLY OPERATIONS CALL — MARCH 9, 2026
Participants: Spencer Marr, Colin Peirce, Mihir Bhangley, Kishan Sutariya, Ken Kramer

═══ KEY TOPICS ═══

1. LAND EXPANSION & DEVELOPMENT STRATEGY
- Negotiating with Hanwha for 50 acres total (including existing land)
- Proposed land trade: Sangha gives easement consents, Hanwha gives more acreage
- April 1 option expiry — changes before deadline unlikely, anticipate post-deadline assignment
- Strategic pivot: shifting Oberon from mining to powered land play
- Marathon Capital backing the powered land strategy
- Target customers: AI developers willing to pay premium for powered land
- Dual-path strategy: underwrite sites on mining economics as baseline, convert best sites to powered land
- Example: South Dakota site will mine behind-the-meter for 5-6 years before potential conversion

2. FUNDRAISING & FINANCIAL PLANNING
- Target: raise $4M total
- Current commitments: $250,000
- Realistic near-term target: $2M (per Mike's projection)
- Spencer meeting interested parties in Minneapolis
- Tax filing extensions in place, target mid-May for K-1 distribution
- Cap table adjustment: ~$350K related to Sangha Development contributions being finalized
- ~8 subsidiary entities with activity need financial statements
- Fusion deal closing delayed by prolonged legal/tax review
- Fusion approval needed for unconditional lien waivers → prerequisite for hard money loan

3. EQUIPMENT FINANCING
- Auradyne reduced ASIC price: $5,500 → $4,500 per unit
- Purchase: 245 units = ~$2M total
- Primary loan option: Excalibur, 9-year term, ~8.5% interest, ~$39K/month payments
- Backup loan option: hard money $2M at 15% over 4 years, ~$55K/month
- Connor leading USDA approval and alternative loan shopping
- Converting interim profit sharing deal into long-term fixed fee agreement
- Hosting (Bit Deer) not viable — non-committal, lenders need upfront liquidity

4. OPERATIONAL CHALLENGES
- Ambient heat causing significant mining downtime
- Machines forced to downclock for longer periods → revenue impact
- March revenue forecasts being revised downward
- Cooling options considered: water tower/curtain (mineral buildup concerns), wind walls (low cost but weather issues)
- Original system design had double dry cooler capacity, later reduced — root cause of current heat issues
- Metering problems limiting real-time billing and performance data accuracy
- Jason Gunderson and Marcel working on metering fixes

5. INVESTOR COMMUNICATIONS
- Updated financial forecast model nearly ready
- Colin finalizing comments → sends to Spencer → Spencer adds explanatory guidance
- Model needs clear base case toggles and hash price scenario instructions
- ASIC purchasing strategy for remaining 35% of units still uncertain — affects projections
- Focus on transparency to maintain investor confidence

═══ ACTION ITEMS ═══

SPENCER MARR:
☐ Send KMZ file and email to Hanwha outlining desired 50-acre expansion — ASAP
☐ Call Chris (Fusion) to clarify loan closing issues and hard money loan terms — ASAP
☐ Call with Connor at 2 PM ET re: Excalibur loan terms and USDA approval — Today
☐ Continue pushing Fusion deal and hard money loan process — Ongoing
☐ Review investor forecast model after Colin sends it — This week
☐ Minneapolis investor meetings — This week

KISHAN SUTARIYA:
☐ Work with Mihir to reconcile March forecast and daily revenue/uptime data — Before 1 PM meeting
☐ Prepare operational data for discussion — Today

COLIN PEIRCE:
☐ Send email to Mihir re: cap table corrections and due-to/due-from reconciliations — Today
☐ Finalize comments on investor forecast model → send to Spencer — This week
☐ Coordinate Minneapolis fundraising meetings — This week

MIHIR BHANGLEY:
☐ Send investor notification emails re: tax filing extension — ASAP
☐ Reconcile forecast figures with Colin and Kishan (March revenue, uptime) — Before next meeting
☐ Review energy billing docs, work with Ken on 2022 AEP payment confirmations — This week

KEN KRAMER:
☐ Continue searching for 2022 AEP payment receipts → share with Mihir — This week

ALL:
☐ Prepare for Minneapolis fundraising meetings
☐ Monitor Bit Deer and Auradyne re: ASIC swap and profit sharing proposals

═══ KEY NUMBERS ═══

Fundraise target: $4,000,000
Current commitments: $250,000
ASIC unit price (Auradyne): $4,500 (was $5,500)
ASIC purchase quantity: 245 units
Total equipment cost: ~$2,000,000
Excalibur loan: 9 years, ~8.5%, ~$39,000/month
Hard money backup: 4 years, 15%, ~$55,000/month
Cap table adjustment: ~$350,000
Subsidiary entities: ~8
Tax document target: mid-May

═══ ENTITIES REFERENCED ═══

COMPANIES: Hanwha, Marathon Capital, Auradyne, Excalibur, Fusion, Bit Deer, AEP
PEOPLE: Spencer Marr, Colin Peirce, Mihir Bhangley, Kishan Sutariya, Ken Kramer, Connor, Ashley, Jason Gunderson, Marcel, Mike, Chris
SITES: Oberon (primary), South Dakota site`;

const meetingSummary = `Weekly operations call covering land expansion negotiations with Hanwha (targeting 50 acres), strategic pivot from mining to powered land for AI developers, fundraise status ($250K committed of $4M target), Auradyne ASIC pricing reduction ($5,500 → $4,500 for 245 units), Excalibur loan terms ($39K/mo at 8.5% over 9 years), Fusion deal delays blocking hard money loan, ambient heat causing mining downtime and revenue forecast revisions, and investor model preparation for external distribution.`;

db.prepare(`INSERT OR REPLACE INTO knowledge_entries (id, tenant_id, type, title, summary, content, source, recorded_at, created_at, processed)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)`).run(
  MEETING_ID, TENANT_ID, 'meeting',
  'Sangha Weekly Operations Call — March 9, 2026',
  meetingSummary,
  meetingContent,
  'call_transcript',
  '2026-03-09T10:00:00'
);
console.log('✓ Knowledge entry inserted');

// ─── 2. Action Items ─────────────────────────────────────────────────────────

const actionItems = [
  { id: 'TASK-S-001', assignee: 'Spencer Marr', title: 'Send KMZ file and acreage expansion email to Hanwha', due: '2026-03-10' },
  { id: 'TASK-S-002', assignee: 'Spencer Marr', title: 'Call Chris at Fusion — clarify loan closing and hard money terms', due: '2026-03-10' },
  { id: 'TASK-S-003', assignee: 'Spencer Marr', title: 'Call with Connor at 2 PM ET — Excalibur loan terms, USDA approval', due: '2026-03-09' },
  { id: 'TASK-S-004', assignee: 'Mihir Bhangley', title: 'Send investor notification emails — tax filing extension', due: '2026-03-11' },
  { id: 'TASK-S-005', assignee: 'Colin Peirce', title: 'Finalize investor forecast model — send to Spencer for review', due: '2026-03-12' },
  { id: 'TASK-S-006', assignee: 'Colin Peirce', title: 'Email Mihir re: cap table corrections and due-to/due-from reconciliation', due: '2026-03-10' },
  { id: 'TASK-S-007', assignee: 'Kishan Sutariya', title: 'Reconcile March forecast with daily revenue/uptime data', due: '2026-03-10' },
  { id: 'TASK-S-008', assignee: 'Mihir Bhangley', title: 'Review energy billing — work with Ken on 2022 AEP payment confirmations', due: '2026-03-14' },
  { id: 'TASK-S-009', assignee: 'Ken Kramer', title: 'Search for 2022 AEP payment receipts — share with Mihir', due: '2026-03-14' },
  { id: 'TASK-S-010', assignee: 'Spencer Marr', title: 'Minneapolis investor meetings — close fundraise commitments', due: '2026-03-14' },
];

const insertAction = db.prepare(`INSERT OR REPLACE INTO action_items (id, tenant_id, entry_id, title, assignee, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', datetime('now'))`);
for (const a of actionItems) {
  insertAction.run(a.id, TENANT_ID, MEETING_ID, a.title, a.assignee, a.due);
}
console.log(`✓ ${actionItems.length} action items inserted`);

// ─── 3. Approval Queue Items ─────────────────────────────────────────────────

const approvals = [
  {
    tenant: TENANT_ID, agent: 'email', title: 'Investor tax extension notification',
    desc: 'Email to all investors notifying them of tax filing extension. K-1s targeted for mid-May distribution.',
    type: 'email_draft',
    payload: JSON.stringify({
      to: 'investors@sanghasystems.com',
      subject: 'Sangha Renewables — Tax Filing Extension Notice',
      body: "Dear Investors,\n\nWe are writing to inform you that tax filing extensions have been filed for all Sangha entities. We anticipate distributing K-1 documents by mid-May 2026.\n\nWe appreciate your patience as we finalize subsidiary financial statements across approximately eight entities with activity. If you have any questions, please don't hesitate to reach out.\n\nBest regards,\nMihir Bhangley\nSangha Renewables"
    }),
  },
  {
    tenant: TENANT_ID, agent: 'reporting', title: 'Investor forecast model — ready for Spencer review',
    desc: "Updated financial model with hash price scenarios and ASIC purchasing assumptions. Colin added final comments. Needs Spencer's explanatory guidance before external distribution.",
    type: 'report',
    payload: JSON.stringify({ file: 'Sangha_Investor_Forecast_Model_Mar2026.xlsx', next_step: 'Spencer adds guidance notes → distribute to investors' }),
  },
  {
    tenant: TENANT_ID, agent: 'email', title: 'Hanwha land expansion — KMZ file and proposal',
    desc: 'Draft email to Hanwha outlining desired 50-acre expansion with KMZ file attachment. Includes proposed easement consent trade.',
    type: 'email_draft',
    payload: JSON.stringify({
      to: 'contact@hanwha.com',
      subject: 'Sangha Renewables — Oberon Land Expansion Proposal',
      body: 'Attached is our KMZ file outlining the desired 50-acre footprint for the Oberon project expansion. We propose a land trade: Sangha provides easement consents (needed for your lender approvals) in exchange for additional acreage on the western parcel.\n\nWe believe this arrangement benefits both parties and would like to discuss before the April 1 option expiry.\n\nBest regards,\nSpencer Marr\nSangha Renewables'
    }),
  },
];

const insertApproval = db.prepare(`INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`);
for (const a of approvals) {
  insertApproval.run(a.tenant, a.agent, a.title, a.desc, a.type, a.payload);
}
console.log(`✓ ${approvals.length} approval items inserted`);

// ─── 4. Agent Insights ───────────────────────────────────────────────────────

const insights = [
  {
    id: 'INS-S-001', agent: 'monitoring', type: 'alert', cat: 'OPERATIONS', priority: 'high',
    title: 'Ambient heat reducing mining uptime — March revenue at risk',
    desc: 'Machine downclocking increasing due to ambient temperatures. March revenue forecast being revised downward. Consider low-capex cooling solutions: wind walls, water curtain.',
    actions: ['View Forecast', 'Dismiss'],
  },
  {
    id: 'INS-S-002', agent: 'reporting', type: 'reminder', cat: 'FUNDRAISE', priority: 'high',
    title: 'Minneapolis investor meetings this week — $250K of $4M committed',
    desc: 'Spencer meeting interested parties. Mike projects ~$2M realistic near-term. Investor forecast model nearly ready for distribution.',
    actions: ['View Action Items', 'Dismiss'],
  },
  {
    id: 'INS-S-003', agent: 'email', type: 'follow_up', cat: 'FINANCING', priority: 'medium',
    title: 'Fusion deal still in legal review — blocks hard money loan',
    desc: 'Fusion approval needed for unconditional lien waivers. Spencer to call Chris. Excalibur loan terms: 9yr, 8.5%, $39K/mo. Backup: hard money $2M at 15% over 4yr.',
    actions: ['Send Reminder', 'Dismiss'],
  },
  {
    id: 'INS-S-004', agent: 'monitoring', type: 'insight', cat: 'EQUIPMENT', priority: 'low',
    title: 'Auradyne ASIC price reduction secured — $4,500/unit (was $5,500)',
    desc: '245 units at $4,500 = ~$2M. Monthly debt service reduced from $55K to $39K with Excalibur terms. Bit Deer hosting still non-committal.',
    actions: ['View Details', 'Dismiss'],
  },
  {
    id: 'INS-S-005', agent: 'reporting', type: 'reminder', cat: 'FINANCE', priority: 'medium',
    title: 'Tax documents due mid-May — 8 entities need financial statements',
    desc: 'Extensions filed. Cap table adjustment of ~$350K pending. Fusion deal must close before subsidiary statements can be finalized. Investor notification email drafted and pending approval.',
    actions: ['View Tasks', 'Dismiss'],
  },
];

const insertInsight = db.prepare(`INSERT OR REPLACE INTO agent_insights (id, tenant_id, agent_id, type, category, title, description, priority, actions_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`);
for (const ins of insights) {
  insertInsight.run(ins.id, TENANT_ID, ins.agent, ins.type, ins.cat, ins.title, ins.desc, ins.priority, JSON.stringify(ins.actions));
}
console.log(`✓ ${insights.length} agent insights inserted`);

// ─── 5. Entity Profiles ──────────────────────────────────────────────────────

const entities = [
  // People
  { id: 'ent-meet-spencer', type: 'person', name: 'Spencer Marr', meta: { role: 'President', notes: 'Leading BD, fundraise, land negotiations with Hanwha. Meeting investors in Minneapolis. Primary decision maker.' } },
  { id: 'ent-meet-colin', type: 'person', name: 'Colin Peirce', meta: { role: 'Fundraising & Finance', notes: 'Managing investor forecast model, cap table corrections. Coordinating Minneapolis meetings.' } },
  { id: 'ent-meet-mihir', type: 'person', name: 'Mihir Bhangley', meta: { role: 'Co-founder / Finance', notes: 'Tax filings, forecast reconciliation, energy billing review. Extensions filed for all entities.' } },
  { id: 'ent-meet-kishan', type: 'person', name: 'Kishan Sutariya', meta: { role: 'Operations', notes: 'Daily revenue/uptime data, March forecast reconciliation.' } },
  { id: 'ent-meet-ken', type: 'person', name: 'Ken Kramer', meta: { role: 'Finance', notes: 'Searching for 2022 AEP payment receipts and confirmations.' } },
  { id: 'ent-meet-connor', type: 'person', name: 'Connor', meta: { role: 'Loan Negotiations', notes: 'Leading Excalibur/USDA approval process. Shopping alternative hard money lenders.' } },
  // Companies
  { id: 'ent-meet-hanwha', type: 'company', name: 'Hanwha', meta: { role: 'Land Counterparty', notes: 'Negotiating 50-acre expansion at Oberon. Needs Sangha easement consents for lender approvals.' } },
  { id: 'ent-meet-auradyne', type: 'company', name: 'Auradyne', meta: { role: 'ASIC Manufacturer', notes: 'Reduced unit price $5,500 → $4,500. Purchase of 245 units (~$2M). Profit sharing → fixed fee.' } },
  { id: 'ent-meet-excalibur', type: 'company', name: 'Excalibur', meta: { role: 'Primary Lender', notes: '9-year loan, ~8.5%, ~$39K/month, no capital reserves. Pending USDA approval.' } },
  { id: 'ent-meet-fusion', type: 'company', name: 'Fusion', meta: { role: 'Deal Counterparty', notes: 'Closing delayed by legal/tax review. Approval needed for unconditional lien waivers. Blocks hard money loan.' } },
  { id: 'ent-meet-bitdeer', type: 'company', name: 'Bit Deer', meta: { role: 'Potential Hosting Partner', notes: 'Non-committal on hosting arrangement. Not reliable backup.' } },
  { id: 'ent-meet-marathon', type: 'company', name: 'Marathon Capital', meta: { role: 'Advisory / Backing', notes: 'Backing the powered land strategy pivot for Oberon.' } },
  // Sites
  { id: 'ent-meet-oberon', type: 'project', name: 'Oberon', meta: { role: 'Primary Site', notes: 'Pivoting from mining to powered land. Targeting 50-acre expansion via Hanwha. Heat issues causing current mining downtime.' } },
  { id: 'ent-meet-sd', type: 'project', name: 'South Dakota Site', meta: { role: 'Remote Mining', notes: 'Behind-the-meter mining for 5-6 years. Potential powered land conversion later.' } },
];

const insertEntity = db.prepare(`INSERT OR REPLACE INTO knowledge_entities (id, tenant_id, entity_type, name, metadata_json) VALUES (?, ?, ?, ?, ?)`);
const insertLink = db.prepare(`INSERT OR REPLACE INTO knowledge_links (id, entry_id, entity_id, relationship) VALUES (?, ?, ?, ?)`);

for (const ent of entities) {
  insertEntity.run(ent.id, TENANT_ID, ent.type, ent.name, JSON.stringify(ent.meta));
  // Link entity to meeting entry
  insertLink.run(`link-${ent.id}`, MEETING_ID, ent.id, 'mentioned_in');
}
console.log(`✓ ${entities.length} entities inserted and linked`);

// ─── Summary ─────────────────────────────────────────────────────────────────

const knCount = db.prepare('SELECT COUNT(*) as c FROM knowledge_entries WHERE tenant_id = ?').get(TENANT_ID).c;
const aiCount = db.prepare("SELECT COUNT(*) as c FROM action_items WHERE tenant_id = ? AND status = 'open'").get(TENANT_ID).c;
const apCount = db.prepare("SELECT COUNT(*) as c FROM approval_items WHERE tenant_id = ? AND status = 'pending'").get(TENANT_ID).c;
const insCount = db.prepare("SELECT COUNT(*) as c FROM agent_insights WHERE tenant_id = ? AND status = 'active'").get(TENANT_ID).c;
const entCount = db.prepare('SELECT COUNT(*) as c FROM knowledge_entities WHERE tenant_id = ?').get(TENANT_ID).c;

console.log(`
═══ SEED COMPLETE ═══
Tenant: ${TENANT_ID} (Sangha)
Knowledge entries: ${knCount}
Open action items: ${aiCount}
Pending approvals: ${apCount}
Active insights: ${insCount}
Entities: ${entCount}
`);

db.close();
