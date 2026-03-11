/**
 * Estimate Pipeline — End-to-end RFQ → Estimate → Excel → Reply
 *
 * Parses incoming RFQ emails, creates bid requests, generates estimates,
 * builds Excel attachments, and sends reply emails.
 */

import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import {
  createDacpBidRequest,
  insertActivity,
} from '../cache/database.js';
import { generateEstimate, draftQuoteEmail } from './estimateBot.js';
import { sendEmailWithAttachments } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ESTIMATES_DIR = join(__dirname, '../../data/estimates');

// Ensure output directory exists
if (!existsSync(ESTIMATES_DIR)) mkdirSync(ESTIMATES_DIR, { recursive: true });

const TENANT_ID = 'dacp-construction-001';

// ─── RFQ Detection ──────────────────────────────────────────────────────────

const RFQ_SUBJECT_KEYWORDS = [
  'rfq', 'rfp', 'itb', 'bid', 'estimate', 'pricing', 'quote',
  'concrete', 'slab', 'foundation', 'scope of work', 'budget pricing',
];

const SCOPE_KEYWORDS = [
  'slab', 'footing', 'foundation', 'wall', 'retaining', 'curb', 'gutter',
  'sidewalk', 'rebar', 'concrete', 'deck', 'column', 'beam', 'demolition',
  'pier', 'grade beam', 'vapor barrier', 'expansion joint',
];

export function isRfqEmail(subject, body) {
  const subjectLower = (subject || '').toLowerCase();
  const bodyLower = (body || '').toLowerCase();

  // Check subject for RFQ keywords
  const hasSubjectKeyword = RFQ_SUBJECT_KEYWORDS.some(kw => subjectLower.includes(kw));

  // Check body for concrete scope items
  const scopeHits = SCOPE_KEYWORDS.filter(kw => bodyLower.includes(kw));

  // Need subject keyword + at least 2 scope keywords, OR 4+ scope keywords alone
  return (hasSubjectKeyword && scopeHits.length >= 1) || scopeHits.length >= 4;
}

// ─── Email Body Parser ──────────────────────────────────────────────────────

const QUANTITY_RE = /([\d,]+(?:\.\d+)?)\s*(sf|lf|cy|ea|lb|cf|sy)\b/gi;
const BULLET_RE = /^[\s]*[-•*]\s*(.+)$/gm;
const NUMBERED_RE = /^[\s]*\d+[.)]\s*(.+)$/gm;

function extractScopeItems(body) {
  const items = [];
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.replace(/^[\s]*[-•*\d.)]+\s*/, '').trim();
    if (!trimmed || trimmed.length < 5) continue;

    // Check if line has a quantity with a unit
    if (QUANTITY_RE.test(trimmed)) {
      QUANTITY_RE.lastIndex = 0; // Reset regex
      items.push(trimmed);
      continue;
    }

    // Check if line mentions concrete scope keywords
    const lower = trimmed.toLowerCase();
    const hasScope = SCOPE_KEYWORDS.some(kw => lower.includes(kw));
    if (hasScope && /\d/.test(trimmed)) {
      items.push(trimmed);
    }
  }

  return items;
}

function extractGcName(fromName, body) {
  // Try to get company from email signature
  const sigPatterns = [
    /(?:^|\n)\s*(.+?)\s*(?:Construction|Builders|Contracting|General Contractors|GC)\b/im,
  ];
  for (const pat of sigPatterns) {
    const match = body.match(pat);
    if (match) return match[0].trim();
  }
  // Fall back to sender name
  return fromName || 'Unknown GC';
}

