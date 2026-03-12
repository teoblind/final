/**
 * IPP Mine Specification Pipeline
 *
 * Detects IPP (Independent Power Producer) inquiry emails,
 * parses generation data from body text or CSV attachments,
 * calculates mine specifications (fleet sizing, revenue projections,
 * infrastructure requirements), generates branded Excel report,
 * and replies with the attachment.
 *
 * Powered by the same model as sanghatool.com.
 * Zero LLM cost — all math + ExcelJS.
 */

import ExcelJS from 'exceljs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import { insertActivity } from '../cache/database.js';
import { sendEmailWithAttachments } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SPECS_DIR = join(__dirname, '../../data/mine-specs');

if (!existsSync(SPECS_DIR)) mkdirSync(SPECS_DIR, { recursive: true });

const TENANT_ID = 'default'; // Sangha tenant

// ─── Miner Models ───────────────────────────────────────────────────────────

const MINER_MODELS = [
  { model: 'Antminer S19 XP', powerKW: 3.01, hashrateTH: 140, efficiencyJTH: 21.5, costPerUnit: 2800 },
  { model: 'Antminer S21',    powerKW: 3.50, hashrateTH: 200, efficiencyJTH: 17.5, costPerUnit: 4500 },
];

const HASHPRICE_SCENARIOS = [
  { label: 'Bull', hashprice: 150 },
  { label: 'Base', hashprice: 100 },
  { label: 'Bear', hashprice: 60  },
];

// ─── 1. IPP Email Detection ────────────────────────────────────────────────

const IPP_SUBJECT_KW = [
  'generation', 'ipp', 'solar', 'wind', 'renewable', 'ppa', 'offtake',
  'behind-the-meter', 'btm', 'mining inquiry', 'mine spec', 'sangha',
  'curtailment', 'mwh', 'megawatt', 'hosting',
];

const IPP_BODY_KW = [
  'mwh', 'megawatt', 'generation', 'capacity', 'nodal price',
  'ercot', 'curtailment', 'behind-the-meter', 'btm',
  'hashrate', 'hashprice', 'mining', 'bitcoin',
  'solar farm', 'wind farm', 'power plant', 'facility',
  'capacity factor', 'operating hours', 'generation hours',
  'nameplate', 'interconnection', 'offtake',
];

export function isIppEmail(subject, body) {
  const sLow = (subject || '').toLowerCase();
  const bLow = (body || '').toLowerCase();
  const subjectHit = IPP_SUBJECT_KW.some(k => sLow.includes(k));
  const bodyHits = IPP_BODY_KW.filter(k => bLow.includes(k));
  return (subjectHit && bodyHits.length >= 2) || bodyHits.length >= 4;
}

// ─── 2. Parse IPP Data ─────────────────────────────────────────────────────

export function parseIppData(body, attachments = []) {
  const data = {
    capacityMW: null,
    annualGenerationMWh: null,
    avgNodalPrice: null,
    generationHours: null,
    operatingHours: null,
    curtailmentPct: null,
    location: null,
    facilityType: null,
    facilityName: null,
  };

  // Try CSV attachment first
  const csv = attachments.find(a =>
    a.filename?.toLowerCase().endsWith('.csv') || a.mimeType === 'text/csv'
  );
  if (csv?.content) parseCSV(csv.content, data);

  // Then parse email body (fills missing fields)
  parseEmailBody(body, data);

  // Derive missing
  if (data.capacityMW && data.annualGenerationMWh && !data.generationHours) {
    data.generationHours = Math.round(data.annualGenerationMWh / data.capacityMW);
  }
  if (!data.operatingHours) data.operatingHours = 8760;
  if (!data.curtailmentPct) data.curtailmentPct = 0;

  // Infer facility type
  if (!data.facilityType) {
    const b = (body || '').toLowerCase();
    if (b.includes('solar')) data.facilityType = 'Solar';
    else if (b.includes('wind')) data.facilityType = 'Wind';
    else if (b.includes('gas') || b.includes('natural gas')) data.facilityType = 'Natural Gas';
    else data.facilityType = 'Renewable';
  }

  return data;
}

