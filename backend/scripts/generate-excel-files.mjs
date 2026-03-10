/**
 * generate-excel-files.mjs
 *
 * Generates all Excel files for both DACP and Sangha tenants and saves them
 * to demo-files/ subdirectories. Also updates the tenant_files table.
 */

import ExcelJS from 'exceljs';
import Database from 'better-sqlite3';
import { mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const DB_PATH = join(ROOT, 'data', 'cache.db');
const DEMO = join(ROOT, 'demo-files');

const db = new Database(DB_PATH);

// Ensure directories
for (const sub of ['leads', 'estimates', 'pricing']) {
  mkdirSync(join(DEMO, sub), { recursive: true });
}

// ─── Colour palette ──────────────────────────────────────────────────────────
const NAVY = { argb: 'FF1E3A5F' };
const WHITE_FONT = { argb: 'FFFFFFFF' };
const ALT_ROW = { argb: 'FFF8F8F6' };
const PRIORITY_BLUE = { argb: 'FFEEF3F9' };
const GREEN_HEADER = { argb: 'FF1A6B3C' };
const PRIORITY_GREEN = { argb: 'FFEEF5EE' };
const BLUE_LINK = { argb: 'FF2255AA' };
const GREEN_TEXT = { argb: 'FF1A6B3C' };

// ─── Helper: style a header row ──────────────────────────────────────────────
function styleHeaderRow(row, bgColor, colCount) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 28;
  for (let c = 1; c <= colCount; c++) {
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: bgColor };
    row.getCell(c).border = {
      bottom: { style: 'thin', color: { argb: 'FF999999' } },
    };
  }
}

// ─── Helper: alternating row fills ───────────────────────────────────────────
function altFill(ws, startRow, endRow, colCount, priorityCol, priorityThreshold, priorityFill) {
  for (let r = startRow; r <= endRow; r++) {
    const row = ws.getRow(r);
    const isPriority = priorityCol && row.getCell(priorityCol).value >= priorityThreshold;
    for (let c = 1; c <= colCount; c++) {
      if (isPriority) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: priorityFill };
      } else if ((r - startRow) % 2 === 1) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: ALT_ROW };
      }
    }
  }
}

// ─── Helper: auto-fit columns ────────────────────────────────────────────────
function autoFit(ws) {
  ws.columns.forEach(col => {
    let maxLen = 10;
    col.eachCell({ includeEmpty: false }, cell => {
      const val = cell.value ? String(cell.value) : '';
      maxLen = Math.max(maxLen, Math.min(val.length + 3, 50));
    });
    col.width = maxLen;
  });
}

// ─── Helper: write footer row ────────────────────────────────────────────────
function addFooterRow(ws, text, colCount) {
  const r = ws.lastRow ? ws.lastRow.number + 2 : 2;
  const row = ws.getRow(r);
  ws.mergeCells(r, 1, r, colCount);
  row.getCell(1).value = text;
  row.getCell(1).font = { italic: true, color: { argb: 'FF888888' }, size: 9 };
  row.getCell(1).alignment = { horizontal: 'center' };
}

