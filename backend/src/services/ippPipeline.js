/**
 * IPP Mine Specification Pipeline
 *
 * Detects IPP (Independent Power Producer) inquiry emails,
 * parses generation data from body text or CSV attachments,
 * runs the exact PricingToolUSA Lambda logic (process_row) against
 * real ERCOT nodal + load LMP data, generates branded Excel report,
 * and replies with the attachment.
 *
 * Ported from: AWS Lambda PricingToolUSA (Python 3.14)
 * Data: nodal_8760.json — 8,760 hourly nodal + load LMP values
 * Zero LLM cost — all math + ExcelJS.
 */

import ExcelJS from 'exceljs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { insertActivity } from '../cache/database.js';
import { sendEmailWithAttachments } from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SPECS_DIR = join(__dirname, '../../data/mine-specs');
const NODAL_PATH = join(__dirname, '../../data/nodal_8760.json');

if (!existsSync(SPECS_DIR)) mkdirSync(SPECS_DIR, { recursive: true });

const TENANT_ID = 'default'; // Sangha tenant

// ─── Load ERCOT Nodal + Load LMP Data (8,760 hours) ────────────────────────

let NODAL_DATA = [];
try {
  NODAL_DATA = JSON.parse(readFileSync(NODAL_PATH, 'utf-8'));
  console.log(`[IPP Pipeline] Loaded ${NODAL_DATA.length} hours of nodal/load LMP data`);
} catch (err) {
  console.warn(`[IPP Pipeline] Could not load nodal data: ${err.message}`);
}

// ─── Economic Assumptions (exact match to PricingToolUSA Lambda) ────────────

const ECONOMIC_ASSUMPTIONS = {
  miner_floor_price: 5.00,       // $/MWh — minimum the miner pays
  import_burden: 11.00,          // $/MWh
  offtake_index: 'Node',         // 'Node' or 'Hub'
  import_hub: null,
  ipp_gen_price_floor: -27.50,   // $/MWh
  hashprice_usd_ph_day: 100.00,  // $/PH/day (Base scenario)
  miner_fleet_efficiency: 29.5,  // J/TH
  calc_strike_price: 141.24,     // $/MWh — VI break-even threshold
};

const MINE_SIZES = [10, 15, 20, 30, 45, 60, 75, 90, 105, 120, 135, 150];

// ─── Hashprice Scenarios ───────────────────────────────────────────────────