function parseCSV(content, data) {
  const lines = content.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return;
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());

  // Key-value format: parameter,value
  if (headers.length === 2 && (headers[0].includes('param') || headers[0].includes('field') || headers[0].includes('metric'))) {
    for (let i = 1; i < lines.length; i++) {
      const [key, val] = lines[i].split(',').map(s => s.trim());
      const k = key.toLowerCase();
      const n = parseFloat(val.replace(/[,$]/g, ''));
      if (isNaN(n)) continue;
      if (k.includes('capacity') && k.includes('mw')) data.capacityMW = n;
      else if (k.includes('generation') && k.includes('mwh')) data.annualGenerationMWh = n;
      else if (k.includes('nodal') || k.includes('price')) data.avgNodalPrice = n;
      else if (k.includes('generation') && k.includes('hour')) data.generationHours = n;
      else if (k.includes('operating') && k.includes('hour')) data.operatingHours = n;
      else if (k.includes('curtailment')) data.curtailmentPct = n;
    }
    return;
  }

  // Time-series format — aggregate columns
  const mwhCol = headers.findIndex(h => h.includes('mwh') || h.includes('generation') || h.includes('energy'));
  const priceCol = headers.findIndex(h => h.includes('price') || h.includes('nodal') || h.includes('$/mwh'));
  if (mwhCol >= 0) {
    let totalMWh = 0, weightedPrice = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(s => s.trim());
      const mwh = parseFloat(cols[mwhCol]?.replace(/[,$]/g, ''));
      if (isNaN(mwh)) continue;
      totalMWh += mwh;
      if (priceCol >= 0) {
        const price = parseFloat(cols[priceCol]?.replace(/[,$]/g, ''));
        if (!isNaN(price)) weightedPrice += price * mwh;
      }
    }
    if (totalMWh > 0) data.annualGenerationMWh = totalMWh;
    if (weightedPrice > 0 && totalMWh > 0) data.avgNodalPrice = weightedPrice / totalMWh;
  }
}

