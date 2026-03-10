/**
 * Seed Sangha Leadership Sync — March 7, 2026
 *
 * Run: node scripts/sangha-meeting-ingest.js
 *
 * Clears previous meeting ingest data, then inserts:
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

const TENANT_ID = 'default';
const MEETING_ID = 'KN-SANGHA-MTG-001';

console.log('Sangha Leadership Sync — March 7, 2026');
console.log('Clearing previous meeting ingest data...\n');

// ─── Clear previous data ────────────────────────────────────────────────────

db.prepare("DELETE FROM knowledge_links WHERE entry_id = ?").run(MEETING_ID);
db.prepare("DELETE FROM action_items WHERE entry_id = ?").run(MEETING_ID);
db.prepare("DELETE FROM knowledge_entries WHERE id = ?").run(MEETING_ID);
db.prepare("DELETE FROM agent_insights WHERE tenant_id = ? AND id LIKE 'INS-MTG-%'").run(TENANT_ID);
db.prepare("DELETE FROM knowledge_entities WHERE tenant_id = ? AND id LIKE 'ent-mtg-%'").run(TENANT_ID);
// Clear approval items from this meeting (by title pattern)
db.prepare("DELETE FROM approval_items WHERE tenant_id = ? AND title LIKE '%K-1%' OR title LIKE '%March Forecast%' OR title LIKE '%Hanwha Solar KMZ%'").run(TENANT_ID);

console.log('✓ Previous data cleared');

// ─── 1. Knowledge Entry ─────────────────────────────────────────────────────

const transcript = `SANGHA LEADERSHIP SYNC — MARCH 7, 2026
Participants: Spencer Marr, Colin Peirce, Mihir Bhangley, Kishan Sutariya, Ken Kramer

═══ AGENDA ═══

1. HANWHA LAND EXPANSION
Spencer reviewed the Hanwha land deal status. We're targeting 50 acres total including existing parcels. Hanwha sent over KMZ files yesterday — need Kishan to run the site analysis before Monday. The April 1 option expiry is the hard deadline. Marathon Capital is backing our powered land strategy, positioning Oberon for AI developer customers willing to pay premium for powered land.

2. FUNDRAISE UPDATE
Current commitments at $250K of $4M target. Spencer heading to Minneapolis next week for investor meetings. Colin needs to send the cap table update email to all investors before those meetings. Tax filing extensions are in place — Mihir sending K-1 notification emails to investors by March 11. Target mid-May for full K-1 distribution.

3. FORECAST REVIEW
March numbers coming in below expectations. Ambient heat causing significant ASIC downtime — machines forced to downclock for longer periods. Mihir and Kishan need to reconcile forecast vs actuals before next week. Revenue impact is material — need revised projections before Minneapolis meetings.

4. ENERGY BILLING
South Dakota site has a billing discrepancy with the utility. Ken found a gap in the 2022 AEP payment records. Mihir to investigate and resolve before it compounds. Metering problems are limiting real-time billing accuracy — Jason Gunderson and Marcel working on fixes.

5. FUSION ENERGY / AURADYNE
Fusion Energy deal still stuck in legal review — no response to last 2 follow-up emails from Spencer. This blocks the hard money loan process. Spencer scheduling a strategy call with Colin to discuss alternatives.

Auradyne reduced ASIC pricing from $5,500 to $4,500 per unit. Connor handling delivery timeline — Spencer to call him Monday for update. 245 units at new price = ~$2M. Excalibur loan terms: 9 years, 8.5%, ~$39K/month.

6. ASIC FLEET STATUS
3 ASICs at the South Dakota site are running above thermal threshold. Monitoring agent flagged them — need physical inspection. Bit Deer S21 pricing dropped 12% on secondary market — potential fleet expansion opportunity if we can secure additional power allocation.

═══ KEY NUMBERS ═══

Fundraise target: $4,000,000
Current commitments: $250,000
ASIC unit price (Auradyne): $4,500 (was $5,500)
ASIC purchase quantity: 245 units
Total equipment cost: ~$2,000,000
Excalibur loan: 9 years, ~8.5%, ~$39,000/month
Cap table adjustment: ~$350,000
K-1 distribution target: mid-May 2026`;

const summary = `Leadership sync covering Hanwha KMZ files for 50-acre expansion (Kishan to analyze), fundraise status ($250K of $4M committed — Minneapolis meetings next week), March forecast review (heat-related ASIC downtime impacting revenue), South Dakota energy billing discrepancy, Fusion Energy deal stalled (no response to 2 emails), Auradyne ASIC price reduction ($5,500 → $4,500), and investor K-1 notification timeline.`;

db.prepare(`INSERT OR REPLACE INTO knowledge_entries (id, tenant_id, type, title, summary, content, source, source_agent, recorded_at, created_at, processed)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)`).run(
  MEETING_ID, TENANT_ID, 'meeting',
  'Sangha Leadership Sync — March 7, 2026',
  summary,
  transcript,
  'meeting_bot',
  'meeting_bot',
  '2026-03-07T14:00:00Z'
);
console.log('✓ Knowledge entry inserted');

// ─── 2. Action Items (10) ───────────────────────────────────────────────────

const actionItems = [
  { id: 'ACT-MTG-001', assignee: 'Spencer', title: 'Send Hanwha KMZ files to Kishan for site analysis', due: '2026-03-10' },
  { id: 'ACT-MTG-002', assignee: 'Spencer', title: 'Schedule Fusion Energy strategy call with Colin', due: '2026-03-11' },
  { id: 'ACT-MTG-003', assignee: 'Spencer', title: 'Call Connor re: Auradyne delivery timeline', due: '2026-03-10' },
  { id: 'ACT-MTG-004', assignee: 'Spencer', title: 'Prep for Minneapolis investor meetings', due: '2026-03-14' },
  { id: 'ACT-MTG-005', assignee: 'Spencer', title: 'Review March forecast with Mihir', due: '2026-03-12' },
  { id: 'ACT-MTG-006', assignee: 'Mihir', title: 'Send investor tax K-1 notification email', due: '2026-03-11' },
  { id: 'ACT-MTG-007', assignee: 'Mihir', title: 'Reconcile March forecast vs actuals', due: '2026-03-14' },
  { id: 'ACT-MTG-008', assignee: 'Mihir', title: 'Resolve South Dakota energy billing discrepancy', due: '2026-03-12' },
  { id: 'ACT-MTG-009', assignee: 'Colin', title: 'Send cap table update email to investors', due: '2026-03-11' },
  { id: 'ACT-MTG-010', assignee: 'Colin', title: 'Update investor financial model with new fund terms', due: '2026-03-14' },
];

const insertAction = db.prepare(`INSERT OR REPLACE INTO action_items (id, tenant_id, entry_id, title, assignee, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', datetime('now'))`);
for (const a of actionItems) {
  insertAction.run(a.id, TENANT_ID, MEETING_ID, a.title, a.assignee, a.due);
}
console.log(`✓ ${actionItems.length} action items inserted`);

// ─── 3. Approval Queue (3) ─────────────────────────────────────────────────

const approvals = [
  {
    agent: 'hivemind', title: 'Investor Tax K-1 Notification — Draft',
    desc: 'Email draft to all investors notifying them of tax filing extension. K-1s targeted for mid-May distribution. Drafted by Mihir.',
    type: 'email_draft',
  },
  {
    agent: 'reporting', title: 'March Forecast Model — Review Required',
    desc: 'Updated financial model with revised hash price scenarios incorporating heat-related downtime. Needs Spencer review before Minneapolis meetings.',
    type: 'document',
  },
  {
    agent: 'hivemind', title: 'Hanwha Solar KMZ Proposal — Ready for Review',
    desc: 'Draft email to Hanwha outlining 50-acre expansion with KMZ attachment. Includes proposed easement consent trade.',
    type: 'document',
  },
];

const insertApproval = db.prepare(`INSERT INTO approval_items (tenant_id, agent_id, title, description, type, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`);
for (const a of approvals) {
  insertApproval.run(TENANT_ID, a.agent, a.title, a.desc, a.type);
}
console.log(`✓ ${approvals.length} approval items inserted`);

// ─── 4. Agent Insights (5) ──────────────────────────────────────────────────

const insights = [
  {
    id: 'INS-MTG-001', agent: 'monitoring', priority: 'high', cat: 'alert',
    title: 'South Dakota site — 3 ASICs above thermal threshold',
    desc: 'Monitoring agent detected 3 machines running above safe thermal limits at the South Dakota facility. Physical inspection recommended before permanent damage occurs.',
    actions: ['View Fleet', 'Dismiss'],
  },
  {
    id: 'INS-MTG-002', agent: 'hivemind', priority: 'medium', cat: 'reminder',
    title: 'Minneapolis LP meetings in 5 days — pitch deck needs update',
    desc: 'Spencer has investor meetings scheduled for March 14. Current pitch deck references old $5,500 ASIC pricing — needs update to reflect $4,500 Auradyne terms.',
    actions: ['View Action Items', 'Dismiss'],
  },
  {
    id: 'INS-MTG-003', agent: 'hivemind', priority: 'high', cat: 'follow_up',
    title: 'Fusion Energy — no response to last 2 emails',
    desc: 'Spencer sent follow-up emails on Feb 28 and Mar 4. No response from Fusion Energy legal team. Deal closure is prerequisite for hard money loan process.',
    actions: ['Draft Follow-up', 'Dismiss'],
  },
  {
    id: 'INS-MTG-004', agent: 'pool', priority: 'medium', cat: 'insight',
    title: 'Bit Deer S21 pricing dropped 12% — fleet expansion opportunity',
    desc: 'Secondary market S21 units now available at $1,320/unit (was $1,500). At current hash price, ROI timeline is ~14 months. Requires additional power allocation at South Dakota.',
    actions: ['View Analysis', 'Dismiss'],
  },
  {
    id: 'INS-MTG-005', agent: 'hivemind', priority: 'high', cat: 'reminder',
    title: 'K-1 investor notifications due by March 15 — 6 days left',
    desc: 'Tax filing extensions have been filed but investor notification emails have not been sent. Mihir has action item to send by March 11. Approval queue has draft ready for review.',
    actions: ['View Draft', 'Dismiss'],
  },
];

const insertInsight = db.prepare(`INSERT OR REPLACE INTO agent_insights (id, tenant_id, agent_id, type, category, title, description, priority, actions_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`);
for (const ins of insights) {
  insertInsight.run(ins.id, TENANT_ID, ins.agent, ins.cat, ins.cat, ins.title, ins.desc, ins.priority, JSON.stringify(ins.actions));
}
console.log(`✓ ${insights.length} agent insights inserted`);

// ─── 5. Entity Profiles (14) ────────────────────────────────────────────────

const entities = [
  // People (6)
  { id: 'ent-mtg-spencer', type: 'person', name: 'Spencer Marr', meta: { role: 'President', notes: 'Leading Hanwha negotiations, fundraise, Minneapolis investor meetings. Primary decision maker on Fusion and Auradyne deals.' } },
  { id: 'ent-mtg-colin', type: 'person', name: 'Colin Peirce', meta: { role: 'Fundraising & Finance', notes: 'Cap table updates, investor model revisions. Coordinating Minneapolis meetings with Spencer.' } },
  { id: 'ent-mtg-mihir', type: 'person', name: 'Mihir Bhangley', meta: { role: 'Co-founder / Finance', notes: 'K-1 notifications, forecast reconciliation, South Dakota billing discrepancy investigation.' } },
  { id: 'ent-mtg-kishan', type: 'person', name: 'Kishan Sutariya', meta: { role: 'Operations / Site Analysis', notes: 'Receiving KMZ files from Spencer for Hanwha site analysis. Joint forecast reconciliation with Mihir.' } },
  { id: 'ent-mtg-ken', type: 'person', name: 'Ken Kramer', meta: { role: 'Finance', notes: 'Found gap in 2022 AEP payment records. Working with Mihir on South Dakota billing.' } },
  { id: 'ent-mtg-connor', type: 'person', name: 'Connor', meta: { role: 'Loan Negotiations', notes: 'Handling Auradyne delivery timeline. Leading Excalibur/USDA approval process.' } },
  // Companies (6)
  { id: 'ent-mtg-hanwha', type: 'company', name: 'Hanwha', meta: { notes: 'Sent KMZ files. Negotiating 50-acre expansion at Oberon. April 1 option expiry.' } },
  { id: 'ent-mtg-auradyne', type: 'company', name: 'Auradyne', meta: { notes: 'Reduced ASIC price $5,500 → $4,500. 245 units purchase (~$2M). Connor managing delivery.' } },
  { id: 'ent-mtg-excalibur', type: 'company', name: 'Excalibur', meta: { notes: 'Primary lender. 9-year loan, ~8.5%, ~$39K/month. Pending USDA approval.' } },
  { id: 'ent-mtg-fusion', type: 'company', name: 'Fusion Energy', meta: { notes: 'Deal stuck in legal review. No response to 2 follow-up emails. Blocks hard money loan.' } },
  { id: 'ent-mtg-bitdeer', type: 'company', name: 'Bit Deer', meta: { notes: 'S21 secondary market pricing dropped 12%. Fleet expansion opportunity.' } },
  { id: 'ent-mtg-marathon', type: 'company', name: 'Marathon', meta: { notes: 'Marathon Capital backing the powered land strategy for Oberon.' } },
  // Sites/Projects (2)
  { id: 'ent-mtg-oberon', type: 'project', name: 'Oberon', meta: { notes: 'Primary site. 50-acre expansion via Hanwha. Pivoting to powered land for AI developers.' } },
  { id: 'ent-mtg-sd', type: 'project', name: 'South Dakota Site', meta: { notes: 'Behind-the-meter mining. 3 ASICs above thermal threshold. Energy billing discrepancy with utility.' } },
];

const insertEntity = db.prepare(`INSERT OR REPLACE INTO knowledge_entities (id, tenant_id, entity_type, name, metadata_json) VALUES (?, ?, ?, ?, ?)`);
const insertLink = db.prepare(`INSERT OR REPLACE INTO knowledge_links (id, entry_id, entity_id, relationship) VALUES (?, ?, ?, ?)`);

for (const ent of entities) {
  insertEntity.run(ent.id, TENANT_ID, ent.type, ent.name, JSON.stringify(ent.meta));
  insertLink.run(`link-mtg-${ent.id}`, MEETING_ID, ent.id, 'mentioned_in');
}
console.log(`✓ ${entities.length} entities inserted and linked`);

// Also update existing seed entities if they exist
try {
  db.prepare(`UPDATE knowledge_entities SET metadata_json = ? WHERE id = 'ent-s-p1'`).run(JSON.stringify({ role: 'President', meeting_notes: 'Leading Hanwha land deal, fundraise, Fusion/Auradyne negotiations' }));
  db.prepare(`UPDATE knowledge_entities SET metadata_json = ? WHERE id = 'ent-s-p2'`).run(JSON.stringify({ role: 'Co-founder / Finance', meeting_notes: 'K-1 notifications, forecast reconciliation, SD billing' }));
  db.prepare(`UPDATE knowledge_entities SET metadata_json = ? WHERE id = 'ent-s-pr1'`).run(JSON.stringify({ meeting_notes: '50-acre expansion via Hanwha, powered land pivot' }));
} catch (e) { /* seed entities may not exist */ }

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