const HASHPRICE_SCENARIOS = {
  Best:  150,
  Base:  100,
  Worst:  60,
};

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
    hourlyGeneration: null, // 8760-element array if provided via CSV
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

  // Hourly generation format — 8760 rows with generation column
  const genCol = headers.findIndex(h =>
    h.includes('generation') || h.includes('gen') || h.includes('mwh') || h.includes('energy')
  );
  const priceCol = headers.findIndex(h => h.includes('price') || h.includes('nodal') || h.includes('$/mwh'));

  if (genCol >= 0 && lines.length > 100) {
    // Likely hourly data — extract generation array
    const hourlyGen = [];
    let totalMWh = 0;
    let weightedPrice = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(s => s.trim());
      const gen = parseFloat(cols[genCol]?.replace(/[,$]/g, ''));
      if (isNaN(gen)) { hourlyGen.push(0); continue; }
      hourlyGen.push(gen);
      totalMWh += gen;
      if (priceCol >= 0) {
        const price = parseFloat(cols[priceCol]?.replace(/[,$]/g, ''));
        if (!isNaN(price)) weightedPrice += price * gen;
      }
    }
    // If we got ~8760 rows, use as hourly generation
    if (hourlyGen.length >= 8000) {
      data.hourlyGeneration = hourlyGen.slice(0, 8760);
      // Pad to 8760 if needed
      while (data.hourlyGeneration.length < 8760) data.hourlyGeneration.push(0);
    }
    if (totalMWh > 0) data.annualGenerationMWh = totalMWh;
    if (weightedPrice > 0 && totalMWh > 0) data.avgNodalPrice = weightedPrice / totalMWh;
    return;
  }

  // Summary time-series (monthly/daily) — aggregate
  if (genCol >= 0) {
    let totalMWh = 0, weightedPrice = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(s => s.trim());
      const mwh = parseFloat(cols[genCol]?.replace(/[,$]/g, ''));
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

  const cap = t.match(/(\d[\d,.]*)\s*(?:MW|megawatt)/i);
  if (cap && !data.capacityMW) data.capacityMW = parseFloat(cap[1].replace(/,/g, ''));

  const gen = t.match(/([\d,]+(?:\.\d+)?)\s*MWh/i);
  if (gen && !data.annualGenerationMWh) data.annualGenerationMWh = parseFloat(gen[1].replace(/,/g, ''));

  const price = t.match(/\$\s*([\d,.]+)\s*(?:\/|\s*per\s*)MWh/i)
    || t.match(/nodal\s*price[:\s]*\$?\s*([\d,.]+)/i)
    || t.match(/average\s*(?:nodal\s*)?price[:\s]*\$?\s*([\d,.]+)/i);
  if (price && !data.avgNodalPrice) data.avgNodalPrice = parseFloat(price[1].replace(/,/g, ''));

  const gh = t.match(/generation\s*hours[:\s]*([\d,]+)/i) || t.match(/([\d,]+)\s*generation\s*hours/i);
  if (gh && !data.generationHours) data.generationHours = parseFloat(gh[1].replace(/,/g, ''));

  const oh = t.match(/operating\s*hours[:\s]*([\d,]+)/i);
  if (oh && !data.operatingHours) data.operatingHours = parseFloat(oh[1].replace(/,/g, ''));

  const curt = t.match(/curtailment[:\s]*([\d.]+)\s*%/i) || t.match(/([\d.]+)\s*%\s*curtailment/i);
  if (curt && !data.curtailmentPct) data.curtailmentPct = parseFloat(curt[1]);

  const loc = t.match(/(?:in|at|near|located\s+(?:in|at))\s+([A-Z][a-zA-Z\s,]+?(?:Texas|TX|California|CA|Oklahoma|OK|New Mexico|NM|Arizona|AZ))/i)
    || t.match(/ERCOT\s+([\w\s]+?)(?:\s+zone|\s+region|[.,\n])/i);
  if (loc && !data.location) data.location = loc[1].trim();

  const name = t.match(/(?:we(?:'re| are)\s+(?:a\s+)?)([\d\w\s]+(?:solar|wind|gas)\s*(?:farm|plant|facility|partners?))/i)
    || t.match(/our\s+([\w\s]+(?:solar|wind|gas)\s*(?:farm|plant|facility|partners?))/i)
    || t.match(/from\s+([\w\s]+(?:solar|wind|energy|power)\s*(?:partners?|llc|inc|corp)?)/i);
  if (name && !data.facilityName) data.facilityName = name[1].trim();
}

// ─── 3. PricingToolUSA Logic (exact port from Lambda) ──────────────────────

/**
 * process_row — exact port of PricingToolUSA/process_row
 * Runs for each hour, given a mine size and economic assumptions.
 */
function processRow(row, mineSize, assumptions) {
  const gen = row.gen || 0;
  const nodal = row.nodal || 0;
  const load = row.load || 0;
  const basis = nodal - load;

  // Offtake price
  const idx = assumptions.offtake_index;
  let offtakePrice;
  if (idx === 'Node') {
    offtakePrice = Math.max(assumptions.miner_floor_price, nodal);
  } else {
    offtakePrice = Math.max(assumptions.miner_floor_price, load);
  }

  // Offtake (MW)
  let offtake = 0;
  if (offtakePrice <= assumptions.calc_strike_price && gen > 0) {
    offtake = gen >= mineSize ? mineSize : gen;
  }

  // Import (MW) — power bought from grid when gen < mine size
  let imp = 0;
  if (load <= assumptions.calc_strike_price && offtake < mineSize) {
    imp = mineSize - offtake;
  }

  const mineConsumption = offtake + imp;
  const btmLmpCosts = offtake * offtakePrice;
  const importLmpCosts = imp * load;
  const mineLmpCosts = btmLmpCosts + importLmpCosts;
  const baseRev = Math.min(gen, offtake) * nodal;
  const offtakeRevenue = Math.max(offtake * offtakePrice, baseRev);
  const viRevenue = offtake * Math.max(assumptions.calc_strike_price, nodal);
  const blendedLmp = mineSize > 0
    ? (offtake / mineSize) * offtakePrice + (imp / mineSize) * load
    : 0;

  return {
    hour: row.hour,
    gen, nodal, load, basis,
    offtakePrice, offtake, import: imp,
    mineConsumption, btmLmpCosts, importLmpCosts, mineLmpCosts,
    baseRev, offtakeRevenue, viRevenue, blendedLmp,
  };
}

/**
 * buildHourlyData — merge IPP generation data with ERCOT nodal/load data
 * If IPP provides hourly gen, use it. Otherwise, synthesize from capacity + generation hours.
 */
function buildHourlyData(ippData) {
  const hours = [];

  if (ippData.hourlyGeneration && ippData.hourlyGeneration.length === 8760) {
    // IPP provided exact hourly generation
    for (let i = 0; i < 8760; i++) {
      const nodal = NODAL_DATA[i]?.nodal || 0;
      const load = NODAL_DATA[i]?.load || 0;
      hours.push({
        hour: i + 1,
        gen: ippData.hourlyGeneration[i],
        nodal,
        load,
      });
    }
    return hours;
  }

  // Synthesize hourly generation from summary data
  const capacity = ippData.capacityMW || 0;
  const annualGen = ippData.annualGenerationMWh || 0;
  const genHours = ippData.generationHours || (capacity > 0 ? annualGen / capacity : 2200);
  const type = (ippData.facilityType || '').toLowerCase();

  for (let i = 0; i < 8760; i++) {
    const hourOfDay = i % 24;
    const nodal = NODAL_DATA[i]?.nodal || 0;
    const load = NODAL_DATA[i]?.load || 0;

    let gen = 0;
    if (type === 'solar') {
      // Solar: generate during daylight hours (6am-7pm), peak at noon
      if (hourOfDay >= 6 && hourOfDay <= 19) {
        const peakFactor = 1 - Math.abs(hourOfDay - 12.5) / 7;
        gen = capacity * peakFactor * 0.85;
      }
    } else if (type === 'wind') {
      // Wind: somewhat random but higher at night, use simple pattern
      const windFactor = 0.25 + 0.15 * Math.sin((i / 8760) * Math.PI * 2 * 365)
        + (hourOfDay >= 18 || hourOfDay <= 6 ? 0.15 : 0);
      gen = capacity * Math.max(0, Math.min(1, windFactor));
    } else {
      // Gas/other: flat capacity factor
      const cf = annualGen / (capacity * 8760) || 0.5;
      gen = capacity * cf;
    }

    hours.push({ hour: i + 1, gen, nodal, load });
  }

  // Scale to match annual total
  const rawTotal = hours.reduce((s, h) => s + h.gen, 0);
  if (rawTotal > 0 && annualGen > 0) {
    const scale = annualGen / rawTotal;
    for (const h of hours) h.gen = h.gen * scale;
  }

  return hours;
}

/**
 * runPricingAnalysis — exact replica of PricingToolUSA lambda_handler
 * Runs mine size sensitivity analysis across all MINE_SIZES.
 */
export function runPricingAnalysis(ippData, scenario = 'Base') {
  const hourlyData = buildHourlyData(ippData);
  const hashprice = HASHPRICE_SCENARIOS[scenario] || 100;

  // Update assumptions with selected hashprice
  const assumptions = {
    ...ECONOMIC_ASSUMPTIONS,
    hashprice_usd_ph_day: hashprice,
  };

  let bestMineSize = null;
  let bestDealValue = -Infinity;
  let bestMetrics = {};
  const allResults = [];

  for (const mineSize of MINE_SIZES) {
    // Skip mine sizes larger than capacity
    if (ippData.capacityMW && mineSize > ippData.capacityMW * 1.5) continue;

    const results = hourlyData.map(row => processRow(row, mineSize, assumptions));
    const n = results.length;

    const ippRevenue = results.reduce((s, r) => s + r.baseRev, 0);
    const viRevenue = results.reduce((s, r) => s + r.viRevenue, 0);
    const offtakeRevenue = results.reduce((s, r) => s + r.offtakeRevenue, 0);
    const totalOfftake = results.reduce((s, r) => s + r.offtake, 0);
    const totalImport = results.reduce((s, r) => s + r.import, 0);
    const totalMineConsumption = results.reduce((s, r) => s + r.mineConsumption, 0);
    const totalBtmLmpCosts = results.reduce((s, r) => s + r.btmLmpCosts, 0);
    const totalMineLmpCosts = results.reduce((s, r) => s + r.mineLmpCosts, 0);
    const totalGen = hourlyData.reduce((s, r) => s + r.gen, 0);

    const dealValueVI = viRevenue - ippRevenue;
    const dealValueOfftake = offtakeRevenue - ippRevenue;

    // Avg blended LMP for the miner
    const avgBlendedLmp = totalMineConsumption > 0
      ? totalMineLmpCosts / totalMineConsumption
      : 0;

    // Mine uptime percentage
    const hoursRunning = results.filter(r => r.mineConsumption > 0).length;
    const mineUptimePct = (hoursRunning / 8760) * 100;

    const entry = {
      mine_size: mineSize,
      annual_btm_offtake_MWh: Math.round(totalOfftake),
      annual_import_MWh: Math.round(totalImport),
      mine_consumption_MWh: Math.round(totalMineConsumption),
      mine_uptime_pct: Math.round(mineUptimePct * 100) / 100,
      ipp_revenue_base: Math.round(ippRevenue),
      ipp_revenue_offtake: Math.round(offtakeRevenue),
      ipp_revenue_vi: Math.round(viRevenue),
      deal_value_offtake: Math.round(dealValueOfftake),
      deal_value_vi: Math.round(dealValueVI),
      deal_value_per_mwh_offtake: totalOfftake > 0 ? Math.round(dealValueOfftake / totalOfftake * 100) / 100 : 0,
      deal_value_per_mwh_vi: totalOfftake > 0 ? Math.round(dealValueVI / totalOfftake * 100) / 100 : 0,
      ipp_revenue_base_per_mwh: totalGen > 0 ? Math.round(ippRevenue / totalGen * 100) / 100 : 0,
      ipp_revenue_offtake_per_mwh: totalGen > 0 ? Math.round(offtakeRevenue / totalGen * 100) / 100 : 0,
      ipp_revenue_vi_per_mwh: totalGen > 0 ? Math.round(viRevenue / totalGen * 100) / 100 : 0,
      avg_blended_lmp: Math.round(avgBlendedLmp * 100) / 100,
      all_in_electricity_cost_miner: Math.round(avgBlendedLmp * 100) / 100,
    };
    allResults.push(entry);

    if (dealValueVI > bestDealValue) {
      bestDealValue = dealValueVI;
      bestMineSize = mineSize;
      bestMetrics = entry;
    }
  }

  return {
    scenario,
    hashprice,
    bestMineSize,
    bestDealValue: Math.round(bestDealValue),
    bestMetrics,
    allResults,
    totalGeneration: Math.round(hourlyData.reduce((s, r) => s + r.gen, 0)),
    capacityMW: ippData.capacityMW,
  };
}

// ─── 4. Generate Excel ─────────────────────────────────────────────────────

export async function generateMineSpecExcel(analysis, ippData) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sangha Renewables';

  const G = '1A6B3C';
  const D = '0D2818';
  const L = 'E8F5E9';
  const W = 'FFFFFF';
  const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: G } };
  const darkFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: D } };
  const lightFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: L } };
  const whiteFont = { bold: true, color: { argb: W } };

  const ws = wb.addWorksheet('Mine Specifications', {
    properties: { defaultColWidth: 18 },
  });
  ws.columns = [{ width: 32 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }];

  let r = 1;

  // ── Helpers ──
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

  const fmt = (n) => `$${Math.round(n).toLocaleString()}`;
  const fmtD = (n) => `$${n.toFixed(2)}`;

  // ── Header ──
  ws.mergeCells(r, 1, r, 6);
  const hdr = ws.getCell(r, 1);
  hdr.value = 'SANGHA RENEWABLES — MINE SPECIFICATION REPORT';
  hdr.font = { bold: true, size: 16, color: { argb: W } };
  hdr.fill = greenFill;
  hdr.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 40;
  r++;

  const siteName = ippData.facilityName || `${ippData.capacityMW}MW ${ippData.facilityType} Facility`;
  ws.mergeCells(r, 1, r, 6);
  const sub = ws.getCell(r, 1);
  sub.value = `Prepared for: ${siteName} | ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} | Scenario: ${analysis.scenario} ($${analysis.hashprice}/PH/day)`;
  sub.font = { size: 11, color: { argb: W }, italic: true };
  sub.fill = darkFill;
  sub.alignment = { horizontal: 'center' };
  ws.getRow(r).height = 28;
  r += 2;

  // ── Site Overview ──
  sectionHeader('SITE OVERVIEW');
  kvRow('Facility', siteName);
  kvRow('Location', ippData.location || 'Not specified');
  kvRow('Generation Type', ippData.facilityType);
  kvRow('Nameplate Capacity', `${ippData.capacityMW} MW`);
  kvRow('Annual Generation', `${(ippData.annualGenerationMWh || analysis.totalGeneration).toLocaleString()} MWh`);
  kvRow('Generation Hours', `${(ippData.generationHours || 0).toLocaleString()} hrs/year`);
  kvRow('Curtailment Rate', `${ippData.curtailmentPct || 0}%`);
  kvRow('Hashprice Scenario', `${analysis.scenario} — $${analysis.hashprice}/PH/day`);
  r++;

  // ── Winner Summary (KPIs) ──
  const w = analysis.bestMetrics;
  sectionHeader(`OPTIMAL CONFIGURATION — ${analysis.bestMineSize} MW MINE`);
  kvRow('Best Mine Size', `${analysis.bestMineSize} MW`);
  kvRow('Annual BTM Offtake', `${w.annual_btm_offtake_MWh?.toLocaleString()} MWh`);
  kvRow('Mine Uptime', `${w.mine_uptime_pct}%`);
  kvRow('IPP Revenue (Grid Only)', fmt(w.ipp_revenue_base));
  kvRow('IPP Revenue (Miner Offtake)', fmt(w.ipp_revenue_offtake));
  kvRow('IPP Revenue (Vertical Integration)', fmt(w.ipp_revenue_vi));
  kvRow('Deal Value — Miner Offtake', fmt(w.deal_value_offtake));
  kvRow('Deal Value — Vertical Integration', fmt(w.deal_value_vi));
  kvRow('Deal Value $/MWh (VI)', fmtD(w.deal_value_per_mwh_vi));
  kvRow('Avg Blended LMP (Miner)', fmtD(w.avg_blended_lmp));
  r++;

  // ── Offer Type Comparison ──
  sectionHeader('OFFER TYPE COMPARISON');
  tableHeaders(['Metric', 'Grid Only (Base)', 'Miner Offtake', 'Vertical Integration']);
  const compRows = [
    ['IPP Revenue ($/MWh)', fmtD(w.ipp_revenue_base_per_mwh), fmtD(w.ipp_revenue_offtake_per_mwh), fmtD(w.ipp_revenue_vi_per_mwh)],
    ['IPP Revenue (Total)', fmt(w.ipp_revenue_base), fmt(w.ipp_revenue_offtake), fmt(w.ipp_revenue_vi)],
    ['Deal Value (Total)', '—', fmt(w.deal_value_offtake), fmt(w.deal_value_vi)],
    ['Deal Value ($/MWh)', '—', fmtD(w.deal_value_per_mwh_offtake), fmtD(w.deal_value_per_mwh_vi)],
  ];
  for (const row of compRows) {
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 1).font = { bold: true };
    for (let i = 1; i < row.length; i++) {
      ws.getCell(r, i + 1).value = row[i];
      ws.getCell(r, i + 1).alignment = { horizontal: 'center' };
    }
    // Highlight VI column
    ws.getCell(r, 4).font = { bold: true, color: { argb: '27AE60' } };
    r++;
  }
  r++;

  // ── Mine Size Sensitivity ──
  sectionHeader('MINE SIZE SENSITIVITY ANALYSIS');
  tableHeaders(['Mine Size (MW)', 'BTM Offtake (MWh)', 'Deal Value — Total', 'Deal Value $/MWh', 'VI Revenue $/MWh', 'Uptime %']);
  for (const res of analysis.allResults) {
    const isBest = res.mine_size === analysis.bestMineSize;
    ws.getCell(r, 1).value = `${res.mine_size} MW${isBest ? '  ★ BEST' : ''}`;
    ws.getCell(r, 1).font = isBest ? { bold: true, color: { argb: '27AE60' } } : {};
    ws.getCell(r, 2).value = res.annual_btm_offtake_MWh.toLocaleString();
    ws.getCell(r, 3).value = fmt(res.deal_value_vi);
    ws.getCell(r, 4).value = fmtD(res.deal_value_per_mwh_vi);
    ws.getCell(r, 5).value = fmtD(res.ipp_revenue_vi_per_mwh);
    ws.getCell(r, 6).value = `${res.mine_uptime_pct}%`;
    for (let i = 1; i <= 6; i++) ws.getCell(r, i).alignment = { horizontal: 'center' };
    if (isBest) {
      for (let i = 1; i <= 6; i++) ws.getCell(r, i).fill = lightFill;
    }
    r++;
  }
  r++;

  // ── Economic Assumptions ──
  sectionHeader('ECONOMIC ASSUMPTIONS');
  kvRow('Miner Floor Price', `$${ECONOMIC_ASSUMPTIONS.miner_floor_price.toFixed(2)}/MWh`);
  kvRow('Offtake Index', ECONOMIC_ASSUMPTIONS.offtake_index);
  kvRow('Calc Strike Price', `$${ECONOMIC_ASSUMPTIONS.calc_strike_price.toFixed(2)}/MWh`);
  kvRow('Hashprice', `$${analysis.hashprice}/PH/day`);
  kvRow('Fleet Efficiency', `${ECONOMIC_ASSUMPTIONS.miner_fleet_efficiency} J/TH`);
  kvRow('IPP Gen Price Floor', `$${ECONOMIC_ASSUMPTIONS.ipp_gen_price_floor.toFixed(2)}/MWh`);
  r += 2;

  // ── Disclaimer ──
  ws.mergeCells(r, 1, r, 6);
  const disc = ws.getCell(r, 1);
  disc.value = 'This analysis uses actual ERCOT nodal + load zone LMP data and the Sangha Renewables pricing engine (sanghatool.com). Results are indicative and subject to network difficulty, bitcoin price, equipment availability, and operational factors. Report valid for 30 days.';
  disc.font = { size: 9, italic: true, color: { argb: '666666' } };
  disc.alignment = { wrapText: true };
  ws.getRow(r).height = 40;

  // Save
  const safeName = (siteName).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const filename = `Sangha_MineSpec_${safeName}_${Date.now()}.xlsx`;
  const filepath = join(SPECS_DIR, filename);
  await wb.xlsx.writeFile(filepath);

  return { filepath, filename };
}