function parseEmailBody(body, data) {
  const t = body || '';

  // Capacity: "50 MW" / "50MW" / "50 megawatt"
  const cap = t.match(/(\d[\d,.]*)\s*(?:MW|megawatt)/i);
  if (cap && !data.capacityMW) data.capacityMW = parseFloat(cap[1].replace(/,/g, ''));

  // Annual generation: "110,000 MWh"
  const gen = t.match(/([\d,]+(?:\.\d+)?)\s*MWh/i);
  if (gen && !data.annualGenerationMWh) data.annualGenerationMWh = parseFloat(gen[1].replace(/,/g, ''));

  // Nodal price: "$28.50/MWh" or "nodal price: $28.50"
  const price = t.match(/\$\s*([\d,.]+)\s*(?:\/|\s*per\s*)MWh/i)
    || t.match(/nodal\s*price[:\s]*\$?\s*([\d,.]+)/i)
    || t.match(/average\s*(?:nodal\s*)?price[:\s]*\$?\s*([\d,.]+)/i);
  if (price && !data.avgNodalPrice) data.avgNodalPrice = parseFloat(price[1].replace(/,/g, ''));

  // Generation hours
  const gh = t.match(/generation\s*hours[:\s]*([\d,]+)/i) || t.match(/([\d,]+)\s*generation\s*hours/i);
  if (gh && !data.generationHours) data.generationHours = parseFloat(gh[1].replace(/,/g, ''));

  // Operating hours
  const oh = t.match(/operating\s*hours[:\s]*([\d,]+)/i);
  if (oh && !data.operatingHours) data.operatingHours = parseFloat(oh[1].replace(/,/g, ''));

  // Curtailment
  const curt = t.match(/curtailment[:\s]*([\d.]+)\s*%/i) || t.match(/([\d.]+)\s*%\s*curtailment/i);
  if (curt && !data.curtailmentPct) data.curtailmentPct = parseFloat(curt[1]);

  // Location
  const loc = t.match(/(?:in|at|near|located\s+(?:in|at))\s+([A-Z][a-zA-Z\s,]+?(?:Texas|TX|California|CA|Oklahoma|OK|New Mexico|NM|Arizona|AZ))/i)
    || t.match(/ERCOT\s+([\w\s]+?)(?:\s+zone|\s+region|[.,\n])/i);
  if (loc && !data.location) data.location = loc[1].trim();

  // Facility name
  const name = t.match(/(?:we(?:'re| are)\s+(?:a\s+)?)([\d\w\s]+(?:solar|wind|gas)\s*(?:farm|plant|facility|partners?))/i)
    || t.match(/our\s+([\w\s]+(?:solar|wind|gas)\s*(?:farm|plant|facility|partners?))/i)
    || t.match(/from\s+([\w\s]+(?:solar|wind|energy|power)\s*(?:partners?|llc|inc|corp)?)/i);
  if (name && !data.facilityName) data.facilityName = name[1].trim();
}

// ─── 3. Calculate Mine Specifications ──────────────────────────────────────

export function calculateMineSpecs(data) {
  const {
    capacityMW, annualGenerationMWh, avgNodalPrice,
    generationHours, curtailmentPct, facilityType, location, facilityName,
  } = data;

  const miningCapacityKW = capacityMW * 1000;
  const miningHoursPerYear = generationHours || (annualGenerationMWh / capacityMW);
  const miningDaysPerYear = miningHoursPerYear / 24;
  const gridRevenue = annualGenerationMWh * (avgNodalPrice || 0);

  // Fleet configurations
  const fleetOptions = MINER_MODELS.map(miner => {
    const count = Math.floor(miningCapacityKW / miner.powerKW);
    const totalHashrateTH = count * miner.hashrateTH;
    const totalHashratePH = totalHashrateTH / 1000;
    const totalPowerMW = (count * miner.powerKW) / 1000;
    const mwhConsumed = totalPowerMW * miningHoursPerYear;
    const equipmentCost = count * miner.costPerUnit;

    const scenarios = HASHPRICE_SCENARIOS.map(s => {
      const annualMiningRevenue = totalHashratePH * s.hashprice * miningDaysPerYear;
      const revenuePerMWh = mwhConsumed > 0 ? annualMiningRevenue / mwhConsumed : 0;
      const premium = annualMiningRevenue - gridRevenue;
      const premiumPct = gridRevenue > 0 ? (premium / gridRevenue * 100) : 0;
      return { ...s, annualMiningRevenue, revenuePerMWh, gridRevenue, premium, premiumPct };
    });

    return {
      model: miner.model, count, hashrateTH: totalHashrateTH,
      hashratePH: totalHashratePH, powerMW: totalPowerMW,
      efficiency: miner.efficiencyJTH, mwhConsumed, equipmentCost, scenarios,
    };
  });

  // Infrastructure (based on S19 XP fleet)
  const rec = fleetOptions[0];
  const containers = Math.ceil(rec.count / 200);
  const transformers = Math.ceil(rec.powerMW / 2.5);

  const infrastructure = {
    containers,
    containerCost: containers * 85000,
    transformers,
    transformerCost: transformers * 120000,
    networkingCost: 25000 + containers * 5000,
    coolingCost: containers * 15000,
    sitePrepCost: 50000 + containers * 10000,
    equipmentCost: rec.equipmentCost,
  };
  infrastructure.totalCapex =
    infrastructure.containerCost + infrastructure.transformerCost +
    infrastructure.networkingCost + infrastructure.coolingCost +
    infrastructure.sitePrepCost + infrastructure.equipmentCost;

  const baseScenario = rec.scenarios.find(s => s.label === 'Base');
  const paybackYears = baseScenario.annualMiningRevenue > 0
    ? infrastructure.totalCapex / baseScenario.annualMiningRevenue
    : Infinity;

  return {
    site: {
      name: facilityName || `${capacityMW}MW ${facilityType} Facility`,
      location: location || 'Not specified',
      type: facilityType,
      capacityMW,
      annualGenerationMWh,
      avgNodalPrice,
      generationHours: Math.round(miningHoursPerYear),
      curtailmentPct: curtailmentPct || 0,
      gridRevenue,
    },
    fleetOptions,
    infrastructure,
    financialSummary: {
      totalCapex: infrastructure.totalCapex,
      baseAnnualMiningRevenue: baseScenario.annualMiningRevenue,
      gridRevenue,
      miningPremium: baseScenario.premium,
      miningPremiumPct: baseScenario.premiumPct,
      revenuePerMWh: baseScenario.revenuePerMWh,
      paybackYears: Math.round(paybackYears * 10) / 10,
      roi5Year: ((baseScenario.annualMiningRevenue * 5 - infrastructure.totalCapex) / infrastructure.totalCapex * 100),
    },
    miningDaysPerYear,
    miningHoursPerYear,
  };
}

// ─── 4. Generate Excel ─────────────────────────────────────────────────────

export async function generateMineSpecExcel(specs) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sangha Renewables';

  const G = '1A6B3C';   // brand green
  const D = '0D2818';   // dark
  const L = 'E8F5E9';   // light green
  const W = 'FFFFFF';

  const ws = wb.addWorksheet('Mine Specifications', {
    properties: { defaultColWidth: 18 },
  });
  ws.columns = [{ width: 30 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }];

  const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: G } };
  const darkFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: D } };
  const lightFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: L } };
  const whiteFont = { bold: true, color: { argb: W } };

  let r = 1;

  // ── Header ──
  ws.mergeCells(r, 1, r, 6);
  const hdr = ws.getCell(r, 1);
  hdr.value = 'SANGHA RENEWABLES — MINE SPECIFICATION REPORT';
  hdr.font = { bold: true, size: 16, color: { argb: W } };
  hdr.fill = greenFill;
  hdr.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 40;
  r++;

  ws.mergeCells(r, 1, r, 6);
  const sub = ws.getCell(r, 1);
  sub.value = `Prepared for: ${specs.site.name} | ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
  sub.font = { size: 11, color: { argb: W }, italic: true };
  sub.fill = darkFill;
  sub.alignment = { horizontal: 'center' };
  ws.getRow(r).height = 28;
  r += 2;

  // ── Helper: section header ──
  function sectionHeader(text) {
    ws.mergeCells(r, 1, r, 6);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { bold: true, size: 13, color: { argb: G } };
    c.border = { bottom: { style: 'thin', color: { argb: G } } };
    r++;
  }

  function tableHeaders(cols) {
    for (let i = 0; i < cols.length; i++) {
      const c = ws.getCell(r, i + 1);
      c.value = cols[i];
      c.font = { ...whiteFont, size: 11 };
      c.fill = greenFill;
      c.alignment = { horizontal: 'center' };
    }
    r++;
  }

  function kvRow(label, value) {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true, size: 11 };
    ws.getCell(r, 1).fill = lightFill;
    ws.mergeCells(r, 2, r, 3);
    ws.getCell(r, 2).value = value;
    ws.getCell(r, 2).font = { size: 11 };
    r++;
  }

  // ── Site Overview ──
  sectionHeader('SITE OVERVIEW');
  kvRow('Facility', specs.site.name);
  kvRow('Location', specs.site.location);
  kvRow('Generation Type', specs.site.type);
  kvRow('Nameplate Capacity', `${specs.site.capacityMW} MW`);
  kvRow('Annual Generation', `${specs.site.annualGenerationMWh.toLocaleString()} MWh`);
  kvRow('Generation Hours', `${specs.site.generationHours.toLocaleString()} hrs/year`);
  kvRow('Average Nodal Price', `$${specs.site.avgNodalPrice?.toFixed(2)}/MWh`);
  kvRow('Curtailment Rate', `${specs.site.curtailmentPct}%`);
  kvRow('Current Annual Grid Revenue', `$${specs.site.gridRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  r++;

  // ── Fleet Configuration ──
  sectionHeader('FLEET CONFIGURATION OPTIONS');
  tableHeaders(['Miner Model', 'Unit Count', 'Total Hashrate', 'Power Draw', 'Efficiency', 'Equipment Cost']);
  for (const f of specs.fleetOptions) {
    ws.getCell(r, 1).value = f.model;
    ws.getCell(r, 2).value = f.count.toLocaleString();
    ws.getCell(r, 3).value = `${f.hashratePH.toFixed(1)} PH/s`;
    ws.getCell(r, 4).value = `${f.powerMW.toFixed(1)} MW`;
    ws.getCell(r, 5).value = `${f.efficiency} J/TH`;
    ws.getCell(r, 6).value = `$${f.equipmentCost.toLocaleString()}`;
    for (let i = 1; i <= 6; i++) ws.getCell(r, i).alignment = { horizontal: 'center' };
    r++;
  }
  r++;

  // ── Revenue Analysis per fleet ──
  for (const fleet of specs.fleetOptions) {
    sectionHeader(`REVENUE ANALYSIS — ${fleet.model.toUpperCase()}`);
    tableHeaders(['Scenario', 'Hashprice', 'Annual Mining Rev.', 'Grid Revenue', 'Mining Premium', 'Premium %']);
    for (const s of fleet.scenarios) {
      ws.getCell(r, 1).value = `${s.label} Case`;
      ws.getCell(r, 2).value = `$${s.hashprice}/PH/day`;
      ws.getCell(r, 3).value = `$${Math.round(s.annualMiningRevenue).toLocaleString()}`;
      ws.getCell(r, 4).value = `$${Math.round(s.gridRevenue).toLocaleString()}`;
      ws.getCell(r, 5).value = `${s.premium >= 0 ? '+' : ''}$${Math.round(s.premium).toLocaleString()}`;
      ws.getCell(r, 6).value = `${s.premiumPct >= 0 ? '+' : ''}${s.premiumPct.toFixed(0)}%`;
      const clr = s.premium >= 0 ? '27AE60' : 'E74C3C';
      ws.getCell(r, 5).font = { color: { argb: clr }, bold: true };
      ws.getCell(r, 6).font = { color: { argb: clr }, bold: true };
      for (let i = 1; i <= 6; i++) ws.getCell(r, i).alignment = { horizontal: 'center' };
      r++;
    }
    // Revenue per MWh callout
    r++;
    const base = fleet.scenarios.find(s => s.label === 'Base');
    ws.getCell(r, 1).value = 'Mining Revenue per MWh (Base):';
    ws.getCell(r, 1).font = { bold: true, size: 11 };
    ws.getCell(r, 2).value = `$${base.revenuePerMWh.toFixed(2)}/MWh`;
    ws.getCell(r, 2).font = { bold: true, size: 12, color: { argb: '27AE60' } };
    ws.getCell(r, 3).value = `vs Grid: $${specs.site.avgNodalPrice?.toFixed(2)}/MWh`;
    ws.getCell(r, 3).font = { bold: true, size: 11 };
    const multiple = base.revenuePerMWh / (specs.site.avgNodalPrice || 1);
    ws.getCell(r, 4).value = `${multiple.toFixed(1)}x premium`;
    ws.getCell(r, 4).font = { bold: true, size: 12, color: { argb: '27AE60' } };
    r += 2;
  }

  // ── Infrastructure ──
  sectionHeader('INFRASTRUCTURE REQUIREMENTS (Recommended: S19 XP Fleet)');
  tableHeaders(['Item', 'Quantity', 'Estimated Cost']);
  const infra = specs.infrastructure;
  const infraRows = [
    ['Mining Containers (~200 miners/ea)', `${infra.containers} containers`, `$${infra.containerCost.toLocaleString()}`],
    ['Step-Down Transformers (2.5 MVA)', `${infra.transformers} units`, `$${infra.transformerCost.toLocaleString()}`],
    ['Networking & Controls', '—', `$${infra.networkingCost.toLocaleString()}`],
    ['Cooling Infrastructure', '—', `$${infra.coolingCost.toLocaleString()}`],
    ['Site Preparation', '—', `$${infra.sitePrepCost.toLocaleString()}`],
    ['Mining Equipment (S19 XP)', `${specs.fleetOptions[0].count.toLocaleString()} units`, `$${infra.equipmentCost.toLocaleString()}`],
  ];
  for (const [item, qty, cost] of infraRows) {
    ws.getCell(r, 1).value = item;
    ws.getCell(r, 2).value = qty;
    ws.getCell(r, 2).alignment = { horizontal: 'center' };
    ws.getCell(r, 3).value = cost;
    ws.getCell(r, 3).alignment = { horizontal: 'right' };
    r++;
  }
  // Total row
  ws.getCell(r, 1).value = 'TOTAL CAPITAL EXPENDITURE';
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  ws.getCell(r, 3).value = `$${infra.totalCapex.toLocaleString()}`;
  ws.getCell(r, 3).font = { bold: true, size: 12, color: { argb: G } };
  ws.getCell(r, 3).alignment = { horizontal: 'right' };
  for (let i = 1; i <= 3; i++) ws.getCell(r, i).fill = lightFill;
  r += 2;

  // ── Financial Summary ──
  sectionHeader('FINANCIAL SUMMARY (Base Case — $100/PH/day)');
  const fs = specs.financialSummary;
  kvRow('Annual Mining Revenue', `$${Math.round(fs.baseAnnualMiningRevenue).toLocaleString()}`);
  kvRow('Annual Grid Revenue (Alternative)', `$${Math.round(fs.gridRevenue).toLocaleString()}`);
  kvRow('Mining Premium over Grid', `+$${Math.round(fs.miningPremium).toLocaleString()} (+${fs.miningPremiumPct.toFixed(0)}%)`);
  kvRow('Mining Revenue per MWh', `$${fs.revenuePerMWh.toFixed(2)}/MWh`);
  kvRow('Total CapEx', `$${infra.totalCapex.toLocaleString()}`);
  kvRow('Simple Payback Period', `${fs.paybackYears} years`);
  kvRow('5-Year ROI', `${fs.roi5Year.toFixed(0)}%`);
  r += 2;

  // ── Disclaimer ──
  ws.mergeCells(r, 1, r, 6);
  const disc = ws.getCell(r, 1);
  disc.value = 'This analysis uses current hashprice scenarios and the generation data provided. Actual results will vary based on network difficulty, bitcoin price, equipment availability, and operational factors. Report valid for 30 days. Analysis powered by Sangha Renewables (sanghatool.com).';
  disc.font = { size: 9, italic: true, color: { argb: '666666' } };
  disc.alignment = { wrapText: true };
  ws.getRow(r).height = 40;

  // Save
  const safeName = (specs.site.name || 'IPP').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const filename = `Sangha_MineSpec_${safeName}_${Date.now()}.xlsx`;
  const filepath = join(SPECS_DIR, filename);
  await wb.xlsx.writeFile(filepath);

  return { filepath, filename };
}

