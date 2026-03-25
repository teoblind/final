/**
 * Seed the Cruz Shintech spreadsheet into DACP's file system + knowledge base
 * so Marcel sees it in Files immediately and the agent can reference the pricing data.
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data', 'app.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const TENANT_ID = 'dacp-construction-001';
const FILE_ID = `file-cruz-${randomUUID().slice(0, 8)}`;
const KNOWLEDGE_ID = `KN-${Date.now()}-${randomUUID().slice(0, 6)}`;
const DSF_ID = `dsf-cruz-${randomUUID().slice(0, 8)}`;

const FILE_NAME = 'CRUZ slabShintechrev 1.xlsx';
const NOW = new Date().toISOString();

// Extracted pricing data as searchable text content
const CONTENT_TEXT = `CRUZ CONSTRUCTION — Shintech Warehouse #3 Estimate
Project: Shintech Warehouse #3, Plaquemine, LA (Iberville Parish)
Date: March 12, 2026
Estimator: Cruz Construction

=== SHEET 1: SLAB CONCRETE ===
Scope: 29,250 SF warehouse concrete slab with footings, chain walls, pedestals

LINE ITEMS WITH UNIT PRICING:
- Layout corners: 4 EA — $25/ea material, $200/ea labor = $900
- Layout column lines: 38 EA — $10/ea material, $100/ea labor = $4,180
- Excavate F1 continuous footing (9' bottom, 11' top x 3.75' deep, 710 LF): 986 CY — $20/CY labor, $10/CY S/E = $29,583
- 2" dry bottom: 38 CY — $129/CY material, $100/CY labor, $25/CY S/E = $9,618
- Form sides (1.16 deep): 1,647 SF — $3.50/SF material, $7.50/SF labor = $18,119
- Rebar supports: $0.55/EA
- Pour footing F1 (710x6x1.12): 192 CY — $140/CY concrete, $50/CY labor, $10/CY S/E = $38,400
- Strip/haul forms: 1,647 SF — $1.50/SF labor, $0.25/SF S/E = $2,882
- Form chain wall (2.33h, 2 sides): 3,648 SF — $4.25/SF material, $10/SF labor = $51,984
- Form pedestals in slab area: 280 SF — $4.50/SF material, $15/SF labor = $5,452
- Set anchor bolts: 180 EA — $5/ea material, $20/ea labor, $1.50/ea S/E = $4,770
- Pour wall & pedestals: 76 CY — $140/CY concrete, $80/CY labor, $15/CY S/E = $17,860
- Strip/haul forms: 3,648 SF — $2/SF labor, $0.25/SF S/E = $8,208
- Backfill good sand & compact: 680 CY — $10/CY labor, $10/CY S/E = $13,605
- Form slab edge w/ notch: 355 SF — $4/SF material, $10/SF labor = $4,970
- Fine grade: 29,250 SF — $0.20/SF labor, $0.02/SF S/E = $6,435
- 10 mil vapor barrier: 36,000 SF — $0.40/SF material, $0.10/SF labor = $18,000
- Construction joint: 130 LF — $2.50/LF material, $7.50/LF labor = $1,300
- Pour slab (2 pours): 569 CY — $140/CY concrete, $35/CY labor = $99,531
- Pump (2 pours): 569 CY — $7/CY S/E = $3,983
- Finish slab: 29,250 SF — $1.50/SF labor, $0.25/SF S/E = $51,188
- Cure: 29,250 SF — $0.05/SF material, $0.02/SF labor = $2,048
- Strip edge forms: 355 LF — $1/LF labor = $355
- Sawcut control joints: 4,000 LF — $1.85/LF S/E = $7,400
- Joint sealants: 4,000 LF — $1.25/LF S/E = $5,000

F2 Footings & Pedestals (4 each):
- Excavate: 72 CY — $25/CY labor, $10/CY S/E = $2,520
- Dry bottom: 3 CY — $129/CY material, $100/CY labor = $762
- Form sides: 180 SF — $3.50/SF material, $7.50/SF labor = $1,980
- Pour: 12 CY — $140/CY concrete, $50/CY labor, $10/CY S/E = $2,400
- Form pedestal: 80 SF — $4.50/SF material, $15/SF labor = $1,560
- Set anchor bolts: 16 EA — $5/ea material, $20/ea labor = $400

F3 Footings & Pedestals (2 each):
- Similar pricing to F2

ALL REBAR (slab + footings): 37.5 tons — $1,500/ton material, $850/ton labor = $88,125

SLAB CONCRETE SUBTOTAL: $620,048
Tax/Insurance: $106,566
With 15% OH&P: $713,055
UNIT RATE: $24.38/SF

=== SHEET 2: PAVING & MISC CONCRETE ===

MISC CONCRETE:
- Set & fill bollards: 28 EA — $25/ea material, $150/ea labor = $4,900
- AC Pad: 86 SF — $5/SF material, $5/SF labor = $860
- Cable tray support: 7 EA — $450/ea material, $650/ea labor, $500/ea S/E = $11,200
- Trench drain gutter: 110 LF — $10/LF material, $25/LF labor = $3,850
- Hand holes for electric: 3 EA — $50/ea material, $100/ea labor = $450
Misc Concrete Total (with 15% OH&P): $30,727

6" PAVING (33,171 SF):
- Field OH: 4 weeks — $200/wk material, $2,000/wk labor, $250/wk S/E = $9,800
- Layout: $1,300 LS
- Dig edge: 27 CY — $40/CY labor = $1,215
- Grade: 33,171 SF — $0.10/SF labor, $0.05/SF S/E = $4,976
- Form edge: 165 SF — $4.50/SF material, $5/SF labor = $1,568
- Butt joint dowels: 950 EA — $2/ea material, $3/ea labor = $4,750
- Rebar: 25.7 tons — $1,500/ton material, $750/ton labor = $57,840
- Expansion joint at bldg (18"): 600 LF — $4.50/LF material, $2/LF labor = $3,900
- 6" EJ with sealants: 600 LF — $2/LF material, $1.50/LF labor = $2,100
- Pour paving: 1,317 CY — $140/CY concrete, $5/CY labor = $190,965
- Pump: 3 EA — $2,500/ea S/E = $7,500
- Finish: 33,171 SF — $0.75/SF labor = $24,878
- Cure: 33,171 SF — $0.05/SF material, $0.02/SF labor = $2,322
- Sawcut joints: 3,100 LF — $1.25/LF S/E = $3,875
- Sealants: 3,100 LF — $1.25/LF S/E = $3,875
6" Paving Total (with 15% OH&P): $427,622

8" ROADWAY (34,248 SF):
- Similar line items to 6" paving
- Form edge: 942 SF — $4.50/SF material, $5/SF labor = $8,949
- Longitudinal joint: 1,100 LF — $4.25/LF material, $1.50/LF labor = $6,325
- Construction/tie joint: 2,200 LF — $1.50/LF material, $1.50/LF labor = $6,600
- Sleeper slab/joint: 90 LF — $25/LF material, $10/LF labor = $3,150
- Pour paving: 1,317 CY — $140/CY concrete, $20/CY labor = $210,720
- Pump: 3 EA — $3,000/ea S/E = $9,000
- Finish: 34,248 SF — $1/SF labor = $34,248
8" Roadway Total (with 15% OH&P): $415,303

=== GRAND TOTALS ===
Slab Concrete: $713,055
Misc Concrete: $30,727
6" Paving: $427,622
8" Roadway: $415,303
ESTIMATED PROJECT TOTAL: ~$1,586,707

=== KEY UNIT RATES (BENCHMARK) ===
Concrete (ready-mix): $140/CY
Rebar (furnished & installed): $1,500/ton material + $750-850/ton labor
Formwork (foundation sides): $3.50/SF material + $7.50/SF labor
Formwork (chain wall): $4.25/SF material + $10/SF labor
Formwork (pedestals): $4.50/SF material + $15/SF labor
Slab finishing: $1.50/SF labor
Slab curing: $0.05/SF material + $0.02/SF labor
Sawcutting: $1.25-1.85/LF
Joint sealants: $1.25/LF
Vapor barrier (10 mil): $0.40/SF material + $0.10/SF labor
Fine grading: $0.20/SF labor
Anchor bolts (set): $5/ea material + $20/ea labor
Excavation (footing): $20-25/CY labor
Backfill & compact: $10/CY labor + $10/CY S/E
Dry bottom (2" crushed stone): $129/CY material + $100/CY labor
Paving finishing: $0.75-1.00/SF labor
Pumping: $2,500-3,000/pump setup
Tax/Insurance markup: ~10%
OH&P: 15%
Slab all-in rate: $24.38/SF (29,250 SF warehouse)`;

// 1. Insert into tenant_files (shows in Files dashboard)
db.prepare(`
  INSERT OR REPLACE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at, drive_file_id, drive_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(FILE_ID, TENANT_ID, FILE_NAME, 'Spreadsheets', 'xlsx', 45056, NOW, null, null);

console.log(`✓ Inserted into tenant_files: ${FILE_ID}`);

// 2. Insert into drive_synced_files (with content for RAG search)
db.prepare(`
  INSERT OR REPLACE INTO drive_synced_files (id, tenant_id, name, mime_type, category, file_type, size_bytes, modified_time, drive_url, parent_folder_name, has_content, content_length, content_text, first_synced_at, last_synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(DSF_ID, TENANT_ID, FILE_NAME, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Spreadsheets', 'xlsx', 45056, NOW, null, 'Competitor Estimates', 1, CONTENT_TEXT.length, CONTENT_TEXT, NOW, NOW);

console.log(`✓ Inserted into drive_synced_files: ${DSF_ID}`);

// 3. Insert FTS entry
try {
  db.prepare(`INSERT INTO drive_synced_files_fts (rowid, name, content_text) VALUES ((SELECT rowid FROM drive_synced_files WHERE id = ?), ?, ?)`).run(DSF_ID, FILE_NAME, CONTENT_TEXT);
  console.log(`✓ Inserted FTS entry`);
} catch (e) {
  console.log(`FTS insert skipped: ${e.message}`);
}

// 4. Insert into knowledge_entries (so agent can reference during chat)
db.prepare(`
  INSERT OR REPLACE INTO knowledge_entries (id, tenant_id, type, title, summary, content, source, source_agent, created_at, processed)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  KNOWLEDGE_ID, TENANT_ID, 'document',
  'Cruz Construction — Shintech Warehouse #3 Estimate (Competitor Pricing)',
  'Full line-item estimate from Cruz Construction for Shintech Warehouse #3 in Plaquemine, LA. 29,250 SF slab ($713K), misc concrete ($31K), 6" paving ($428K), 8" roadway ($415K). Total ~$1.59M. Contains detailed unit rates for concrete ($140/CY), rebar ($1,500/ton + $850/ton labor), formwork ($3.50-4.50/SF), finishing ($1.50/SF), with 15% OH&P markup.',
  CONTENT_TEXT,
  'manual', 'estimating', NOW, 1
);

console.log(`✓ Inserted into knowledge_entries: ${KNOWLEDGE_ID}`);

// 5. Create knowledge entities for Cruz and Shintech
const entities = [
  { name: 'Cruz Construction', type: 'company', meta: { role: 'competitor', specialty: 'concrete & paving', location: 'Louisiana' } },
  { name: 'Shintech', type: 'company', meta: { role: 'end_client', industry: 'petrochemical/manufacturing', location: 'Plaquemine, LA' } },
];

for (const ent of entities) {
  const entId = `ent-${randomUUID().slice(0, 8)}`;
  try {
    db.prepare(`INSERT INTO knowledge_entities (id, tenant_id, entity_type, name, metadata_json) VALUES (?, ?, ?, ?, ?)`).run(
      entId, TENANT_ID, ent.type, ent.name, JSON.stringify(ent.meta)
    );
    // Link to knowledge entry
    db.prepare(`INSERT INTO knowledge_links (id, entry_id, entity_id, relationship) VALUES (?, ?, ?, ?)`).run(
      `link-${randomUUID().slice(0, 8)}`, KNOWLEDGE_ID, entId, 'mentioned'
    );
    console.log(`✓ Created entity: ${ent.name} (${ent.type})`);
  } catch (e) {
    console.log(`Entity ${ent.name} skipped: ${e.message}`);
  }
}

console.log('\n✅ Cruz spreadsheet seeded into DACP file system + knowledge base');
db.close();