function extractDueDate(body) {
  // Look for date patterns near "due", "deadline", "by"
  const patterns = [
    /(?:due|deadline|by|before|respond by)[:\s]*(\w+ \d{1,2},?\s*\d{4})/i,
    /(?:due|deadline)[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /(\w+ \d{1,2},?\s*\d{4})\s*(?:deadline|due)/i,
  ];
  for (const pat of patterns) {
    const match = body.match(pat);
    if (match) {
      const d = new Date(match[1]);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
  }
  // Default: 10 days from now
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return d.toISOString().split('T')[0];
}

// ─── Excel Generator ────────────────────────────────────────────────────────

async function generateEstimateExcel(estimate) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DACP Construction — Coppice AI';
  wb.created = new Date();

  const ws = wb.addWorksheet('Estimate');

  // Column widths
  ws.columns = [
    { header: '', key: 'num', width: 5 },
    { header: '', key: 'description', width: 42 },
    { header: '', key: 'category', width: 16 },
    { header: '', key: 'qty', width: 12 },
    { header: '', key: 'unit', width: 8 },
    { header: '', key: 'unitPrice', width: 14 },
    { header: '', key: 'extended', width: 16 },
  ];

  // Styles
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const currencyFmt = '"$"#,##0.00';
  const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  const accentFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  const borderThin = { style: 'thin', color: { argb: 'FFD0D0D0' } };
  const borders = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };

  // Title block
  ws.mergeCells('A1:G1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'DACP CONSTRUCTION';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF1E3A5F' } };
  titleCell.alignment = { horizontal: 'left' };

  ws.mergeCells('A2:G2');
  ws.getCell('A2').value = `Bid Proposal — ${estimate.projectName}`;
  ws.getCell('A2').font = { size: 12, color: { argb: 'FF666666' } };

  ws.mergeCells('A3:G3');
  ws.getCell('A3').value = `Prepared for: ${estimate.gcName} | Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} | Estimate #${estimate.id}`;
  ws.getCell('A3').font = { size: 10, color: { argb: 'FF999999' } };

  // Blank row
  ws.addRow([]);

  // Header row
  const headerRow = ws.addRow(['#', 'Description', 'Category', 'Quantity', 'Unit', 'Unit Price', 'Extended']);
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.border = borders;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
  headerRow.height = 24;

  // Line items
  const lineItems = estimate.line_items || estimate.lineItems || [];
  lineItems.forEach((li, i) => {
    const row = ws.addRow([
      i + 1,
      li.description || li.pricingItem,
      li.category,
      li.quantity,
      li.unit,
      li.unitPrice || li.unit_price,
      li.extended,
    ]);
    row.eachCell((cell, colNum) => {
      cell.border = borders;
      if (colNum === 6 || colNum === 7) cell.numFmt = currencyFmt;
      if (colNum === 4) cell.numFmt = '#,##0';
    });
    // Zebra striping
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F7' } };
      });
    }
  });

  // Blank separator
  ws.addRow([]);

  // Summary section
  const subtotal = estimate.subtotal || lineItems.reduce((s, li) => s + (li.extended || 0), 0);
  const overheadPct = estimate.overhead_pct || estimate.overheadPct || 10;
  const profitPct = estimate.profit_pct || estimate.profitPct || 15;
  const overhead = subtotal * (overheadPct / 100);
  const profit = (subtotal + overhead) * (profitPct / 100);
  const mobilization = estimate.mobilization || 0;
  const totalBid = estimate.total_bid || estimate.totalBid || 0;

  const summaryRows = [
    ['', '', '', '', '', 'Subtotal', subtotal],
    ['', '', '', '', '', `Overhead (${overheadPct}%)`, overhead],
    ['', '', '', '', '', `Profit (${profitPct}%)`, profit],
    ['', '', '', '', '', 'Mobilization & Testing', mobilization],
  ];

  for (const r of summaryRows) {
    const row = ws.addRow(r);
    row.getCell(6).font = { bold: false, size: 10 };
    row.getCell(6).alignment = { horizontal: 'right' };
    row.getCell(7).numFmt = currencyFmt;
    row.getCell(6).border = borders;
    row.getCell(7).border = borders;
  }

  // Total row
  const totalRow = ws.addRow(['', '', '', '', '', 'TOTAL BID', totalBid]);
  totalRow.getCell(6).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  totalRow.getCell(7).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  totalRow.getCell(6).fill = accentFill;
  totalRow.getCell(7).fill = accentFill;
  totalRow.getCell(7).numFmt = currencyFmt;
  totalRow.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };
  totalRow.getCell(7).alignment = { horizontal: 'right', vertical: 'middle' };
  totalRow.getCell(6).border = borders;
  totalRow.getCell(7).border = borders;
  totalRow.height = 28;

  // Exclusions + notes
  ws.addRow([]);
  ws.addRow([]);
  const exclHeader = ws.addRow(['', 'Standard Exclusions']);
  exclHeader.getCell(2).font = { bold: true, size: 10, color: { argb: 'FF1E3A5F' } };

  const exclusions = [
    'Subgrade preparation (by others)',
    'Earthwork and backfill',
    'Waterproofing (unless noted)',
    'Structural steel embeds (unless noted)',
  ];
  for (const ex of exclusions) {
    ws.addRow(['', `  •  ${ex}`]).getCell(2).font = { size: 9, color: { argb: 'FF666666' } };
  }

  ws.addRow([]);
  const validRow = ws.addRow(['', 'This bid is valid for 30 days from the date above.']);
  validRow.getCell(2).font = { italic: true, size: 9, color: { argb: 'FF999999' } };

  // Write to file
  const filename = `DACP_Estimate_${estimate.id}_${estimate.projectName.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
  const filepath = join(ESTIMATES_DIR, filename);
  await wb.xlsx.writeFile(filepath);

  return { filename, filepath };
}

// ─── Full Pipeline ──────────────────────────────────────────────────────────

export async function processRfqEmail({ messageId, threadId, from, fromName, subject, body }) {
  console.log(`[EstimatePipeline] Processing RFQ: "${subject}" from ${fromName}`);

  // 1. Parse scope items from email body
  const scopeItems = extractScopeItems(body);
  const gcName = extractGcName(fromName, body);
  const dueDate = extractDueDate(body);

  if (scopeItems.length === 0) {
    console.log(`[EstimatePipeline] No scope items found in email, skipping`);
    return null;
  }

  console.log(`[EstimatePipeline] Found ${scopeItems.length} scope items, GC: ${gcName}, Due: ${dueDate}`);

  // 2. Create bid request in database
  const bidId = `BID-${uuidv4().slice(0, 8).toUpperCase()}`;
  const bidRequest = {
    id: bidId,
    tenant_id: TENANT_ID,
    from_email: from,
    from_name: fromName,
    gc_name: gcName,
    subject,
    body,
    attachments_json: '[]',
    scope_json: JSON.stringify({ items: scopeItems }),
    due_date: dueDate,
    status: 'new',
    urgency: 'medium',
    missing_info_json: '[]',
    received_at: new Date().toISOString(),
  };

  createDacpBidRequest(bidRequest);
  console.log(`[EstimatePipeline] Created bid request ${bidId}`);

  // Log activity for incoming RFQ
  insertActivity({
    tenantId: TENANT_ID,
    type: 'in',
    title: `New RFQ from ${gcName}`,
    subtitle: `${subject} — ${scopeItems.length} scope items`,
    detailJson: JSON.stringify({ from, gcName, scopeItems, dueDate, bidId }),
    sourceType: 'email',
    sourceId: `rfq-${messageId}`,
    agentId: 'estimating',
  });

  // 3. Generate estimate
  // Need to re-fetch with proper format for estimateBot
  const bidForEstimate = {
    ...bidRequest,
    scope: { items: scopeItems },
    missing_info: [],
  };

  const { estimate, comparables } = generateEstimate(bidForEstimate, TENANT_ID);
  console.log(`[EstimatePipeline] Generated estimate ${estimate.id}: $${estimate.totalBid.toLocaleString()} (${estimate.confidence} confidence)`);

  // Log activity for estimate
  insertActivity({
    tenantId: TENANT_ID,
    type: 'agent',
    title: `Estimate generated: $${estimate.totalBid.toLocaleString()}`,
    subtitle: `${estimate.projectName} — ${(estimate.lineItems || []).length} line items, ${estimate.confidence} confidence`,
    detailJson: JSON.stringify({ estimateId: estimate.id, totalBid: estimate.totalBid, confidence: estimate.confidence, lineItems: estimate.lineItems?.length, comparables: comparables?.length }),
    sourceType: 'estimate',
    sourceId: `est-${estimate.id}`,
    agentId: 'estimating',
  });

  // 4. Generate Excel
  const { filename, filepath } = await generateEstimateExcel(estimate);
  console.log(`[EstimatePipeline] Generated Excel: ${filename}`);

  // 5. Send reply email
  const emailDraft = draftQuoteEmail(estimate);
  emailDraft.to = from;

  await sendEmailWithAttachments({
    to: from,
    subject: `RE: ${subject} — DACP Construction Bid Proposal`,
    body: emailDraft.body,
    attachments: [{
      filename,
      path: filepath,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  });

  console.log(`[EstimatePipeline] Reply sent to ${from} with estimate ${estimate.id}`);

  // Log activity for sent email
  insertActivity({
    tenantId: TENANT_ID,
    type: 'out',
    title: `Bid proposal sent to ${gcName}`,
    subtitle: `$${estimate.totalBid.toLocaleString()} — ${estimate.projectName}`,
    detailJson: JSON.stringify({ to: from, estimateId: estimate.id, totalBid: estimate.totalBid, excelFile: filename }),
    sourceType: 'email',
    sourceId: `reply-${messageId}`,
    agentId: 'estimating',
  });

  return { bidId, estimate, filename };
}