// ─── 5. Process IPP Email ──────────────────────────────────────────────────

export async function processIppEmail({ messageId, threadId, from, fromName, subject, body, attachments }) {
  console.log(`[IPP Pipeline] Processing inquiry from ${fromName} <${from}>`);

  const data = parseIppData(body, attachments);

  // Need at least capacity or generation to run analysis
  if (!data.capacityMW && !data.annualGenerationMWh) {
    console.log(`[IPP Pipeline] Insufficient data — requesting more info`);
    await sendEmailWithAttachments({
      to: from,
      subject: `RE: ${subject}`,
      body: [
        `Hi ${(fromName || '').split(' ')[0] || 'there'},`,
        '',
        `Thank you for your interest in behind-the-meter mining. To generate a detailed mine specification report, we need the following:`,
        '',
        `- Facility capacity (MW)`,
        `- Annual generation (MWh)`,
        `- Average nodal price ($/MWh)`,
        `- Generation hours per year`,
        `- Location / ERCOT zone`,
        '',
        `You can include this in your reply or attach a CSV file with your generation data.`,
        '',
        `Best regards,`,
        `Coppice — Sangha Renewables`,
      ].join('\n'),
      attachments: [],
    });
    insertActivity({
      tenantId: TENANT_ID, type: 'in',
      title: `IPP Inquiry from ${fromName || from}`,
      subtitle: `${subject} — Requested additional data`,
      detailJson: JSON.stringify({ from, fromName, subject, dataParsed: data }),
      sourceType: 'email', sourceId: `ipp-${messageId}`, agentId: 'coppice',
    });
    return { status: 'need-data', messageId };
  }

  // Fill defaults for optional fields
  if (!data.avgNodalPrice) data.avgNodalPrice = 25;
  if (!data.annualGenerationMWh && data.capacityMW) {
    const cfMap = { Solar: 0.25, Wind: 0.35, 'Natural Gas': 0.85, Renewable: 0.30 };
    data.annualGenerationMWh = Math.round(data.capacityMW * 8760 * (cfMap[data.facilityType] || 0.30));
  }
  if (!data.capacityMW && data.annualGenerationMWh) {
    data.capacityMW = Math.round(data.annualGenerationMWh / 2200);
  }

  // Log IPP inquiry received
  insertActivity({
    tenantId: TENANT_ID, type: 'in',
    title: `IPP Inquiry from ${fromName || from}`,
    subtitle: `${data.capacityMW}MW ${data.facilityType} — ${data.annualGenerationMWh?.toLocaleString()} MWh/yr`,
    detailJson: JSON.stringify({ from, fromName, subject, data }),
    sourceType: 'email', sourceId: `ipp-${messageId}`, agentId: 'coppice',
  });

  // Calculate mine specs
  const specs = calculateMineSpecs(data);
  console.log(`[IPP Pipeline] Specs: ${specs.fleetOptions[0].count.toLocaleString()} miners, $${Math.round(specs.financialSummary.baseAnnualMiningRevenue).toLocaleString()}/yr`);

  // Log agent activity
  insertActivity({
    tenantId: TENANT_ID, type: 'agent',
    title: 'Mine Specification Generated',
    subtitle: `${specs.site.name} — ${specs.fleetOptions[0].hashratePH.toFixed(0)} PH/s, $${Math.round(specs.financialSummary.baseAnnualMiningRevenue).toLocaleString()}/yr`,
    detailJson: JSON.stringify({ specs: specs.financialSummary, fleet: specs.fleetOptions[0] }),
    sourceType: 'email', sourceId: `ipp-spec-${messageId}`, agentId: 'coppice',
  });

  // Generate Excel
  const { filepath, filename } = await generateMineSpecExcel(specs);
  console.log(`[IPP Pipeline] Excel: ${filename}`);

  // Compose reply
  const firstName = (fromName || '').split(' ')[0] || 'there';
  const fs = specs.financialSummary;
  const fleet = specs.fleetOptions[0];
  const replyBody = [
    `Hi ${firstName},`,
    '',
    `Thank you for sharing your generation data. We've run a full mine specification analysis for your ${specs.site.capacityMW}MW ${specs.site.type.toLowerCase()} facility.`,
    '',
    `Key highlights (Base Case — $100/PH/day):`,
    `  • Recommended fleet: ${fleet.count.toLocaleString()} ${fleet.model} miners`,
    `  • Total hashrate: ${fleet.hashratePH.toFixed(0)} PH/s`,
    `  • Annual mining revenue: $${Math.round(fs.baseAnnualMiningRevenue).toLocaleString()}`,
    `  • Current grid revenue: $${Math.round(fs.gridRevenue).toLocaleString()}`,
    `  • Mining premium: +$${Math.round(fs.miningPremium).toLocaleString()} (+${fs.miningPremiumPct.toFixed(0)}% over grid)`,
    `  • Mining rev/MWh: $${fs.revenuePerMWh.toFixed(2)} vs grid $${specs.site.avgNodalPrice?.toFixed(2)}/MWh`,
    `  • Simple payback: ${fs.paybackYears} years`,
    '',
    `The attached report includes detailed fleet configurations (S19 XP and S21), revenue projections across bull/base/bear scenarios, and full infrastructure requirements.`,
    '',
    `We'd be happy to schedule a call to walk through the analysis and discuss next steps.`,
    '',
    `Best regards,`,
    `Coppice — Sangha Renewables`,
  ].join('\n');

  await sendEmailWithAttachments({
    to: from,
    subject: `RE: ${subject} — Mine Specification Report`,
    body: replyBody,
    attachments: [{
      filename,
      path: filepath,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  });
  console.log(`[IPP Pipeline] Reply sent to ${from}`);

  // Log outbound
  insertActivity({
    tenantId: TENANT_ID, type: 'out',
    title: 'Mine Specification Sent',
    subtitle: `Replied to ${fromName || from} with ${filename}`,
    detailJson: JSON.stringify({ to: from, filename, specs: fs }),
    sourceType: 'email', sourceId: `ipp-reply-${messageId}`, agentId: 'coppice',
  });

  return { status: 'sent', messageId, specs, filename };
}