// ─── 5. Process IPP Email ──────────────────────────────────────────────────

export async function processIppEmail({ messageId, threadId, from, fromName, subject, body, attachments }) {
  console.log(`[IPP Pipeline] Processing inquiry from ${fromName} <${from}>`);

  const data = parseIppData(body, attachments);

  if (!data.capacityMW && !data.annualGenerationMWh) {
    console.log(`[IPP Pipeline] Insufficient data — requesting more info`);
    await sendEmailWithAttachments({
      to: from,
      subject: `RE: ${subject}`,
      body: [
        `Hi ${(fromName || '').split(' ')[0] || 'there'},`,
        '',
        `Thank you for your interest in behind-the-meter mining. To generate a detailed mine specification report, we need at minimum:`,
        '',
        `- Facility capacity (MW)`,
        `- Annual generation (MWh) — or attach a CSV with 8,760 hourly generation values`,
        `- Location / ERCOT zone`,
        '',
        `For the most accurate analysis, provide hourly generation data (8,760 rows) as a CSV.`,
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

  // Fill defaults
  if (!data.annualGenerationMWh && data.capacityMW) {
    const cfMap = { Solar: 0.25, Wind: 0.35, 'Natural Gas': 0.85, Renewable: 0.30 };
    data.annualGenerationMWh = Math.round(data.capacityMW * 8760 * (cfMap[data.facilityType] || 0.30));
  }
  if (!data.capacityMW && data.annualGenerationMWh) {
    data.capacityMW = Math.round(data.annualGenerationMWh / 2200);
  }
  if (!data.generationHours && data.capacityMW && data.annualGenerationMWh) {
    data.generationHours = Math.round(data.annualGenerationMWh / data.capacityMW);
  }

  // Log inquiry received
  insertActivity({
    tenantId: TENANT_ID, type: 'in',
    title: `IPP Inquiry from ${fromName || from}`,
    subtitle: `${data.capacityMW}MW ${data.facilityType} — ${data.annualGenerationMWh?.toLocaleString()} MWh/yr`,
    detailJson: JSON.stringify({ from, fromName, subject, data }),
    sourceType: 'email', sourceId: `ipp-${messageId}`, agentId: 'coppice',
  });

  // Run pricing analysis for all 3 scenarios
  const baseAnalysis = runPricingAnalysis(data, 'Base');
  const bestAnalysis = runPricingAnalysis(data, 'Best');
  const worstAnalysis = runPricingAnalysis(data, 'Worst');

  const w = baseAnalysis.bestMetrics;
  console.log(`[IPP Pipeline] Best mine size: ${baseAnalysis.bestMineSize}MW, Deal value (VI): $${baseAnalysis.bestDealValue.toLocaleString()}`);

  // Log agent activity
  insertActivity({
    tenantId: TENANT_ID, type: 'agent',
    title: 'Mine Specification Generated',
    subtitle: `${baseAnalysis.bestMineSize}MW optimal — Deal value $${baseAnalysis.bestDealValue.toLocaleString()} (VI)`,
    detailJson: JSON.stringify({
      bestMineSize: baseAnalysis.bestMineSize,
      dealValueVI: baseAnalysis.bestDealValue,
      scenarioResults: {
        best: { bestMineSize: bestAnalysis.bestMineSize, dealValue: bestAnalysis.bestDealValue },
        base: { bestMineSize: baseAnalysis.bestMineSize, dealValue: baseAnalysis.bestDealValue },
        worst: { bestMineSize: worstAnalysis.bestMineSize, dealValue: worstAnalysis.bestDealValue },
      },
    }),
    sourceType: 'email', sourceId: `ipp-spec-${messageId}`, agentId: 'coppice',
  });

  // Generate Excel (base scenario)
  const { filepath, filename } = await generateMineSpecExcel(baseAnalysis, data);
  console.log(`[IPP Pipeline] Excel: ${filename}`);

  // Compose reply
  const firstName = (fromName || '').split(' ')[0] || 'there';
  const replyBody = [
    `Hi ${firstName},`,
    '',
    `Thank you for sharing your generation data. We've run a full mine specification analysis for your ${data.capacityMW}MW ${data.facilityType.toLowerCase()} facility using our pricing engine with actual ERCOT nodal data.`,
    '',
    `Key findings (Base Case — $100/PH/day):`,
    `  • Optimal mine size: ${baseAnalysis.bestMineSize} MW`,
    `  • Annual BTM offtake: ${w.annual_btm_offtake_MWh?.toLocaleString()} MWh`,
    `  • IPP revenue (grid only): ${fmt(w.ipp_revenue_base)}`,
    `  • IPP revenue (vertical integration): ${fmt(w.ipp_revenue_vi)}`,
    `  • Deal value (VI): ${fmt(w.deal_value_vi)} (+${fmtD(w.deal_value_per_mwh_vi)}/MWh)`,
    `  • Mine uptime: ${w.mine_uptime_pct}%`,
    '',
    `The attached report includes the full mine size sensitivity analysis (${MINE_SIZES.filter(m => !data.capacityMW || m <= data.capacityMW * 1.5).join(', ')} MW), offer type comparison (Grid vs Offtake vs Vertical Integration), and economic assumptions.`,
    '',
    `We'd be happy to schedule a call to walk through the analysis. We can also run additional scenarios at different hashprice levels.`,
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
    subtitle: `Replied to ${fromName || from} — ${baseAnalysis.bestMineSize}MW optimal, $${baseAnalysis.bestDealValue.toLocaleString()} deal value`,
    detailJson: JSON.stringify({ to: from, filename, bestMineSize: baseAnalysis.bestMineSize, dealValue: baseAnalysis.bestDealValue }),
    sourceType: 'email', sourceId: `ipp-reply-${messageId}`, agentId: 'coppice',
  });

  return { status: 'sent', messageId, analysis: baseAnalysis, filename };
}

// ─── 6. Exported for chat tool ─────────────────────────────────────────────
// runPricingAnalysis and generateMineSpecExcel are already exported above