// ─── Helper: save workbook and record in DB ──────────────────────────────────
async function saveAndRecord(wb, filePath, tenantId, name, category) {
  await wb.xlsx.writeFile(filePath);
  const size = statSync(filePath).size;
  const id = 'tf-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  db.prepare(`INSERT OR REPLACE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at, created_at)
    VALUES (?, ?, ?, ?, 'xlsx', ?, ?, ?)`).run(id, tenantId, name, category, size, now, now);

  console.log(`  ✓ ${name} — ${(size / 1024).toFixed(1)} KB`);
  return size;
}

// ═════════════════════════════════════════════════════════════════════════════
//  1. DACP_GC_Pipeline_Mar2026.xlsx
// ═════════════════════════════════════════════════════════════════════════════
async function generateDACPPipeline() {
  console.log('\n── DACP GC Pipeline ──');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Coppice';

  // ── Sheet 1: Lead Pipeline ──
  const ws1 = wb.addWorksheet('Lead Pipeline');
  ws1.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

  const leads = db.prepare(`
    SELECT * FROM le_leads WHERE tenant_id = 'dacp-construction-001' ORDER BY priority_score DESC
  `).all();

  // Also pull bid requests to enrich "Project" and "Bid Date"
  const bidReqs = db.prepare(`
    SELECT * FROM dacp_bid_requests WHERE tenant_id = 'dacp-construction-001'
  `).all();

  // Map GC name to bid request info
  const bidByGC = {};
  bidReqs.forEach(b => {
    if (!bidByGC[b.gc_name] || b.urgency === 'high') bidByGC[b.gc_name] = b;
  });

  const cols1 = ['Priority', 'GC Name', 'Project', 'Location', 'Type', 'Status', 'Bid Date', 'Source'];
  ws1.addRow(cols1);
  styleHeaderRow(ws1.getRow(1), NAVY, cols1.length);

  leads.forEach(l => {
    // Try to match a bid request for project info
    const gcShort = l.venue_name.replace(/ — .*/, '');
    const bid = bidByGC[gcShort] || bidByGC[l.venue_name];
    const project = bid ? bid.subject.replace(/^(RFQ|ITB): /, '').replace(/ — Concrete.*$/, '') : l.trigger_news;
    const bidDate = bid ? bid.due_date : '—';

    ws1.addRow([
      l.priority_score,
      l.venue_name,
      project,
      l.region,
      l.industry,
      l.status.charAt(0).toUpperCase() + l.status.slice(1),
      bidDate,
      l.source,
    ]);
  });

  altFill(ws1, 2, ws1.lastRow.number, cols1.length, 1, 80, PRIORITY_BLUE);
  autoFit(ws1);
  addFooterRow(ws1, 'Generated by Coppice — March 2026', cols1.length);

  // ── Sheet 2: Verified Contacts ──
  const ws2 = wb.addWorksheet('Verified Contacts');
  ws2.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  const contacts = db.prepare(`
    SELECT c.*, l.venue_name FROM le_contacts c
    JOIN le_leads l ON c.lead_id = l.id
    WHERE c.tenant_id = 'dacp-construction-001'
    ORDER BY l.priority_score DESC
  `).all();

  const existingGCs = ['Turner', 'DPR', 'McCarthy', 'Hensel Phelps', 'Skanska', 'Austin Commercial'];

  const cols2 = ['GC Name', 'Contact Name', 'Title', 'Email', 'Phone', 'Verified', 'Relationship'];
  ws2.addRow(cols2);
  styleHeaderRow(ws2.getRow(1), NAVY, cols2.length);

  contacts.forEach(c => {
    const isExisting = existingGCs.some(gc => c.venue_name.toLowerCase().includes(gc.toLowerCase()));
    const row = ws2.addRow([
      c.venue_name,
      c.name,
      c.title,
      c.email,
      c.phone || '—',
      c.mx_valid === 1 ? '✓' : '—',
      isExisting ? 'Existing' : 'New',
    ]);

    // Email styling
    row.getCell(4).font = { color: BLUE_LINK, underline: true };

    // Verified styling
    if (c.mx_valid === 1) {
      row.getCell(6).font = { color: GREEN_TEXT, bold: true };
    }

    // Relationship styling
    if (isExisting) {
      row.getCell(7).font = { color: GREEN_TEXT, bold: true };
    }
  });

  altFill(ws2, 2, ws2.lastRow.number, cols2.length, null, null, null);
  autoFit(ws2);
  addFooterRow(ws2, 'Generated by Coppice — March 2026', cols2.length);

  // ── Sheet 3: Summary ──
  const ws3 = wb.addWorksheet('Summary');

  const totalLeads = leads.length;
  const verifiedContacts = contacts.filter(c => c.mx_valid === 1).length;
  const existingRelCount = contacts.filter(c =>
    existingGCs.some(gc => c.venue_name.toLowerCase().includes(gc.toLowerCase()))
  ).length;
  const avgPriority = (leads.reduce((s, l) => s + l.priority_score, 0) / leads.length).toFixed(1);
  const outreachCount = db.prepare(`SELECT count(*) as cnt FROM le_outreach_log WHERE tenant_id = 'dacp-construction-001'`).get().cnt;

  ws3.mergeCells('A1:D1');
  const titleCell = ws3.getCell('A1');
  titleCell.value = 'DACP Construction — Lead Pipeline Summary';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'left' };

  const stats = [
    ['Total Leads', totalLeads],
    ['Verified Contacts', verifiedContacts],
    ['GCs with Existing Relationship', existingRelCount],
    ['Average Priority Score', parseFloat(avgPriority)],
    ['Outreach Drafts Ready', outreachCount],
  ];

  let row3 = 3;
  stats.forEach(([label, val]) => {
    const r = ws3.getRow(row3);
    r.getCell(1).value = label;
    r.getCell(1).font = { bold: true, size: 11 };
    r.getCell(2).value = val;
    r.getCell(2).font = { size: 11 };
    r.getCell(2).alignment = { horizontal: 'center' };
    row3++;
  });

  ws3.getColumn(1).width = 35;
  ws3.getColumn(2).width = 15;

  addFooterRow(ws3, 'Generated by Coppice — March 2026', 4);

  const filePath = join(DEMO, 'leads', 'DACP_GC_Pipeline_Mar2026.xlsx');
  await saveAndRecord(wb, filePath, 'dacp-construction-001', 'DACP_GC_Pipeline_Mar2026.xlsx', 'Leads');
}

// ═════════════════════════════════════════════════════════════════════════════
//  2. DACP Estimate Files (5 files)
// ═════════════════════════════════════════════════════════════════════════════

function buildEstimateWorkbook(wb, {
  projectName, gcName, contact, bidDue, jobNumber,
  lineItems, subtotal, overheadPct, profitPct, bondPct, mobilization,
  grandTotal, notes, exclusions, isDraft,
}) {
  const ws = wb.addWorksheet('Estimate');

  // ── Company header (rows 1-3) ──
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'DACP CONSTRUCTION LLC';
  ws.getCell('A1').font = { bold: true, size: 16, color: NAVY };

  ws.mergeCells('A2:F2');
  ws.getCell('A2').value = 'Houston, TX';
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF555555' } };

  ws.mergeCells('A3:F3');
  ws.getCell('A3').value = 'estimating@dacpconstruction.com';
  ws.getCell('A3').font = { size: 11, color: BLUE_LINK, underline: true };

  // ── Project info (rows 5-9) ──
  const infoFields = [
    ['Project Name:', projectName],
    ['General Contractor:', gcName],
    ['Contact:', contact],
    ['Bid Due Date:', bidDue],
    ['Job Number:', jobNumber],
  ];
  infoFields.forEach(([label, val], i) => {
    const r = 5 + i;
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = { bold: true, size: 11 };
    ws.mergeCells(`B${r}:F${r}`);
    ws.getCell(`B${r}`).value = val;
    ws.getCell(`B${r}`).font = { size: 11 };
  });

  // ── Line items header (row 11) ──
  const headerRow = 11;
  const cols = ['Item', 'Description', 'Qty', 'Unit', 'Unit Price', 'Total'];
  const hRow = ws.getRow(headerRow);
  cols.forEach((c, i) => {
    hRow.getCell(i + 1).value = c;
  });
  styleHeaderRow(hRow, NAVY, cols.length);

  // ── Line items ──
  let currentRow = headerRow + 1;
  lineItems.forEach((item, idx) => {
    const r = ws.getRow(currentRow);
    r.getCell(1).value = idx + 1;
    r.getCell(2).value = item.description;
    r.getCell(3).value = item.quantity;
    r.getCell(3).numFmt = '#,##0';
    r.getCell(4).value = item.unit;

    if (isDraft && item.unitPrice === null) {
      r.getCell(5).value = 'TBD';
      r.getCell(6).value = 'TBD';
      r.getCell(5).font = { italic: true, color: { argb: 'FF999999' } };
      r.getCell(6).font = { italic: true, color: { argb: 'FF999999' } };
    } else {
      r.getCell(5).value = item.unitPrice;
      r.getCell(5).numFmt = '$#,##0.00';
      r.getCell(6).value = item.extended;
      r.getCell(6).numFmt = '$#,##0.00';
    }

    // Alternating fill
    if (idx % 2 === 1) {
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: ALT_ROW };
      }
    }
    currentRow++;
  });

  // ── Blank separator row ──
  currentRow++;

  // ── Totals section ──
  const totalsData = [];
  if (!isDraft) {
    totalsData.push(['Subtotal', subtotal]);
    totalsData.push([`Overhead (${overheadPct}%)`, subtotal * (overheadPct / 100)]);
    totalsData.push([`Profit (${profitPct}%)`, subtotal * (profitPct / 100)]);
    if (bondPct) totalsData.push([`Bond (${bondPct}%)`, subtotal * (bondPct / 100)]);
    if (mobilization) totalsData.push(['Mobilization', mobilization]);
    totalsData.push(['GRAND TOTAL', grandTotal]);
  }

  totalsData.forEach(([label, val], idx) => {
    const r = ws.getRow(currentRow);
    ws.mergeCells(currentRow, 1, currentRow, 4);
    r.getCell(1).value = label;
    r.getCell(1).font = { bold: true, size: 11 };
    r.getCell(1).alignment = { horizontal: 'right' };
    ws.mergeCells(currentRow, 5, currentRow, 6);
    r.getCell(5).value = val;
    r.getCell(5).numFmt = '$#,##0.00';
    r.getCell(5).font = { bold: true, size: 11 };
    r.getCell(5).alignment = { horizontal: 'right' };

    // Grand total styling
    if (idx === totalsData.length - 1) {
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: NAVY };
        r.getCell(c).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      }
      // Re-set alignment after fill
      r.getCell(1).alignment = { horizontal: 'right' };
      r.getCell(5).alignment = { horizontal: 'right' };
      r.getCell(5).numFmt = '$#,##0.00';
    }

    currentRow++;
  });

  // ── Notes / Exclusions ──
  currentRow += 2;
  if (notes) {
    ws.mergeCells(currentRow, 1, currentRow, 6);
    ws.getCell(`A${currentRow}`).value = 'Notes:';
    ws.getCell(`A${currentRow}`).font = { bold: true, size: 11 };
    currentRow++;
    ws.mergeCells(currentRow, 1, currentRow, 6);
    ws.getCell(`A${currentRow}`).value = notes;
    ws.getCell(`A${currentRow}`).font = { size: 10, color: { argb: 'FF555555' } };
    ws.getCell(`A${currentRow}`).alignment = { wrapText: true };
    currentRow++;
  }

  if (exclusions) {
    currentRow++;
    ws.mergeCells(currentRow, 1, currentRow, 6);
    ws.getCell(`A${currentRow}`).value = 'Exclusions:';
    ws.getCell(`A${currentRow}`).font = { bold: true, size: 11 };
    currentRow++;
    exclusions.forEach(ex => {
      ws.mergeCells(currentRow, 1, currentRow, 6);
      ws.getCell(`A${currentRow}`).value = `• ${ex}`;
      ws.getCell(`A${currentRow}`).font = { size: 10, color: { argb: 'FF555555' } };
      currentRow++;
    });
  }

  // ── Footer ──
  currentRow += 2;
  ws.mergeCells(currentRow, 1, currentRow, 6);
  ws.getCell(`A${currentRow}`).value = 'Prepared by DACP Construction — Powered by Coppice';
  ws.getCell(`A${currentRow}`).font = { italic: true, color: { argb: 'FF888888' }, size: 9 };
  ws.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };

  // Column widths
  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 40;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 8;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 16;
}

async function generateDACPEstimates() {
  console.log('\n── DACP Estimates ──');

  const estimates = db.prepare(`
    SELECT e.*, b.from_name, b.from_email, b.due_date as bid_due
    FROM dacp_estimates e
    LEFT JOIN dacp_bid_requests b ON e.bid_request_id = b.id
    WHERE e.tenant_id = 'dacp-construction-001'
  `).all();

  const fileMap = {
    'EST-001': 'DACP_Estimate_BishopArts_MixedUse.xlsx',
    'EST-002': 'DACP_Estimate_I35_RetainingWalls.xlsx',
    'EST-003': 'DACP_Estimate_MemorialHermann_Ph2.xlsx',
  };

  const defaultExclusions = [
    'Site clearing, grading, and compaction by others',
    'Underground utilities and plumbing rough-in',
    'Structural steel and miscellaneous metals',
    'Permits, engineering, and survey',
    'Winter protection / cold weather concrete',
  ];

  // Generate from DB estimates
  for (const est of estimates) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Coppice';
    const lineItems = JSON.parse(est.line_items_json);
    const subtotal = est.subtotal;
    const overheadPct = est.overhead_pct;
    const profitPct = est.profit_pct;

    // Estimate bond at 1.5% from grand total back-calculation
    // grandTotal ≈ subtotal * (1 + overhead + profit + bond) + mobilization
    // We'll compute bond to match the stored total
    const computedBeforeBond = subtotal * (1 + overheadPct / 100 + profitPct / 100) + (est.mobilization || 0);
    const bondAmount = est.total_bid - computedBeforeBond;
    const bondPct = bondAmount > 0 ? parseFloat(((bondAmount / subtotal) * 100).toFixed(1)) : 0;

    let contactStr = est.from_name || '—';
    if (est.from_email) contactStr += ` (${est.from_email})`;

    buildEstimateWorkbook(wb, {
      projectName: est.project_name,
      gcName: est.gc_name,
      contact: contactStr,
      bidDue: est.bid_due || '—',
      jobNumber: est.id,
      lineItems: lineItems.map(li => ({
        description: li.description,
        quantity: li.quantity,
        unit: li.unit,
        unitPrice: li.unitPrice,
        extended: li.extended,
      })),
      subtotal,
      overheadPct,
      profitPct,
      bondPct: bondPct > 0 ? bondPct : 1.5,
      mobilization: est.mobilization || 0,
      grandTotal: est.total_bid,
      notes: est.notes,
      exclusions: defaultExclusions,
      isDraft: false,
    });

    const fileName = fileMap[est.id];
    const filePath = join(DEMO, 'estimates', fileName);
    await saveAndRecord(wb, filePath, 'dacp-construction-001', fileName, 'Estimates');
  }

  // ── Samsung Fab (created from scratch) ──
  {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Coppice';
    const samsungItems = [
      { description: '4" SOG — 15,000 SF', quantity: 15000, unit: 'SF', unitPrice: 5.50, extended: 82500 },
      { description: 'Grade Beam — 600 LF', quantity: 600, unit: 'LF', unitPrice: 45, extended: 27000 },
      { description: 'Rebar #5 — 22,000 LB', quantity: 22000, unit: 'LB', unitPrice: 0.75, extended: 16500 },
      { description: 'Mobilization', quantity: 1, unit: 'LS', unitPrice: 4200, extended: 4200 },
    ];
    const subtotal = 130200;
    const overheadPct = 10;
    const profitPct = 12;
    const bondPct = 1.5;
    const grandTotal = subtotal * (1 + overheadPct / 100 + profitPct / 100 + bondPct / 100);

    buildEstimateWorkbook(wb, {
      projectName: 'Samsung Semiconductor Fab — Taylor, TX',
      gcName: 'Samsung C&T',
      contact: 'Procurement Team',
      bidDue: '2026-04-05',
      jobNumber: 'EST-004',
      lineItems: samsungItems,
      subtotal,
      overheadPct,
      profitPct,
      bondPct,
      mobilization: 0,
      grandTotal: Math.round(grandTotal),
      notes: 'Revised pricing per RFI-07 — adjusted grade beam quantities. SOG scope reduced from 20,000 SF to 15,000 SF.',
      exclusions: [
        'Clean room concrete (specialty mix by others)',
        'Vibration-isolated foundations',
        'Site clearing and mass grading',
        'Structural steel and miscellaneous metals',
        'Permits and engineering',
      ],
      isDraft: false,
    });

    const fileName = 'DACP_Estimate_SamsungFab_Revised.xlsx';
    const filePath = join(DEMO, 'estimates', fileName);
    await saveAndRecord(wb, filePath, 'dacp-construction-001', fileName, 'Estimates');
  }

  // ── McKinney TC Draft ──
  {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Coppice';
    const draftItems = [
      { description: 'SOG (4" or 6" — spec pending)', quantity: null, unit: 'SF', unitPrice: null, extended: null },
      { description: 'Curb & Gutter (standard 6"x18")', quantity: null, unit: 'LF', unitPrice: null, extended: null },
      { description: 'Sidewalk (4")', quantity: null, unit: 'SF', unitPrice: null, extended: null },
      { description: 'Drilled Piers (24" dia)', quantity: null, unit: 'LF', unitPrice: null, extended: null },
    ];

    buildEstimateWorkbook(wb, {
      projectName: 'McKinney Town Center — Full Concrete Package',
      gcName: 'Austin Commercial',
      contact: 'estimating@austincommercial.com',
      bidDue: '2026-03-25',
      jobNumber: 'EST-005 (DRAFT)',
      lineItems: draftItems,
      subtotal: 0,
      overheadPct: 0,
      profitPct: 0,
      bondPct: 0,
      mobilization: 0,
      grandTotal: 0,
      notes: 'DRAFT — Quantities still being parsed from 48-page specification document. Estimated ranges:\n  • SOG: 20,000–35,000 SF ($5.50–$6.90/SF)\n  • Curb: 3,000–4,500 LF ($18/LF)\n  • Sidewalk: 5,000–8,000 SF ($5.75/SF)\n  • Piers: 800–1,200 LF ($85/LF)',
      exclusions: [
        'TBD — pending full scope review',
      ],
      isDraft: true,
    });

    const fileName = 'DACP_Estimate_McKinneyTC_Draft.xlsx';
    const filePath = join(DEMO, 'estimates', fileName);
    await saveAndRecord(wb, filePath, 'dacp-construction-001', fileName, 'Estimates');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  3. DACP_MasterPricingTable_2026.xlsx
// ═════════════════════════════════════════════════════════════════════════════
async function generateDACPPricing() {
  console.log('\n── DACP Master Pricing Table ──');

  // Realistic Houston-area rates to override the stored unit_price
  const rateOverrides = {
    'FW-001': 5.50,  // 4" SOG
    'FW-002': 6.90,  // 6" SOG
    'FW-003': 8.75,  // 8" SOG
    'FW-004': 4.25,  // Topping
    'FN-001': 32.00, // Strip Footing
    'FN-002': 850.00,// Spread Footing
    'FN-003': 45.00, // Grade Beam
    'FN-004': 85.00, // Pier
    'CG-001': 18.00, // Standard Curb
    'CG-002': 14.00, // Roll Curb
    'CG-003': 5.75,  // Sidewalk
    'WL-001': 22.00, // Retaining CMU
    'WL-002': 35.00, // CIP 8"
    'WL-003': 42.00, // CIP 12"
    'ST-001': 28.00, // Elevated Deck
    'ST-002': 125.00,// Column
    'ST-003': 95.00, // Beam
    'ST-004': 6500.00, // Stair
    'DC-001': 12.00, // Stamped
    'DC-002': 10.50, // Exposed Aggregate
    'DC-003': 8.00,  // Polished
    'DM-001': 3.25,  // 4" Removal
    'DM-002': 4.75,  // 6"+ Removal
    'DM-003': 18.00, // Selective Demo
    'RB-001': 0.65,  // #4 Rebar
    'RB-002': 0.75,  // #5 Rebar
    'RB-003': 1.10,  // WWF
    'AC-001': 0.45,  // Vapor Barrier
    'AC-002': 3.50,  // Expansion Joint
    'AC-003': 0.35,  // Curing
    'AC-004': 15.00, // Form Curb
  };

  const pricing = db.prepare(`
    SELECT * FROM dacp_pricing WHERE tenant_id = 'dacp-construction-001'
    ORDER BY category, item
  `).all();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Coppice';
  const ws = wb.addWorksheet('Master Pricing');
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  const cols = ['Item', 'Description', 'Unit', 'Rate', 'Last Updated', 'Source'];
  const colWidths = [30, 45, 8, 14, 16, 25];

  ws.addRow(cols);
  styleHeaderRow(ws.getRow(1), NAVY, cols.length);
  cols.forEach((_, i) => { ws.getColumn(i + 1).width = colWidths[i]; });

  // Group by category
  const categories = {};
  pricing.forEach(p => {
    if (!categories[p.category]) categories[p.category] = [];
    categories[p.category].push(p);
  });

  const catColors = {
    'Flatwork': 'FFE8EDF3',
    'Foundations': 'FFEEF0E5',
    'Curb & Gutter': 'FFEBE8E3',
    'Walls': 'FFE3EBE8',
    'Structural': 'FFE8E3EB',
    'Decorative': 'FFF0EDE5',
    'Demolition': 'FFEBE3E3',
    'Rebar': 'FFE5E8F0',
    'Accessories': 'FFE8F0E5',
  };

  const catOrder = ['Flatwork', 'Foundations', 'Curb & Gutter', 'Walls', 'Structural', 'Decorative', 'Demolition', 'Rebar', 'Accessories'];

  let rowIdx = 0;
  for (const cat of catOrder) {
    const items = categories[cat];
    if (!items) continue;

    // Category header row (merged)
    const catRow = ws.addRow([cat, '', '', '', '', '']);
    ws.mergeCells(catRow.number, 1, catRow.number, cols.length);
    catRow.getCell(1).font = { bold: true, size: 11, color: NAVY };
    catRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: catColors[cat] || 'FFF0F0F0' } };
    catRow.height = 22;

    items.forEach((p, idx) => {
      const rate = rateOverrides[p.id] !== undefined ? rateOverrides[p.id] : p.unit_price;
      const r = ws.addRow([
        p.item,
        p.notes || '—',
        p.unit,
        rate,
        'Mar 2026',
        'DACP Historical + TXI',
      ]);
      r.getCell(4).numFmt = '$#,##0.00';

      if (idx % 2 === 1) {
        for (let c = 1; c <= cols.length; c++) {
          r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: ALT_ROW };
        }
      }
      rowIdx++;
    });
  }

  addFooterRow(ws, 'Prices as of March 2026 — TXI ready-mix updated Mar 1', cols.length);

  const filePath = join(DEMO, 'pricing', 'DACP_MasterPricingTable_2026.xlsx');
  await saveAndRecord(wb, filePath, 'dacp-construction-001', 'DACP_MasterPricingTable_2026.xlsx', 'Pricing');
}

// ═════════════════════════════════════════════════════════════════════════════
//  4. Sangha_Lead_Pipeline_Mar2026.xlsx
// ═════════════════════════════════════════════════════════════════════════════
async function generateSanghaPipeline() {
  console.log('\n── Sangha Lead Pipeline ──');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Coppice';

  // ── Sheet 1: IPP & Partner Leads ──
  const ws1 = wb.addWorksheet('IPP & Partner Leads');
  ws1.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

  const leads = db.prepare(`
    SELECT * FROM le_leads WHERE tenant_id = 'default' ORDER BY priority_score DESC
  `).all();

  const cols1 = ['Priority', 'Company', 'Type', 'Region', 'Capacity (MW)', 'Status', 'Trigger', 'Website'];
  ws1.addRow(cols1);
  styleHeaderRow(ws1.getRow(1), GREEN_HEADER, cols1.length);

  leads.forEach(l => {
    // Extract capacity from notes
    let capacity = '—';
    if (l.notes) {
      const m = l.notes.match(/Capacity:\s*([\d,]+)\s*MW/);
      if (m) capacity = parseInt(m[1].replace(/,/g, ''));
    }

    ws1.addRow([
      l.priority_score,
      l.venue_name,
      l.industry,
      l.region,
      capacity,
      l.status.charAt(0).toUpperCase() + l.status.slice(1),
      (l.trigger_news || '').slice(0, 80) + ((l.trigger_news || '').length > 80 ? '...' : ''),
      l.website || '—',
    ]);
  });

  altFill(ws1, 2, ws1.lastRow.number, cols1.length, 1, 80, PRIORITY_GREEN);
  autoFit(ws1);
  // Override some column widths for better readability
  ws1.getColumn(7).width = 50; // Trigger
  ws1.getColumn(2).width = 30; // Company
  addFooterRow(ws1, 'Generated by Coppice — March 2026', cols1.length);

  // ── Sheet 2: Decision Makers ──
  const ws2 = wb.addWorksheet('Decision Makers');
  ws2.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  const contacts = db.prepare(`
    SELECT c.*, l.venue_name FROM le_contacts c
    JOIN le_leads l ON c.lead_id = l.id
    WHERE c.tenant_id = 'default'
    ORDER BY l.priority_score DESC
  `).all();

  const cols2 = ['Company', 'Name', 'Title', 'Email', 'Phone', 'Verified', 'Source'];
  ws2.addRow(cols2);
  styleHeaderRow(ws2.getRow(1), GREEN_HEADER, cols2.length);

  contacts.forEach((c, idx) => {
    const row = ws2.addRow([
      c.venue_name,
      c.name,
      c.title,
      c.email,
      c.phone || '—',
      c.mx_valid === 1 ? '✓' : '—',
      c.source || '—',
    ]);

    row.getCell(4).font = { color: BLUE_LINK, underline: true };
    if (c.mx_valid === 1) {
      row.getCell(6).font = { color: GREEN_TEXT, bold: true };
    }

    if (idx % 2 === 1) {
      for (let ci = 1; ci <= cols2.length; ci++) {
        row.getCell(ci).fill = { type: 'pattern', pattern: 'solid', fgColor: ALT_ROW };
      }
    }
  });

  autoFit(ws2);
  addFooterRow(ws2, 'Generated by Coppice — March 2026', cols2.length);

  // ── Sheet 3: Outreach Drafts ──
  const ws3 = wb.addWorksheet('Outreach Drafts');

  const outreach = db.prepare(`
    SELECT o.*, l.venue_name, c.name as contact_name
    FROM le_outreach_log o
    LEFT JOIN le_leads l ON o.lead_id = l.id
    LEFT JOIN le_contacts c ON o.contact_id = c.id
    WHERE o.tenant_id = 'default'
    ORDER BY o.created_at DESC
  `).all();

  const cols3 = ['Company', 'Contact', 'Subject', 'Body', 'Status'];
  ws3.addRow(cols3);
  styleHeaderRow(ws3.getRow(1), GREEN_HEADER, cols3.length);

  outreach.forEach((o, idx) => {
    const row = ws3.addRow([
      o.venue_name || '—',
      o.contact_name || '—',
      o.subject,
      (o.body || '').slice(0, 200) + ((o.body || '').length > 200 ? '...' : ''),
      o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : '—',
    ]);

    row.getCell(4).alignment = { wrapText: true };

    if (idx % 2 === 1) {
      for (let ci = 1; ci <= cols3.length; ci++) {
        row.getCell(ci).fill = { type: 'pattern', pattern: 'solid', fgColor: ALT_ROW };
      }
    }
  });

  ws3.getColumn(1).width = 25;
  ws3.getColumn(2).width = 20;
  ws3.getColumn(3).width = 45;
  ws3.getColumn(4).width = 70;
  ws3.getColumn(5).width = 12;
  addFooterRow(ws3, 'Generated by Coppice — March 2026', cols3.length);

  // ── Sheet 4: Pipeline Summary ──
  const ws4 = wb.addWorksheet('Pipeline Summary');

  ws4.mergeCells('A1:E1');
  ws4.getCell('A1').value = 'Sangha Renewables — Partner Pipeline Summary';
  ws4.getCell('A1').font = { bold: true, size: 14 };

  let r = 3;

  // Stats
  const totalLeads = leads.length;
  const verifiedContacts = contacts.filter(c => c.mx_valid === 1).length;

  const statsData = [
    ['Total Leads', totalLeads],
    ['Verified Contacts', verifiedContacts],
  ];
  statsData.forEach(([label, val]) => {
    const row = ws4.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, size: 11 };
    row.getCell(2).value = val;
    row.getCell(2).font = { size: 11 };
    r++;
  });

  // Leads by Type
  r += 1;
  ws4.getRow(r).getCell(1).value = 'Leads by Type';
  ws4.getRow(r).getCell(1).font = { bold: true, size: 12 };
  r++;

  const typeHeaders = ws4.getRow(r);
  typeHeaders.getCell(1).value = 'Type';
  typeHeaders.getCell(2).value = 'Count';
  styleHeaderRow(typeHeaders, GREEN_HEADER, 2);
  r++;

  const byType = db.prepare(`
    SELECT industry, count(*) as cnt FROM le_leads WHERE tenant_id = 'default'
    GROUP BY industry ORDER BY cnt DESC
  `).all();

  byType.forEach((t, idx) => {
    const row = ws4.getRow(r);
    row.getCell(1).value = t.industry;
    row.getCell(2).value = t.cnt;
    if (idx % 2 === 1) {
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: ALT_ROW };
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: ALT_ROW };
    }
    r++;
  });

  // Top 5 Priority Leads
  r += 1;
  ws4.getRow(r).getCell(1).value = 'Top 5 Priority Leads';
  ws4.getRow(r).getCell(1).font = { bold: true, size: 12 };
  r++;

  const topHeaders = ws4.getRow(r);
  topHeaders.getCell(1).value = 'Company';
  topHeaders.getCell(2).value = 'Type';
  topHeaders.getCell(3).value = 'Priority';
  styleHeaderRow(topHeaders, GREEN_HEADER, 3);
  r++;

  leads.slice(0, 5).forEach((l, idx) => {
    const row = ws4.getRow(r);
    row.getCell(1).value = l.venue_name;
    row.getCell(2).value = l.industry;
    row.getCell(3).value = l.priority_score;
    if (idx % 2 === 1) {
      for (let c = 1; c <= 3; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: ALT_ROW };
      }
    }
    r++;
  });

  // Outreach Status
  r += 1;
  ws4.getRow(r).getCell(1).value = 'Outreach Status';
  ws4.getRow(r).getCell(1).font = { bold: true, size: 12 };
  r++;

  const draftCount = outreach.filter(o => o.status === 'draft').length;
  const sentCount = outreach.filter(o => o.status === 'sent').length;
  const respondedCount = outreach.filter(o => o.responded_at).length;

  const outreachStats = [
    ['Drafts', draftCount],
    ['Sent', sentCount],
    ['Responded', respondedCount],
  ];
  outreachStats.forEach(([label, val]) => {
    const row = ws4.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = val;
    r++;
  });

  ws4.getColumn(1).width = 35;
  ws4.getColumn(2).width = 18;
  ws4.getColumn(3).width = 12;

  addFooterRow(ws4, 'Generated by Coppice — March 2026', 5);

  const filePath = join(DEMO, 'leads', 'Sangha_Lead_Pipeline_Mar2026.xlsx');
  await saveAndRecord(wb, filePath, 'default', 'Sangha_Lead_Pipeline_Mar2026.xlsx', 'Leads');
}

// ═════════════════════════════════════════════════════════════════════════════
//  Main
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('Generating all Excel files...');

  await generateDACPPipeline();
  await generateDACPEstimates();
  await generateDACPPricing();
  await generateSanghaPipeline();

  // Print summary
  console.log('\n══════════════════════════════════════════════');
  console.log('  tenant_files table entries:');
  const files = db.prepare(`SELECT * FROM tenant_files ORDER BY tenant_id, category, name`).all();
  files.forEach(f => {
    console.log(`  [${f.tenant_id}] ${f.category} / ${f.name} — ${(f.size_bytes / 1024).toFixed(1)} KB`);
  });
  console.log('══════════════════════════════════════════════');
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
