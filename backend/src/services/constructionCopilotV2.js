/**
 * Construction Copilot V2 - Steps 2-4, 6-7 + Contract Redline + Quote Tracker
 *
 * 1. Proposal Generator (Step 7) - Word doc from estimate data
 * 2. Bid Sanity Checker (Step 6) - flag cost outliers, labor stress test
 * 3. Takeoff Template Generator (Step 3-4) - pre-populated Excel takeoff sheet
 * 4. Compliance Form Pre-filler - DBE, Buy America, Non-Collusion from company data
 * 5. Contract Redline Generator - marked-up Word doc from comparison results
 * 6. Supplier Quote Tracker - parse incoming supplier quotes from email
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType,
  Header, Footer, PageNumber, NumberFormat,
} from 'docx';
import ExcelJS from 'exceljs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, '../../data/estimates');
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── DACP Company Data (for compliance forms & proposals) ──────────────────

const DACP_COMPANY = {
  name: 'DACP Construction LLC',
  dba: 'DACP Construction',
  parent: 'DACP Holdings',
  owner: 'Danny Cruz',
  ownerTitle: 'President / Owner',
  coo: 'Javier Fernandez',
  estimator: 'Tom Mangan',
  estimatorTitle: 'Senior Estimator & Project Manager',
  controller: 'Franchesca Cox',
  address: '15095 Old Spanish Trail, Paradis, LA 70080',
  phone: '(985) 306-4005',
  fax: '',
  email: 'estimating@dacpconstruction.com',
  website: 'dacpconstruction.com',
  taxId: '82-XXXXXXX',
  laLicense: 'Building Construction, Highway/Street/Bridge, Heavy Construction, Municipal/Public Works, Asphalt/Concrete, Foundations',
  dbeCertNo: 'DBE-2019-0847',
  dbeExpiry: '2026-11-30',
  stateOfIncorporation: 'Louisiana',
  yearEstablished: 2009,
  specialties: ['Concrete Construction', 'Masonry Construction', 'Heavy Civil', 'Commercial Construction'],
  insuranceGL: '$2,000,000 per occurrence',
  insuranceAuto: '$1,000,000',
  insuranceWC: 'Statutory limits',
  insuranceUmbrella: '$5,000,000',
};


// ═══════════════════════════════════════════════════════════════════════════
// 1. PROPOSAL GENERATOR (Step 7)
// ═══════════════════════════════════════════════════════════════════════════

export async function generateProposal({
  projectName, gcName, owner, architect, planDate, addenda,
  location, bidDueDate,
  concreteScope, masonryScope, siteWorkScope,
  materialSpecs, equipment, exclusions, clarifications,
  totalBid, estimatedDuration,
}) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 22 },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1080, left: 1440, right: 1440 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: 'DACP CONSTRUCTION LLC', bold: true, size: 16, color: '1E3A5F', font: 'Times New Roman' })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      children: [
        // Title
        new Paragraph({
          children: [new TextRun({ text: 'DACP CONSTRUCTION LLC', bold: true, size: 36, color: '1E3A5F' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'PROPOSAL', bold: true, size: 28, color: '555555' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),

        // Project info block
        ...buildInfoBlock([
          ['Date:', today],
          ['Project:', projectName],
          ['Location:', location || 'TBD'],
          ['Owner:', owner || 'TBD'],
          ['Architect:', architect || 'TBD'],
          ['GC:', gcName],
          ['Plans Dated:', planDate || 'TBD'],
          ...(addenda ? [['Addenda:', addenda]] : []),
        ]),

        new Paragraph({ spacing: { after: 200 } }),

        // Concrete Scope
        ...(concreteScope?.length > 0 ? [
          sectionHeading('SCOPE OF WORK - CONCRETE'),
          subHeading('Specific Operations:'),
          ...concreteScope.map((item, i) => numberedItem(i + 1, item)),
        ] : []),

        // Masonry Scope
        ...(masonryScope?.length > 0 ? [
          new Paragraph({ spacing: { after: 100 } }),
          sectionHeading('SCOPE OF WORK - MASONRY'),
          ...masonryScope.map((item, i) => numberedItem(i + 1, item)),
        ] : []),

        // Site Work
        ...(siteWorkScope?.length > 0 ? [
          new Paragraph({ spacing: { after: 100 } }),
          sectionHeading('SITE WORK'),
          ...siteWorkScope.map((item, i) => numberedItem(i + 1, item)),
        ] : []),

        // Material Specs
        ...(materialSpecs?.length > 0 ? [
          new Paragraph({ spacing: { after: 100 } }),
          sectionHeading('MATERIAL SPECIFICATIONS'),
          ...materialSpecs.map(spec => bulletItem(spec)),
        ] : []),

        // Equipment
        ...(equipment?.length > 0 ? [
          new Paragraph({ spacing: { after: 100 } }),
          sectionHeading('EQUIPMENT'),
          ...equipment.map(eq => bulletItem(eq)),
        ] : []),

        // Exclusions
        sectionHeading('EXCLUSIONS'),
        ...(exclusions || defaultExclusions()).map((item, i) => numberedItem(i + 1, item)),

        // Clarifications
        ...(clarifications?.length > 0 ? [
          new Paragraph({ spacing: { after: 100 } }),
          sectionHeading('CLARIFICATIONS'),
          ...clarifications.map(c => bulletItem(c)),
        ] : [
          new Paragraph({ spacing: { after: 100 } }),
          sectionHeading('CLARIFICATIONS'),
          ...defaultClarifications().map(c => bulletItem(c)),
        ]),

        // Total Bid
        new Paragraph({ spacing: { after: 200 } }),
        new Paragraph({
          children: [
            new TextRun({ text: 'TOTAL BID: ', bold: true, size: 28, color: '1E3A5F' }),
            new TextRun({ text: `$${Number(totalBid || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, bold: true, size: 28, color: '1E3A5F' }),
          ],
          spacing: { after: 100 },
        }),

        ...(estimatedDuration ? [new Paragraph({
          children: [new TextRun({ text: `Estimated Duration: ${estimatedDuration}`, italics: true, size: 22, color: '666666' })],
        })] : []),

        // Signature block
        new Paragraph({ spacing: { after: 400 } }),
        new Paragraph({ children: [new TextRun({ text: 'Respectfully submitted,', size: 22 })] }),
        new Paragraph({ spacing: { after: 200 } }),
        new Paragraph({ children: [new TextRun({ text: DACP_COMPANY.estimator, bold: true, size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: DACP_COMPANY.estimatorTitle, size: 22, color: '666666' })] }),
        new Paragraph({ children: [new TextRun({ text: DACP_COMPANY.name, size: 22, color: '666666' })] }),
        new Paragraph({ children: [new TextRun({ text: DACP_COMPANY.phone, size: 22, color: '666666' })] }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `DACP_Proposal_${projectName.replace(/[^a-zA-Z0-9]/g, '_')}.docx`;
  const filepath = join(OUTPUT_DIR, filename);
  writeFileSync(filepath, buffer);
  return { filepath, filename, size: buffer.length };
}

function defaultExclusions() {
  return [
    'Sales tax (verify exemption status)',
    'Building layout by engineer/surveyor',
    'Demolition of any kind',
    'Performance and payment bond (available upon request at additional cost)',
    'Permits and related fees',
    'Traffic control',
    'Site dewatering',
    'Fill material and compaction of subgrade',
    'Material testing (test cylinders furnished by DACP; testing lab by others)',
    'Waterproofing and damp-proofing',
    'Structural steel embeds (furnished by steel subcontractor)',
    'Rigid insulation',
    'Masonry sealer',
    'Caulking and sealants',
    'Polished, stained, or stamped concrete finishes',
    'Crane/hoisting for other trades',
    'Saw cutting or drilling for other trades',
    'Expansion joint covers',
  ];
}

function defaultClarifications() {
  return [
    'Price based on normal 5-day work week. Overtime premium if accelerated schedule required.',
    'Concrete pours scheduled minimum 48 hours in advance with concrete supplier.',
    `DACP is a certified DBE contractor (LA certification #${DACP_COMPANY.dbeCertNo}).`,
    'Pricing valid for 60 days from date of proposal.',
  ];
}

function sectionHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24, color: '1E3A5F' })],
    spacing: { before: 200, after: 100 },
    border: { bottom: { color: '1E3A5F', size: 1, space: 4, style: BorderStyle.SINGLE } },
  });
}

function subHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22 })],
    spacing: { after: 80 },
  });
}

function numberedItem(num, text) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${num}. `, bold: true, size: 22 }),
      new TextRun({ text, size: 22 }),
    ],
    spacing: { after: 60 },
    indent: { left: 360 },
  });
}

function bulletItem(text) {
  return new Paragraph({
    children: [new TextRun({ text: `\u2022  ${text}`, size: 22 })],
    spacing: { after: 60 },
    indent: { left: 360 },
  });
}

function buildInfoBlock(pairs) {
  return pairs.map(([label, value]) => new Paragraph({
    children: [
      new TextRun({ text: `${label} `, bold: true, size: 22 }),
      new TextRun({ text: value || '', size: 22 }),
    ],
    spacing: { after: 40 },
  }));
}


// ═══════════════════════════════════════════════════════════════════════════
// 2. BID SANITY CHECKER (Step 6 Enhancement)
// ═══════════════════════════════════════════════════════════════════════════

export function runBidSanityChecks(estimate) {
  const checks = [];
  const lineItems = estimate.line_items || estimate.lineItems || [];
  const totalBid = estimate.total_bid || estimate.totalBid || 0;
  const subtotal = estimate.subtotal || 0;
  const overheadPct = estimate.overhead_pct || estimate.overheadPct || 10;
  const profitPct = estimate.profit_pct || estimate.profitPct || 10;

  // Calculate total concrete CY and total SOG SF from line items
  let totalCY = 0;
  let totalSogSF = 0;
  let totalLabor = 0;
  let totalMaterial = 0;

  for (const li of lineItems) {
    const unit = (li.unit || '').toUpperCase();
    const desc = (li.description || li.pricingItem || '').toLowerCase();
    const qty = li.quantity || 0;
    const price = li.unitPrice || li.unit_price || 0;
    const extended = qty * price;

    if (unit === 'CY') totalCY += qty;
    if (unit === 'SF' && (desc.includes('sog') || desc.includes('slab on grade') || desc.includes('flatwork'))) {
      totalSogSF += qty;
    }
    // Rough split: assume 40% labor, 45% material, 15% equipment
    totalLabor += extended * 0.4;
    totalMaterial += extended * 0.45;
  }

  // Check 1: Cost per CY ($700-$1,300 normal range per Tom)
  if (totalCY > 0) {
    const costPerCY = Math.round(totalBid / totalCY);
    if (costPerCY < 700) {
      checks.push({
        check: 'Cost per Cubic Yard',
        value: `$${costPerCY}/CY`,
        status: 'fail',
        severity: 'high',
        message: `$${costPerCY}/CY is below the $700 minimum. Possible bid bust - check pricing.`,
        range: '$700 – $1,300/CY',
      });
    } else if (costPerCY > 1300) {
      checks.push({
        check: 'Cost per Cubic Yard',
        value: `$${costPerCY}/CY`,
        status: 'warn',
        severity: 'medium',
        message: `$${costPerCY}/CY is above typical range. Verify no double-counted items.`,
        range: '$700 – $1,300/CY',
      });
    } else {
      checks.push({
        check: 'Cost per Cubic Yard',
        value: `$${costPerCY}/CY`,
        status: 'pass',
        severity: 'none',
        message: 'Within normal range.',
        range: '$700 – $1,300/CY',
      });
    }
  }

  // Check 2: SOG cost per SF ($6.80-$10.14 normal range per Tom)
  if (totalSogSF > 0) {
    const sogItems = lineItems.filter(li => {
      const d = (li.description || li.pricingItem || '').toLowerCase();
      return d.includes('sog') || d.includes('slab on grade') || d.includes('flatwork');
    });
    const sogTotal = sogItems.reduce((s, li) => s + (li.quantity || 0) * (li.unitPrice || li.unit_price || 0), 0);
    const costPerSF = (sogTotal / totalSogSF).toFixed(2);

    if (costPerSF < 6.80) {
      checks.push({
        check: 'SOG Cost per SF',
        value: `$${costPerSF}/SF`,
        status: 'fail',
        severity: 'high',
        message: `$${costPerSF}/SF is below minimum. Check SOG pricing.`,
        range: '$6.80 – $10.14/SF',
      });
    } else if (costPerSF > 10.14) {
      checks.push({
        check: 'SOG Cost per SF',
        value: `$${costPerSF}/SF`,
        status: 'warn',
        severity: 'medium',
        message: `$${costPerSF}/SF is above typical. Verify SOG scope.`,
        range: '$6.80 – $10.14/SF',
      });
    } else {
      checks.push({
        check: 'SOG Cost per SF',
        value: `$${costPerSF}/SF`,
        status: 'pass',
        severity: 'none',
        message: 'Within normal range.',
        range: '$6.80 – $10.14/SF',
      });
    }
  }

  // Check 3: 50% Labor Stress Test (per Tom)
  // If labor increases 50%, does the bid still cover costs?
  const stressedLabor = totalLabor * 1.5;
  const stressedFieldCost = stressedLabor + totalMaterial + (subtotal * 0.15); // 15% equipment
  const fieldCostWithOverhead = subtotal * (1 + overheadPct / 100) * (1 + profitPct / 100);

  if (stressedFieldCost > totalBid) {
    checks.push({
      check: '50% Labor Stress Test',
      value: `Stressed: $${Math.round(stressedFieldCost).toLocaleString()} vs Bid: $${Math.round(totalBid).toLocaleString()}`,
      status: 'fail',
      severity: 'critical',
      message: `If labor overruns by 50%, this job loses $${Math.round(stressedFieldCost - totalBid).toLocaleString()}. Consider increasing margin.`,
      range: 'Bid must cover 150% labor scenario',
    });
  } else {
    const buffer = totalBid - stressedFieldCost;
    checks.push({
      check: '50% Labor Stress Test',
      value: `$${Math.round(buffer).toLocaleString()} buffer`,
      status: 'pass',
      severity: 'none',
      message: `Even with 50% labor overrun, DACP retains $${Math.round(buffer).toLocaleString()} margin.`,
      range: 'Bid must cover 150% labor scenario',
    });
  }

  // Check 4: Overhead + Profit margin
  const effectiveMargin = ((totalBid - subtotal) / subtotal * 100).toFixed(1);
  if (effectiveMargin < 20) {
    checks.push({
      check: 'Effective Margin',
      value: `${effectiveMargin}%`,
      status: 'warn',
      severity: 'medium',
      message: `${effectiveMargin}% is below the 20% minimum target. Consider increasing OH&P.`,
      range: '20%+ target',
    });
  } else {
    checks.push({
      check: 'Effective Margin',
      value: `${effectiveMargin}%`,
      status: 'pass',
      severity: 'none',
      message: 'Margin meets or exceeds 20% target.',
      range: '20%+ target',
    });
  }

  // Check 5: Labor as % of field cost
  const laborPct = subtotal > 0 ? (totalLabor / subtotal * 100).toFixed(1) : 0;
  checks.push({
    check: 'Labor % of Field Cost',
    value: `${laborPct}%`,
    status: laborPct > 55 ? 'warn' : 'pass',
    severity: laborPct > 55 ? 'medium' : 'none',
    message: laborPct > 55
      ? 'Labor-heavy bid. Verify crew sizing and production rates.'
      : 'Labor ratio within normal bounds.',
    range: '35% – 55% typical',
  });

  // Overall verdict
  const fails = checks.filter(c => c.status === 'fail');
  const warns = checks.filter(c => c.status === 'warn');
  const overallStatus = fails.length > 0 ? 'fail' : warns.length > 0 ? 'warn' : 'pass';

  return {
    overall: overallStatus,
    summary: fails.length > 0
      ? `${fails.length} CRITICAL issue(s) found - review before submitting`
      : warns.length > 0
      ? `${warns.length} warning(s) - review recommended`
      : 'All checks passed - bid looks solid',
    checks,
    metrics: { totalCY, totalSogSF, effectiveMargin, laborPct, totalBid },
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// 3. TAKEOFF TEMPLATE GENERATOR (Step 3-4 Bridge)
// ═══════════════════════════════════════════════════════════════════════════

export async function generateTakeoffTemplate(projectName, gcName, assemblies) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DACP Construction - Coppice AI';
  wb.created = new Date();

  // ── Sheet 1: Takeoff ──
  const ws = wb.addWorksheet('Takeoff');

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Arial' };
  const sectionFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } };
  const sectionFont = { bold: true, size: 10, color: { argb: 'FF1E3A5F' }, name: 'Arial' };
  const borderThin = { style: 'thin', color: { argb: 'FFD0D0D0' } };
  const borders = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
  const numFont = { size: 10, name: 'Arial' };

  ws.columns = [
    { key: 'item', width: 6 },
    { key: 'description', width: 30 },
    { key: 'count', width: 8 },
    { key: 'length', width: 10 },
    { key: 'width', width: 10 },
    { key: 'height', width: 10 },
    { key: 'contact_sf', width: 14 },
    { key: 'cubic_ft', width: 14 },
    { key: 'cubic_yd', width: 12 },
    { key: 'notes', width: 24 },
  ];

  // Title
  ws.mergeCells('A1:J1');
  const t1 = ws.getCell('A1');
  t1.value = 'DACP CONSTRUCTION - QUANTITY TAKEOFF';
  t1.font = { bold: true, size: 14, color: { argb: 'FF1E3A5F' }, name: 'Arial' };

  ws.mergeCells('A2:J2');
  ws.getCell('A2').value = `Project: ${projectName}  |  GC: ${gcName}  |  Date: ${new Date().toLocaleDateString()}`;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF888888' }, name: 'Arial' };

  ws.addRow([]);

  // Column headers
  const hdr = ws.addRow(['#', 'Description', 'Count', 'Length (ft)', 'Width (ft)', 'Height/Depth (ft)', 'Contact SF', 'Cubic Ft', 'Cubic Yd', 'Notes']);
  hdr.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.border = borders; cell.alignment = { horizontal: 'center' }; });
  hdr.getCell(2).alignment = { horizontal: 'left' };
  hdr.height = 22;

  let rowNum = 5;
  const sectionStartRows = {};

  // Default assembly categories if none provided
  const cats = assemblies?.length > 0 ? assemblies : [
    { section: 'FOOTINGS', items: ['Pile Caps (3PC)', 'Pile Caps (4PC)', 'Pile Caps (6PC)', 'Spread Footings', 'Strip Footings'] },
    { section: 'GRADE BEAMS', items: ['Grade Beams', 'Sloped Beams', 'Cross Beams'] },
    { section: 'COLUMNS', items: ['Columns (per schedule)'] },
    { section: 'SLAB ON GRADE', items: ['SOG 6"', 'SOG 8"', 'Thickened Edge'] },
    { section: 'ELEVATED SLAB', items: ['PT Deck 10"', 'Concrete on Metal Deck'] },
    { section: 'WALLS', items: ['Walls (per schedule)'] },
    { section: 'STAIRS', items: ['Pan-Fill Stairs', 'CIP Stairs', 'Concrete Steps'] },
    { section: 'SITE WORK', items: ['Sidewalks', 'Curb & Gutter', 'Loading Dock', 'Ramps'] },
  ];

  for (const cat of cats) {
    // Section header row
    const secRow = ws.addRow([null, cat.section]);
    secRow.eachCell(cell => { cell.fill = sectionFill; cell.font = sectionFont; cell.border = borders; });
    // Fill all cells in section row
    for (let c = 1; c <= 10; c++) {
      const cell = secRow.getCell(c);
      cell.fill = sectionFill;
      cell.border = borders;
    }
    sectionStartRows[cat.section] = rowNum + 1;
    rowNum++;

    for (const item of cat.items) {
      const dataRow = ws.addRow([null, item, null, null, null, null]);
      dataRow.eachCell(cell => { cell.border = borders; cell.font = numFont; });

      // Formulas for Contact SF, Cubic Ft, Cubic Yd
      const r = dataRow.number;
      // Contact SF = Count * 2 * (Length + Width) * Height (for footings/beams)
      // Simplified: Contact SF = Count * Length * Width (for slabs) - user adjusts
      dataRow.getCell(7).value = { formula: `IF(C${r}="","",C${r}*D${r}*E${r})` };
      dataRow.getCell(7).numFmt = '#,##0';
      // Cubic Ft = Count * Length * Width * Height
      dataRow.getCell(8).value = { formula: `IF(C${r}="","",C${r}*D${r}*E${r}*F${r})` };
      dataRow.getCell(8).numFmt = '#,##0';
      // Cubic Yd = Cubic Ft / 27
      dataRow.getCell(9).value = { formula: `IF(H${r}="","",H${r}/27)` };
      dataRow.getCell(9).numFmt = '#,##0.00';

      for (let c = 1; c <= 10; c++) {
        dataRow.getCell(c).border = borders;
      }

      rowNum++;
    }

    // Subtotal row for section
    const subRow = ws.addRow([null, `Total ${cat.section}`, null, null, null, null]);
    const sr = subRow.number;
    const startR = sectionStartRows[cat.section] + 1;
    subRow.getCell(7).value = { formula: `SUM(G${startR}:G${sr - 1})` };
    subRow.getCell(7).numFmt = '#,##0';
    subRow.getCell(7).font = { bold: true, size: 10, name: 'Arial' };
    subRow.getCell(9).value = { formula: `SUM(I${startR}:I${sr - 1})` };
    subRow.getCell(9).numFmt = '#,##0.00';
    subRow.getCell(9).font = { bold: true, size: 10, name: 'Arial' };
    subRow.getCell(2).font = { bold: true, size: 10, name: 'Arial' };
    for (let c = 1; c <= 10; c++) {
      subRow.getCell(c).border = borders;
      subRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F0' } };
    }
    rowNum++;
    ws.addRow([]);
    rowNum++;
  }

  // Grand total
  const grandRow = ws.addRow([null, 'GRAND TOTAL']);
  grandRow.getCell(2).font = { bold: true, size: 12, color: { argb: 'FF1E3A5F' }, name: 'Arial' };
  grandRow.getCell(7).font = { bold: true, size: 12, name: 'Arial' };
  grandRow.getCell(9).font = { bold: true, size: 12, name: 'Arial' };
  for (let c = 1; c <= 10; c++) {
    grandRow.getCell(c).border = { top: { style: 'double', color: { argb: 'FF1E3A5F' } }, bottom: { style: 'double', color: { argb: 'FF1E3A5F' } }, left: borderThin, right: borderThin };
  }

  // ── Sheet 2: Pricing (auto-linked to takeoff) ──
  const ps = wb.addWorksheet('Pricing');
  ps.columns = [
    { key: 'item', width: 30 },
    { key: 'field_cost', width: 14 },
    { key: 'oh_profit', width: 14 },
    { key: 'pct_total', width: 10 },
    { key: 'yds', width: 10 },
    { key: 'cost_per_yd', width: 14 },
    { key: 'material', width: 14 },
  ];

  ps.mergeCells('A1:G1');
  ps.getCell('A1').value = 'PRICING SHEET - Auto-linked to Takeoff';
  ps.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1E3A5F' }, name: 'Arial' };

  const phdr = ps.addRow(['Item', 'Field Cost', '25% OH/Profit', '% of Total', 'YDS', 'Cost/Per Yd', 'Material']);
  phdr.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.border = borders; });

  // ── Sheet 3: Masonry (template) ──
  const ms = wb.addWorksheet('Masonry');
  ms.columns = [
    { key: 'prod', width: 8 },
    { key: 'desc', width: 24 },
    { key: 'qty', width: 10 },
    { key: 'unit', width: 8 },
    { key: 'mat', width: 10 },
    { key: 'mortar', width: 10 },
    { key: 'labor', width: 10 },
    { key: 'total', width: 12 },
  ];

  ms.mergeCells('A1:H1');
  ms.getCell('A1').value = 'MASONRY PRICING';
  ms.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1E3A5F' }, name: 'Arial' };

  const mhdr = ms.addRow(['PROD', 'DESCRIPTION', 'QUANTITY', 'UNIT', 'MAT $', 'MORTAR $', 'LABOR $', 'TOTAL $']);
  mhdr.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.border = borders; });

  // Pre-populate common masonry items
  const masonryItems = [
    { prod: 125, desc: '8x8x16 Hollow', mat: 1.70, mortar: 0.40 },
    { prod: 100, desc: '8x8x16 Hollow KO', mat: 2.00, mortar: 0.40 },
    { prod: 125, desc: '12x8x16 Stem', mat: 2.49, mortar: 0.40 },
    { prod: 100, desc: '12x8x16 Hollow', mat: 2.49, mortar: 0.40 },
    { prod: 125, desc: '12" PC Lintels', mat: 0.26, mortar: 0 },
    { prod: 0, desc: 'Face Brick (per spec)', mat: 0, mortar: 0 },
    { prod: 0, desc: 'Cell Fill 8" and 12"', mat: 80, mortar: 150 },
  ];

  for (const mi of masonryItems) {
    const r = ms.addRow([mi.prod, mi.desc, null, null, mi.mat, mi.mortar, null]);
    r.eachCell(cell => { cell.border = borders; cell.font = numFont; });
    const rn = r.number;
    r.getCell(8).value = { formula: `IF(C${rn}="","",C${rn}*(E${rn}+F${rn}+G${rn}))` };
    r.getCell(8).numFmt = '"$"#,##0.00';
  }

  // ── Sheet 4: Equipment ──
  const eq = wb.addWorksheet('Equipment');
  eq.columns = [
    { key: 'item', width: 30 },
    { key: 'qty', width: 8 },
    { key: 'unit', width: 12 },
    { key: 'rate', width: 14 },
    { key: 'duration', width: 12 },
    { key: 'total', width: 14 },
  ];

  eq.mergeCells('A1:F1');
  eq.getCell('A1').value = 'EQUIPMENT';
  eq.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1E3A5F' }, name: 'Arial' };

  const ehdr = eq.addRow(['Equipment', 'Qty', 'Unit', 'Rate', 'Duration', 'Total Cost']);
  ehdr.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.border = borders; });

  const equipmentItems = [
    'Back Hoe/Mini Excavator', 'Plate Compactor/Skid Steer', 'Fork Lift',
    'Crane In/Out', 'Concrete Pump (boom)', 'Concrete Pump (line)',
  ];
  for (const ei of equipmentItems) {
    const r = eq.addRow([ei]);
    r.eachCell(cell => { cell.border = borders; cell.font = numFont; });
    const rn = r.number;
    r.getCell(6).value = { formula: `IF(B${rn}="","",B${rn}*D${rn}*E${rn})` };
    r.getCell(6).numFmt = '"$"#,##0.00';
  }

  const filename = `DACP_Takeoff_${projectName.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
  const filepath = join(OUTPUT_DIR, filename);
  await wb.xlsx.writeFile(filepath);
  return { filepath, filename };
}


// ═══════════════════════════════════════════════════════════════════════════
// 4. COMPLIANCE FORM PRE-FILLER
// ═══════════════════════════════════════════════════════════════════════════

export async function generateComplianceForms(projectName, gcName, bidDate) {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 22 },
          paragraph: { spacing: { after: 120 } },
        },
      },
    },
    sections: [
      // ── DBE Form 1: Contract Participation ──
      {
        properties: { page: { margin: { top: 1080, bottom: 720, left: 1080, right: 1080 } } },
        children: [
          formTitle('DBE FORM 1 - CONTRACT PARTICIPATION AND DBE COMMITMENT'),
          formField('Project Name:', projectName),
          formField('Bid Date:', bidDate || new Date().toLocaleDateString()),
          formField('General Contractor:', gcName),
          new Paragraph({ spacing: { after: 200 } }),
          formField('DBE Subcontractor:', DACP_COMPANY.name),
          formField('DBE Certification No.:', DACP_COMPANY.dbeCertNo),
          formField('DBE Expiration Date:', DACP_COMPANY.dbeExpiry),
          formField('Address:', DACP_COMPANY.address),
          formField('Phone:', DACP_COMPANY.phone),
          formField('Contact:', `${DACP_COMPANY.estimator}, ${DACP_COMPANY.estimatorTitle}`),
          new Paragraph({ spacing: { after: 200 } }),
          formField('Type of Work:', 'Concrete and Masonry Construction (CSI Divisions 03, 04)'),
          formField('Estimated Dollar Amount:', '$ _________________'),
          formField('Percentage of Total Contract:', '_________%'),
          new Paragraph({ spacing: { after: 300 } }),
          formField('Signature:', '________________________________'),
          formField('Name:', DACP_COMPANY.owner),
          formField('Title:', DACP_COMPANY.ownerTitle),
          formField('Date:', '________________'),
        ],
      },
      // ── Buy America Certificate ──
      {
        properties: { page: { margin: { top: 1080, bottom: 720, left: 1080, right: 1080 } } },
        children: [
          formTitle('BUY AMERICA CERTIFICATE OF COMPLIANCE'),
          new Paragraph({ spacing: { after: 200 } }),
          new Paragraph({
            children: [new TextRun({
              text: `The undersigned hereby certifies that ${DACP_COMPANY.name} will comply with the applicable provisions of the Buy America Act (49 U.S.C. 5323(j)) and the applicable regulations in 49 C.F.R. Part 661.`,
              size: 22,
            })],
          }),
          new Paragraph({ spacing: { after: 100 } }),
          new Paragraph({
            children: [new TextRun({
              text: 'All steel, iron, and manufactured products used in the project will be produced in the United States, unless a waiver has been granted by the Federal Transit Administration or the steel, iron, or manufactured product is subject to a general waiver.',
              size: 22,
            })],
          }),
          new Paragraph({ spacing: { after: 300 } }),
          formField('Project:', projectName),
          formField('Contractor:', DACP_COMPANY.name),
          formField('Address:', DACP_COMPANY.address),
          new Paragraph({ spacing: { after: 200 } }),
          formField('Signature:', '________________________________'),
          formField('Name:', DACP_COMPANY.owner),
          formField('Title:', DACP_COMPANY.ownerTitle),
          formField('Date:', '________________'),
        ],
      },
      // ── Non-Collusion Affidavit ──
      {
        properties: { page: { margin: { top: 1080, bottom: 720, left: 1080, right: 1080 } } },
        children: [
          formTitle('NON-COLLUSION AFFIDAVIT'),
          new Paragraph({ spacing: { after: 200 } }),
          new Paragraph({
            children: [new TextRun({
              text: `I, ${DACP_COMPANY.owner}, being duly sworn, depose and say that:`,
              size: 22,
            })],
          }),
          numberedItem(1, `I am the ${DACP_COMPANY.ownerTitle} of ${DACP_COMPANY.name}, the bidder that has submitted the attached bid.`),
          numberedItem(2, 'The bid is not made in the interest of, or on behalf of, any undisclosed person, partnership, company, association, organization, or corporation.'),
          numberedItem(3, 'The bid is genuine and not collusive or sham.'),
          numberedItem(4, 'The bidder has not directly or indirectly induced or solicited any other bidder to put in a false or sham bid, and has not directly or indirectly colluded, conspired, connived, or agreed with any bidder or anyone else to put in a sham bid, or to refrain from bidding.'),
          numberedItem(5, 'The bidder has not in any manner, directly or indirectly, sought by agreement, communication, or conference with anyone to fix the bid price, or of any other bidder, or to fix any overhead, profit, or cost element of the bid price, or of that of any other bidder.'),
          numberedItem(6, 'All statements contained in the bid are true.'),
          numberedItem(7, 'The bidder has not, directly or indirectly, submitted the bid price or any breakdown thereof, or the contents thereof, or divulged information or data relative thereto, to any corporation, partnership, company, association, organization, bid depository, or to any member or agent thereof, to effectuate a collusive or sham bid.'),
          new Paragraph({ spacing: { after: 300 } }),
          formField('Signature:', '________________________________'),
          formField('Name:', DACP_COMPANY.owner),
          formField('Title:', DACP_COMPANY.ownerTitle),
          formField('Company:', DACP_COMPANY.name),
          formField('Date:', '________________'),
          new Paragraph({ spacing: { after: 200 } }),
          new Paragraph({
            children: [new TextRun({ text: 'Subscribed and sworn to before me this _____ day of _____________, 20___.', size: 22, italics: true })],
          }),
          new Paragraph({ spacing: { after: 100 } }),
          formField('Notary Public:', '________________________________'),
          formField('Commission Expiration:', '________________'),
        ],
      },
      // ── Certificate on Primary Debarment ──
      {
        properties: { page: { margin: { top: 1080, bottom: 720, left: 1080, right: 1080 } } },
        children: [
          formTitle('CERTIFICATE ON PRIMARY DEBARMENT'),
          new Paragraph({ spacing: { after: 200 } }),
          new Paragraph({
            children: [new TextRun({
              text: `The undersigned certifies, by submission of this bid, that neither ${DACP_COMPANY.name} nor its principals are presently debarred, suspended, proposed for debarment, declared ineligible, or voluntarily excluded from participation in this transaction by any Federal department or agency.`,
              size: 22,
            })],
          }),
          new Paragraph({ spacing: { after: 100 } }),
          new Paragraph({
            children: [new TextRun({
              text: 'Where the prospective participant is unable to certify to any of the statements in this certification, such prospective participant shall attach an explanation to this proposal.',
              size: 22,
            })],
          }),
          new Paragraph({ spacing: { after: 300 } }),
          formField('Company:', DACP_COMPANY.name),
          formField('Address:', DACP_COMPANY.address),
          formField('Signature:', '________________________________'),
          formField('Name:', DACP_COMPANY.owner),
          formField('Title:', DACP_COMPANY.ownerTitle),
          formField('Date:', '________________'),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `DACP_Compliance_Forms_${projectName.replace(/[^a-zA-Z0-9]/g, '_')}.docx`;
  const filepath = join(OUTPUT_DIR, filename);
  writeFileSync(filepath, buffer);
  return { filepath, filename, forms: ['DBE Form 1', 'Buy America Certificate', 'Non-Collusion Affidavit', 'Certificate on Primary Debarment'] };
}

function formTitle(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 28, color: '1E3A5F' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    border: { bottom: { color: '1E3A5F', size: 2, space: 6, style: BorderStyle.SINGLE } },
  });
}

function formField(label, value) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}  `, bold: true, size: 22 }),
      new TextRun({ text: value || '', size: 22 }),
    ],
    spacing: { after: 80 },
  });
}


// ═══════════════════════════════════════════════════════════════════════════
// 5. CONTRACT REDLINE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

export async function generateContractRedline(comparison, projectName) {
  const sections = [];

  // Title page
  sections.push({
    properties: { page: { margin: { top: 1440, bottom: 1080, left: 1440, right: 1440 } } },
    children: [
      new Paragraph({
        children: [new TextRun({ text: 'CONTRACT REDLINE REVIEW', bold: true, size: 36, color: '1E3A5F' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: projectName || 'Project', size: 24, color: '666666' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `Prepared by DACP Construction | ${new Date().toLocaleDateString()}`, size: 20, color: '999999' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
      }),
      new Paragraph({
        children: [new TextRun({
          text: `Overall Risk: ${(comparison.summary?.overall_risk || 'unknown').toUpperCase()}`,
          bold: true, size: 24,
          color: comparison.summary?.overall_risk === 'critical' ? 'CC0000' :
                 comparison.summary?.overall_risk === 'high' ? 'CC6600' : '1E3A5F',
        })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
      }),

      // Legend
      sectionHeading('LEGEND'),
      new Paragraph({ children: [
        new TextRun({ text: 'RED STRIKETHROUGH', strike: true, color: 'CC0000', size: 22, bold: true }),
        new TextRun({ text: ' - Language to REMOVE or REJECT', size: 22 }),
      ], spacing: { after: 60 } }),
      new Paragraph({ children: [
        new TextRun({ text: 'GREEN UNDERLINE', color: '008800', underline: {}, size: 22, bold: true }),
        new TextRun({ text: ' - Language to ADD or INSERT', size: 22 }),
      ], spacing: { after: 60 } }),
      new Paragraph({ children: [
        new TextRun({ text: 'AMBER NOTE', color: 'CC6600', size: 22, bold: true }),
        new TextRun({ text: ' - Requires discussion / clarification', size: 22 }),
      ], spacing: { after: 200 } }),

      // Scope additions (items in contract but NOT in proposal)
      ...(comparison.scope_comparison?.in_contract_only?.length > 0 ? [
        sectionHeading('SCOPE ADDITIONS - NOT IN DACP BID'),
        new Paragraph({ children: [new TextRun({
          text: 'The following items appear in the GC contract but were NOT included in DACP\'s proposal. These represent additional scope that DACP did not price.',
          size: 22, color: '666666', italics: true,
        })], spacing: { after: 100 } }),
        ...comparison.scope_comparison.in_contract_only.flatMap(item => [
          new Paragraph({ children: [
            new TextRun({ text: `\u2716  ${item.item}`, strike: true, color: 'CC0000', size: 22, bold: true }),
          ], spacing: { after: 40 } }),
          new Paragraph({ children: [
            new TextRun({ text: `    Risk: ${item.risk || 'high'} - ${item.impact || 'Not in original bid'}`, size: 20, color: 'CC0000' }),
          ], spacing: { after: 80 }, indent: { left: 360 } }),
        ]),
      ] : []),

      // Missing exclusions
      ...(comparison.exclusion_comparison?.exclusions_missing?.length > 0 ? [
        sectionHeading('MISSING EXCLUSIONS - MUST ADD BEFORE SIGNING'),
        new Paragraph({ children: [new TextRun({
          text: 'The following exclusions from DACP\'s proposal are NOT reflected in the contract. Without these, DACP may be responsible for these costs.',
          size: 22, color: '666666', italics: true,
        })], spacing: { after: 100 } }),
        ...comparison.exclusion_comparison.exclusions_missing.flatMap(item => [
          new Paragraph({ children: [
            new TextRun({ text: `ADD: "${item.item}"`, color: '008800', underline: {}, size: 22, bold: true }),
          ], spacing: { after: 40 } }),
          new Paragraph({ children: [
            new TextRun({ text: `    ${item.action || item.impact || 'Must be added to contract exclusions'}`, size: 20, color: '008800' }),
          ], spacing: { after: 80 }, indent: { left: 360 } }),
        ]),
      ] : []),

      // Recommended redlines
      ...(comparison.recommended_redlines?.length > 0 ? [
        sectionHeading('RECOMMENDED REDLINES'),
        ...comparison.recommended_redlines.flatMap(rl => [
          new Paragraph({ children: [
            new TextRun({ text: `[${(rl.priority || 'should-have').toUpperCase()}] `, bold: true, size: 20,
              color: rl.priority === 'must-have' ? 'CC0000' : rl.priority === 'should-have' ? 'CC6600' : '666666' }),
            new TextRun({ text: rl.section || '', bold: true, size: 22 }),
          ], spacing: { after: 40 } }),
          ...(rl.current_language ? [new Paragraph({ children: [
            new TextRun({ text: 'Current: ', bold: true, size: 20, color: '666666' }),
            new TextRun({ text: rl.current_language, strike: true, color: 'CC0000', size: 20 }),
          ], spacing: { after: 40 }, indent: { left: 360 } })] : []),
          ...(rl.proposed_change ? [new Paragraph({ children: [
            new TextRun({ text: 'Proposed: ', bold: true, size: 20, color: '666666' }),
            new TextRun({ text: rl.proposed_change, color: '008800', underline: {}, size: 20 }),
          ], spacing: { after: 40 }, indent: { left: 360 } })] : []),
          new Paragraph({ children: [
            new TextRun({ text: `Reason: ${rl.reasoning || ''}`, size: 20, color: '888888', italics: true }),
          ], spacing: { after: 100 }, indent: { left: 360 } }),
        ]),
      ] : []),

      // Legal flags
      ...(comparison.legal_flags?.length > 0 ? [
        sectionHeading('LEGAL CONCERNS'),
        ...comparison.legal_flags.flatMap(flag => [
          new Paragraph({ children: [
            new TextRun({ text: `[${(flag.severity || 'medium').toUpperCase()}] `, bold: true, size: 20,
              color: flag.severity === 'critical' ? 'CC0000' : 'CC6600' }),
            new TextRun({ text: flag.clause || '', size: 22 }),
          ], spacing: { after: 40 } }),
          new Paragraph({ children: [
            new TextRun({ text: flag.concern || '', size: 20, color: '666666' }),
          ], spacing: { after: 40 }, indent: { left: 360 } }),
          new Paragraph({ children: [
            new TextRun({ text: `Recommendation: ${flag.recommendation || ''}`, size: 20, color: '008800', italics: true }),
          ], spacing: { after: 100 }, indent: { left: 360 } }),
        ]),
      ] : []),

      // Action items
      ...(comparison.action_items?.length > 0 ? [
        sectionHeading('ACTION ITEMS'),
        ...comparison.action_items.map((ai, i) => new Paragraph({
          children: [
            new TextRun({ text: `${i + 1}. `, bold: true, size: 22 }),
            new TextRun({ text: `[${(ai.priority || 'before-signing').toUpperCase()}] `, bold: true, size: 20,
              color: ai.priority === 'immediate' ? 'CC0000' : '1E3A5F' }),
            new TextRun({ text: `${ai.action} - ${ai.responsible || 'Tom'}`, size: 22 }),
          ],
          spacing: { after: 60 },
          indent: { left: 360 },
        })),
      ] : []),
    ],
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 22 },
          paragraph: { spacing: { after: 120 } },
        },
      },
    },
    sections,
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `DACP_Contract_Redline_${(projectName || 'Project').replace(/[^a-zA-Z0-9]/g, '_')}.docx`;
  const filepath = join(OUTPUT_DIR, filename);
  writeFileSync(filepath, buffer);
  return { filepath, filename, size: buffer.length };
}


// ═══════════════════════════════════════════════════════════════════════════
// 6. SUPPLIER QUOTE TRACKER
// ═══════════════════════════════════════════════════════════════════════════

export function parseSupplierQuote(emailBody, fromName, fromEmail) {
  const result = {
    supplier: fromName || fromEmail || 'Unknown',
    items: [],
    validUntil: null,
    deliveryLeadTime: null,
    notes: [],
  };

  const lines = emailBody.split('\n');

  // Pattern: quantity + unit + @ + price
  const pricePatterns = [
    /(\d[\d,]*(?:\.\d+)?)\s*(cy|sf|lf|ea|ton|lb|loads?)\s*[@at]+\s*\$?([\d,]+(?:\.\d+)?)/gi,
    /\$?([\d,]+(?:\.\d+)?)\s*(?:per|\/)\s*(cy|sf|lf|ea|ton|lb|yard|foot|each)/gi,
    /([\d,]+(?:\.\d+)?)\s*psi.*?\$?([\d,]+(?:\.\d+)?)\s*(?:per|\/)\s*(cy|yard)/gi,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try to extract pricing
    for (const pattern of pricePatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(trimmed)) !== null) {
        result.items.push({
          raw: trimmed,
          quantity: match[1],
          unit: match[2],
          price: match[3] || match[2],
        });
      }
    }

    // Look for delivery info
    if (/delivery|lead time|available/i.test(trimmed)) {
      result.deliveryLeadTime = trimmed;
    }

    // Look for validity
    if (/valid|expires?|good (?:until|through|for)/i.test(trimmed)) {
      result.validUntil = trimmed;
    }

    // Look for minimum order
    if (/minimum|min order|min load/i.test(trimmed)) {
      result.notes.push(trimmed);
    }
  }

  return result;
}
