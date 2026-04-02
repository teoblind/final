/**
 * IPP Mine Specification Pipeline
 *
 * Detects IPP (Independent Power Producer) inquiry emails,
 * parses generation data from body text or CSV attachments,
 * runs the exact PricingToolUSA Lambda logic against
 * real ERCOT nodal + load LMP data, generates branded Excel report,
 * and replies with the attachment.
 *
 * Ported from: AWS Lambda PricingToolUSA (Python 3.14)
 *   - lambda_function.py  (lambda_handler, process_row, summarize, annualize, calculate_strike_price)
 *   - calculations.py     (process_row, safe_json_number)
 *   - winner.py           (summarize, annualize)
 *
 * Data: nodal_8760.json - 8,760 hourly nodal + load LMP values
 * Zero LLM cost - all math + ExcelJS.
 */

import ExcelJS from 'exceljs';
import Anthropic from '@anthropic-ai/sdk';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { insertActivity, getTenantDb } from '../cache/database.js';
import { sendEmailWithAttachments, textToHtml } from './emailService.js';
import { processKnowledgeEntry } from './knowledgeProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SPECS_DIR = join(__dirname, '../../data/mine-specs');
const NODAL_PATH = join(__dirname, '../../data/nodal_correct.json');

if (!existsSync(SPECS_DIR)) mkdirSync(SPECS_DIR, { recursive: true });

const DEFAULT_TENANT_ID = 'sangha-renewables'; // Sangha tenant

// ─── Load ERCOT Nodal + Load LMP Data ────────────────────────────────────────

let NODAL_DATA = [];
try {
  NODAL_DATA = JSON.parse(readFileSync(NODAL_PATH, 'utf-8'));
  console.log(`[IPP Pipeline] Loaded ${NODAL_DATA.length} hours of nodal/load LMP data`);
} catch (err) {
  console.warn(`[IPP Pipeline] Could not load nodal data: ${err.message}`);
}

// ─── Utility Functions (exact match to Lambda) ───────────────────────────────

/**
 * safe_json_number - safely convert any value to float, 0.0 for invalid.
 * Matches Lambda: safe_json_number()
 */
function safeJsonNumber(x, def = 0) {
  if (x === null || x === undefined) return def;
  const f = Number(x);
  if (!Number.isFinite(f)) return def;
  return f;
}

/**
 * annualize - convert multi-period sum to annual equivalent.
 * KEY FIX from Lambda: uses actual hour count, not hardcoded 8760.
 * Matches Excel: COUNT(tblHourly[Hour]) dynamically.
 */
function annualize(total, actualHours) {
  if (actualHours === 0) return 0;
  return (total / actualHours) * 8760;
}

/**
 * calculate_strike_price - breakeven electricity price from mining economics.
 * Formula: (hashprice / TH_per_PH / hr_per_day) / (efficiency / W_per_MW)
 * Matches Excel: =(Hashprice / 1000 / 24) / (Efficiency / 1000000)
 */
function calculateStrikePrice(hashprice, efficiencyWTh) {
  const TH_PER_PH = 1000;
  const HR_PER_DAY = 24;
  const W_PER_MW = 1_000_000;
  if (efficiencyWTh === 0) return 0;
  return (hashprice / TH_PER_PH / HR_PER_DAY) / (efficiencyWTh / W_PER_MW);
}

// ─── Default Economic Parameters ─────────────────────────────────────────────

const DEFAULT_ECON = {
  miner_floor_price: 5.00,       // $/MWh - minimum the miner pays
  import_burden: 11.00,          // $/MWh - burden on imported power
  offtake_index: 'Node',         // 'Node' or 'Hub'
  hashprice: 100.00,             // $/PH/day (Base scenario)
  efficiency: 29.5,              // W/TH (miner fleet)
};

const MINE_SIZES = [10, 15, 20, 30, 45, 60, 75, 90, 105, 120, 135, 150];

// Format helpers (used in Excel + email reply)
const fmt = (n) => `$${Math.round(n).toLocaleString()}`;
const fmtD = (n) => `$${(n || 0).toFixed(2)}`;

const HASHPRICE_SCENARIOS = {
  Best:  150,
  Base:  100,
  Worst:  60,
};

// ─── 1. IPP Email Detection ──────────────────────────────────────────────────

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

// ─── 2. Parse IPP Data ───────────────────────────────────────────────────────

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
    hourlyGeneration: null,
  };

  const csv = attachments.find(a =>
    a.filename?.toLowerCase().endsWith('.csv') || a.mimeType === 'text/csv'
  );
  if (csv?.content) parseCSV(csv.content, data);
  parseEmailBody(body, data);

  if (data.capacityMW && data.annualGenerationMWh && !data.generationHours) {
    data.generationHours = Math.round(data.annualGenerationMWh / data.capacityMW);
  }
  if (!data.operatingHours) data.operatingHours = 8760;
  if (!data.curtailmentPct) data.curtailmentPct = 0;

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

  // Hourly generation format
  const genCol = headers.findIndex(h =>
    h.includes('generation') || h.includes('gen') || h.includes('mwh') || h.includes('energy')
  );
  const priceCol = headers.findIndex(h => h.includes('price') || h.includes('nodal') || h.includes('$/mwh'));

  if (genCol >= 0 && lines.length > 100) {
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
    if (hourlyGen.length >= 8000) {
      data.hourlyGeneration = hourlyGen;
    }
    if (totalMWh > 0) data.annualGenerationMWh = totalMWh;
    if (weightedPrice > 0 && totalMWh > 0) data.avgNodalPrice = weightedPrice / totalMWh;
    return;
  }

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

// ─── 3. PricingToolUSA Logic (exact port from Lambda) ────────────────────────

/**
 * processRow - exact port of calculations.py process_row
 *
 * Excel formulas from tblHourly:
 *   Offtake Price: IF(Index="Node", MAX(Nodal, Floor), MAX(Load, Floor))
 *   Offtake:       IF(Price>Strike, 0, IF(Gen<=0, 0, MIN(Gen, MineSize)))
 *   Import:        IF(Load>Strike, 0, IF(Offtake<MineSize, MineSize-Offtake, 0))
 *   Base Rev:      MIN(Gen, Offtake) * Nodal
 *   VI Rev:        Offtake * MAX(Strike, Nodal)
 */
function processRow(row, mineSize, econ) {
  const gen = safeJsonNumber(row.gen);
  const nodal = safeJsonNumber(row.nodal);
  const load = safeJsonNumber(row.load);

  const strike = econ.calc_strike_price;
  const floor = econ.miner_floor_price;
  const idx = econ.offtake_index;

  const basis = nodal - load;

  // Offtake price: max of (index price, floor price)
  let offtakePrice;
  if (idx === 'Node') {
    offtakePrice = Math.max(nodal, floor);
  } else if (idx === 'Hub') {
    offtakePrice = Math.max(load, floor);
  } else {
    offtakePrice = floor;
  }

  // Offtake: curtail if price > strike, otherwise min(gen, mine_size)
  let offtake;
  if (offtakePrice > strike) {
    offtake = 0;
  } else if (gen <= 0) {
    offtake = 0;
  } else {
    offtake = Math.min(gen, mineSize);
  }

  // Import: grid power when BTM generation insufficient
  let imp;
  if (load > strike) {
    imp = 0;
  } else if (offtake < mineSize) {
    imp = mineSize - offtake;
  } else {
    imp = 0;
  }

  const mineConsumption = offtake + imp;
  const btmLmpCosts = offtake * offtakePrice;
  const importLmpCosts = imp * load;
  const mineLmpCosts = btmLmpCosts + importLmpCosts;
  const baseRevenue = Math.min(gen, offtake) * nodal;
  const offtakeRevenue = Math.max(offtake * offtakePrice, baseRevenue);
  const viRevenue = offtake * Math.max(strike, nodal);
  const importCost = imp * econ.import_burden;
  const blendedLmp = mineSize > 0
    ? (offtake / mineSize) * offtakePrice + (imp / mineSize) * load
    : 0;

  return {
    gen, nodal, load, basis,
    offtakePrice, offtake, import: imp,
    mineConsumption, btmLmpCosts, importLmpCosts, mineLmpCosts,
    baseRevenue, offtakeRevenue, viRevenue, importCost, blendedLmp,
  };
}

/**
 * summarize - exact port of winner.py summarize
 * Generates full winner summary for the optimal mine size.
 */
function summarize(rows, mineSize, econ) {
  if (!rows || !rows.length || !mineSize) return null;

  const totalHourCount = rows.length;
  const importBurden = econ.import_burden;

  const results = rows.map(r => processRow(r, mineSize, econ));

  // Aggregate totals
  const totalOfftake = results.reduce((s, r) => s + r.offtake, 0);
  const totalImport = results.reduce((s, r) => s + r.import, 0);
  const totalBaseRev = results.reduce((s, r) => s + r.baseRevenue, 0);
  const totalOfftakeRev = results.reduce((s, r) => s + r.offtakeRevenue, 0);
  const totalViRev = results.reduce((s, r) => s + r.viRevenue, 0);
  const totalBtmLmpCosts = results.reduce((s, r) => s + r.btmLmpCosts, 0);
  const totalImportLmpCosts = results.reduce((s, r) => s + r.importLmpCosts, 0);
  const totalMineLmpCosts = results.reduce((s, r) => s + r.mineLmpCosts, 0);
  const totalMineConsumption = results.reduce((s, r) => s + r.mineConsumption, 0);
  const totalImportCost = results.reduce((s, r) => s + r.importCost, 0);
  const totalPriceWeighted = results.reduce((s, r) => s + r.offtake * r.offtakePrice, 0);

  // Annualize values
  const annualBtmOfftake = annualize(totalOfftake, totalHourCount);
  const annualImport = annualize(totalImport, totalHourCount);
  const annualElecConsumption = annualize(totalOfftake + totalImport, totalHourCount);

  // Base case
  const ippRevBaseDollar = annualize(totalBaseRev, totalHourCount);
  const ippRevBaseMwh = annualBtmOfftake > 0 ? ippRevBaseDollar / annualBtmOfftake : 0;

  // Miner offtake case
  const ippRevOfftakeDollar = annualize(totalOfftakeRev, totalHourCount);
  const ippRevOfftakeMwh = annualBtmOfftake > 0 ? ippRevOfftakeDollar / annualBtmOfftake : 0;

  // Vertical integration case
  const ippRevViDollar = annualize(totalViRev, totalHourCount);
  const ippRevViMwh = annualBtmOfftake > 0 ? ippRevViDollar / annualBtmOfftake : 0;

  // Deal values
  const dealValueDollarVi = ippRevViDollar - ippRevBaseDollar;
  const dealValueMwhVi = ippRevViMwh - ippRevBaseMwh;
  const dealValueDollarOfftake = ippRevOfftakeDollar - ippRevBaseDollar;
  const dealValueMwhOfftake = ippRevOfftakeMwh - ippRevBaseMwh;

  // Uptime: annual consumption / (mine_size * 8760) - capacity factor
  const maxTheoreticalConsumption = mineSize * 8760;
  const uptimePct = maxTheoreticalConsumption > 0 ? (annualElecConsumption / maxTheoreticalConsumption) * 100 : 0;

  // Avg blended LMP: total costs / total consumption (already a ratio, not annualized)
  const avgBlendedLmp = totalMineConsumption > 0 ? totalMineLmpCosts / totalMineConsumption : 0;

  // Avg blended price (weighted average offtake price)
  const avgBlendedPrice = totalOfftake > 0 ? totalPriceWeighted / totalOfftake : 0;

  // All-in electricity cost
  const allInElectricityCost = avgBlendedLmp + importBurden;

  // BTM and import cost per MWh
  const btmLmpCostsPerMwh = annualBtmOfftake > 0 ? annualize(totalBtmLmpCosts, totalHourCount) / annualBtmOfftake : 0;
  const importLmpCostsPerMwh = annualImport > 0 ? annualize(totalImportLmpCosts, totalHourCount) / annualImport : 0;

  // Curtailment hours
  const curtailmentHours = results.filter(r => r.offtake === 0 && r.gen > 0).length;

  return {
    mine_size_MW: mineSize,
    total_hours_processed: totalHourCount,
    annual_btm_offtake_MWh: Math.round(annualBtmOfftake * 100) / 100,
    annual_import_MWh: Math.round(annualImport * 100) / 100,
    annual_electricity_consumption_MWh: Math.round(annualElecConsumption * 100) / 100,
    uptime_pct: Math.round(uptimePct * 100) / 100,
    avg_blended_lmp: Math.round(avgBlendedLmp * 100) / 100,
    avg_blended_price: Math.round(avgBlendedPrice * 100) / 100,
    all_in_electricity_cost_miner: Math.round(allInElectricityCost * 100) / 100,
    btm_lmp_costs_per_mwh: Math.round(btmLmpCostsPerMwh * 100) / 100,
    import_lmp_costs_per_mwh: Math.round(importLmpCostsPerMwh * 100) / 100,
    curtailment_hours: curtailmentHours,

    ipp_revenue_base_dollar: Math.round(ippRevBaseDollar * 100) / 100,
    ipp_revenue_base_mwh: Math.round(ippRevBaseMwh * 100) / 100,
    ipp_revenue_offtake_dollar: Math.round(ippRevOfftakeDollar * 100) / 100,
    ipp_revenue_offtake_mwh: Math.round(ippRevOfftakeMwh * 100) / 100,
    ipp_revenue_vi_dollar: Math.round(ippRevViDollar * 100) / 100,
    ipp_revenue_vi_mwh: Math.round(ippRevViMwh * 100) / 100,

    deal_value_offtake_dollar: Math.round(dealValueDollarOfftake * 100) / 100,
    deal_value_offtake_mwh: Math.round(dealValueMwhOfftake * 100) / 100,
    deal_value_vi_dollar: Math.round(dealValueDollarVi * 100) / 100,
    deal_value_vi_mwh: Math.round(dealValueMwhVi * 100) / 100,

    annual_import_cost_dollar: Math.round(annualize(totalImportCost, totalHourCount) * 100) / 100,
  };
}

/**
 * buildHourlyData - merge IPP generation data with ERCOT nodal/load data.
 * If IPP provides hourly gen, use it. Otherwise, synthesize from capacity.
 */
function buildHourlyData(ippData) {
  const nodalLen = NODAL_DATA.length || 8760;

  if (ippData.hourlyGeneration && ippData.hourlyGeneration.length >= 8000) {
    // IPP provided hourly generation - use it, match length to nodal data
    const len = Math.min(ippData.hourlyGeneration.length, nodalLen);
    const hours = [];
    for (let i = 0; i < len; i++) {
      hours.push({
        hour: i + 1,
        gen: safeJsonNumber(ippData.hourlyGeneration[i]),
        nodal: safeJsonNumber(NODAL_DATA[i]?.nodal),
        load: safeJsonNumber(NODAL_DATA[i]?.load),
      });
    }
    return hours;
  }

  // Synthesize hourly generation from summary data
  const capacity = ippData.capacityMW || 0;
  const annualGen = ippData.annualGenerationMWh || 0;
  const type = (ippData.facilityType || '').toLowerCase();
  const hours = [];

  for (let i = 0; i < nodalLen; i++) {
    const hourOfDay = i % 24;
    const nodal = safeJsonNumber(NODAL_DATA[i]?.nodal);
    const load = safeJsonNumber(NODAL_DATA[i]?.load);

    let gen = 0;
    if (type === 'solar') {
      if (hourOfDay >= 6 && hourOfDay <= 19) {
        const peakFactor = 1 - Math.abs(hourOfDay - 12.5) / 7;
        gen = capacity * peakFactor * 0.85;
      }
    } else if (type === 'wind') {
      const windFactor = 0.25 + 0.15 * Math.sin((i / 8760) * Math.PI * 2 * 365)
        + (hourOfDay >= 18 || hourOfDay <= 6 ? 0.15 : 0);
      gen = capacity * Math.max(0, Math.min(1, windFactor));
    } else {
      const cf = annualGen / (capacity * 8760) || 0.5;
      gen = capacity * cf;
    }

    hours.push({ hour: i + 1, gen, nodal, load });
  }

  // Scale to match annual total (annualized)
  const rawTotal = hours.reduce((s, h) => s + h.gen, 0);
  if (rawTotal > 0 && annualGen > 0) {
    // Scale so annualized generation matches target
    const targetTotal = annualGen * (nodalLen / 8760);
    const scale = targetTotal / rawTotal;
    for (const h of hours) h.gen = h.gen * scale;
  }

  return hours;
}

/**
 * runPricingAnalysis - exact replica of PricingToolUSA lambda_handler.
 * Runs mine size sensitivity analysis across all MINE_SIZES.
 * Optimizes by deal_value_per_mwh (not total), matching Lambda logic.
 */
export function runPricingAnalysis(ippData, scenario = 'Base') {
  const hourlyData = buildHourlyData(ippData);
  const hashprice = HASHPRICE_SCENARIOS[scenario] || 100;
  const efficiency = DEFAULT_ECON.efficiency;

  // Dynamic strike price from hashprice + efficiency
  const strikePrice = calculateStrikePrice(hashprice, efficiency);

  const econ = {
    miner_floor_price: DEFAULT_ECON.miner_floor_price,
    offtake_index: DEFAULT_ECON.offtake_index,
    calc_strike_price: strikePrice,
    import_burden: DEFAULT_ECON.import_burden,
  };

  const totalHourCount = hourlyData.length;

  // Check all generation isn't zero
  if (hourlyData.every(r => safeJsonNumber(r.gen) === 0)) {
    return { error: 'All generation values are zero', scenario, hashprice };
  }

  let bestMineSize = null;
  let bestDealValuePerMwh = -Infinity;
  let bestQuickMetrics = {};
  const allResults = [];

  for (const mineSize of MINE_SIZES) {
    if (ippData.capacityMW && mineSize > ippData.capacityMW * 1.5) continue;

    const results = hourlyData.map(row => processRow(row, mineSize, econ));

    const totalOfftake = results.reduce((s, r) => s + r.offtake, 0);
    const totalBaseRev = results.reduce((s, r) => s + r.baseRevenue, 0);
    const totalViRev = results.reduce((s, r) => s + r.viRevenue, 0);
    const totalOfftakeRev = results.reduce((s, r) => s + r.offtakeRevenue, 0);
    const totalMineConsumption = results.reduce((s, r) => s + r.mineConsumption, 0);
    const totalMineLmpCosts = results.reduce((s, r) => s + r.mineLmpCosts, 0);

    // Annualize
    const annualBtmOfftake = annualize(totalOfftake, totalHourCount);
    const ippRevBaseDollar = annualize(totalBaseRev, totalHourCount);
    const ippRevViDollar = annualize(totalViRev, totalHourCount);
    const ippRevOfftakeDollar = annualize(totalOfftakeRev, totalHourCount);

    const ippRevBaseMwh = annualBtmOfftake > 0 ? ippRevBaseDollar / annualBtmOfftake : 0;
    const ippRevViMwh = annualBtmOfftake > 0 ? ippRevViDollar / annualBtmOfftake : 0;
    const ippRevOfftakeMwh = annualBtmOfftake > 0 ? ippRevOfftakeDollar / annualBtmOfftake : 0;

    const dealValueDollar = ippRevViDollar - ippRevBaseDollar;
    const dealValueMwh = ippRevViMwh - ippRevBaseMwh;

    const dealValueOfftakeDollar = ippRevOfftakeDollar - ippRevBaseDollar;
    const dealValueOfftakeMwh = ippRevOfftakeMwh - ippRevBaseMwh;

    // Uptime: capacity factor
    const annualConsumption = annualize(totalMineConsumption, totalHourCount);
    const uptimePct = mineSize > 0 ? (annualConsumption / (mineSize * 8760)) * 100 : 0;

    // Blended LMP
    const avgBlendedLmp = totalMineConsumption > 0 ? totalMineLmpCosts / totalMineConsumption : 0;
    const allInCost = avgBlendedLmp + econ.import_burden;

    const entry = {
      mine_size: mineSize,
      annual_btm_offtake_MWh: Math.round(annualBtmOfftake),
      mine_uptime_pct: Math.round(uptimePct * 100) / 100,
      avg_blended_lmp: Math.round(avgBlendedLmp * 100) / 100,
      all_in_electricity_cost: Math.round(allInCost * 100) / 100,

      ipp_revenue_base: Math.round(ippRevBaseDollar),
      ipp_revenue_base_per_mwh: Math.round(ippRevBaseMwh * 100) / 100,
      ipp_revenue_offtake: Math.round(ippRevOfftakeDollar),
      ipp_revenue_offtake_per_mwh: Math.round(ippRevOfftakeMwh * 100) / 100,
      ipp_revenue_vi: Math.round(ippRevViDollar),
      ipp_revenue_vi_per_mwh: Math.round(ippRevViMwh * 100) / 100,

      deal_value_offtake: Math.round(dealValueOfftakeDollar),
      deal_value_offtake_per_mwh: Math.round(dealValueOfftakeMwh * 100) / 100,
      deal_value_vi: Math.round(dealValueDollar),
      deal_value_vi_per_mwh: Math.round(dealValueMwh * 100) / 100,
    };
    allResults.push(entry);

    // Optimize by deal_value_per_mwh (matches Lambda)
    if (dealValueMwh > bestDealValuePerMwh) {
      bestDealValuePerMwh = dealValueMwh;
      bestMineSize = mineSize;
      bestQuickMetrics = entry;
    }
  }

  // Generate full winner summary with summarize()
  const winner = bestMineSize ? summarize(hourlyData, bestMineSize, econ) : null;

  return {
    scenario,
    hashprice,
    strikePrice: Math.round(strikePrice * 100) / 100,
    efficiency,
    bestMineSize,
    bestDealValue: bestQuickMetrics.deal_value_vi || 0,
    bestDealValuePerMwh: Math.round(bestDealValuePerMwh * 100) / 100,
    bestMetrics: bestQuickMetrics,
    winner,
    allResults,
    totalHoursProcessed: hourlyData.length,
    totalGeneration: Math.round(annualize(hourlyData.reduce((s, r) => s + r.gen, 0), hourlyData.length)),
    capacityMW: ippData.capacityMW,
    parameters: {
      hashprice,
      efficiency,
      strikePrice: Math.round(strikePrice * 100) / 100,
      floorPrice: DEFAULT_ECON.miner_floor_price,
      importBurden: DEFAULT_ECON.import_burden,
      offtakeIndex: DEFAULT_ECON.offtake_index,
      totalHoursProcessed: hourlyData.length,
    },
  };
}

// ─── 4. Generate Excel ───────────────────────────────────────────────────────

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
  ws.columns = [{ width: 36 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }];

  let r = 1;

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

  // ── Header ──
  ws.mergeCells(r, 1, r, 6);
  const hdr = ws.getCell(r, 1);
  hdr.value = 'SANGHA RENEWABLES - MINE SPECIFICATION REPORT';
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
  kvRow('Hours Analyzed', `${analysis.totalHoursProcessed.toLocaleString()} hrs`);
  r++;

  // ── Winner Summary (from summarize()) ──
  const w = analysis.winner;
  sectionHeader(`OPTIMAL CONFIGURATION - ${analysis.bestMineSize} MW MINE`);
  kvRow('Best Mine Size', `${analysis.bestMineSize} MW`);
  kvRow('Annual BTM Offtake', `${w.annual_btm_offtake_MWh?.toLocaleString()} MWh`);
  kvRow('Annual Import', `${w.annual_import_MWh?.toLocaleString()} MWh`);
  kvRow('Mine Uptime (Capacity Factor)', `${w.uptime_pct}%`);
  kvRow('Avg Blended LMP', fmtD(w.avg_blended_lmp));
  kvRow('All-In Electricity Cost (Miner)', fmtD(w.all_in_electricity_cost_miner));
  kvRow('Curtailment Hours', `${w.curtailment_hours.toLocaleString()} hrs`);
  r++;

  kvRow('IPP Revenue - Grid Only ($/MWh)', fmtD(w.ipp_revenue_base_mwh));
  kvRow('IPP Revenue - Miner Offtake ($/MWh)', fmtD(w.ipp_revenue_offtake_mwh));
  kvRow('IPP Revenue - Vertical Integration ($/MWh)', fmtD(w.ipp_revenue_vi_mwh));
  r++;
  kvRow('IPP Revenue - Grid Only (Annual)', fmt(w.ipp_revenue_base_dollar));
  kvRow('IPP Revenue - Miner Offtake (Annual)', fmt(w.ipp_revenue_offtake_dollar));
  kvRow('IPP Revenue - Vertical Integration (Annual)', fmt(w.ipp_revenue_vi_dollar));
  r++;
  kvRow('Deal Value - Miner Offtake ($/MWh)', fmtD(w.deal_value_offtake_mwh));
  kvRow('Deal Value - Miner Offtake (Annual)', fmt(w.deal_value_offtake_dollar));
  kvRow('Deal Value - Vertical Integration ($/MWh)', fmtD(w.deal_value_vi_mwh));
  kvRow('Deal Value - Vertical Integration (Annual)', fmt(w.deal_value_vi_dollar));
  r++;

  // ── Offer Type Comparison ──
  sectionHeader('OFFER TYPE COMPARISON');
  tableHeaders(['Metric', 'Grid Only', 'Miner Offtake', 'Vertical Integration']);
  const compRows = [
    ['IPP Revenue ($/MWh)', fmtD(w.ipp_revenue_base_mwh), fmtD(w.ipp_revenue_offtake_mwh), fmtD(w.ipp_revenue_vi_mwh)],
    ['IPP Revenue (Annual)', fmt(w.ipp_revenue_base_dollar), fmt(w.ipp_revenue_offtake_dollar), fmt(w.ipp_revenue_vi_dollar)],
    ['Deal Value ($/MWh)', '-', fmtD(w.deal_value_offtake_mwh), fmtD(w.deal_value_vi_mwh)],
    ['Deal Value (Annual)', '-', fmt(w.deal_value_offtake_dollar), fmt(w.deal_value_vi_dollar)],
  ];
  for (const row of compRows) {
    ws.getCell(r, 1).value = row[0];
    ws.getCell(r, 1).font = { bold: true };
    for (let i = 1; i < row.length; i++) {
      ws.getCell(r, i + 1).value = row[i];
      ws.getCell(r, i + 1).alignment = { horizontal: 'center' };
    }
    ws.getCell(r, 4).font = { bold: true, color: { argb: '27AE60' } };
    r++;
  }
  r++;

  // ── Mine Size Sensitivity ──
  sectionHeader('MINE SIZE SENSITIVITY ANALYSIS');
  tableHeaders(['Mine Size (MW)', 'BTM Offtake (MWh)', 'Deal Value $/MWh', 'Deal Value (Annual)', 'All-In Cost $/MWh', 'Uptime %']);
  for (const res of analysis.allResults) {
    const isBest = res.mine_size === analysis.bestMineSize;
    ws.getCell(r, 1).value = `${res.mine_size} MW${isBest ? '  ★ BEST' : ''}`;
    ws.getCell(r, 1).font = isBest ? { bold: true, color: { argb: '27AE60' } } : {};
    ws.getCell(r, 2).value = res.annual_btm_offtake_MWh.toLocaleString();
    ws.getCell(r, 3).value = fmtD(res.deal_value_vi_per_mwh);
    ws.getCell(r, 4).value = fmt(res.deal_value_vi);
    ws.getCell(r, 5).value = fmtD(res.all_in_electricity_cost);
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
  kvRow('Hashprice', `$${analysis.hashprice}/PH/day`);
  kvRow('Fleet Efficiency', `${analysis.efficiency} W/TH`);
  kvRow('Calculated Strike Price', fmtD(analysis.strikePrice) + '/MWh');
  kvRow('Miner Floor Price', fmtD(analysis.parameters.floorPrice) + '/MWh');
  kvRow('Import Burden', fmtD(analysis.parameters.importBurden) + '/MWh');
  kvRow('Offtake Index', analysis.parameters.offtakeIndex);
  kvRow('Total Hours Analyzed', `${analysis.totalHoursProcessed.toLocaleString()}`);
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

// ─── 5. Claude-Powered Data Extraction ──────────────────────────────────────

async function extractWithClaude(body, attachments = []) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const attachmentText = attachments
    .filter(a => a.content)
    .map(a => `\n--- Attachment: ${a.filename} ---\n${a.content}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: `You are a data extraction specialist for Sangha Renewables' IPP (Independent Power Producer) analysis pipeline. Extract energy asset data from emails and format it as structured JSON.

You must return ONLY valid JSON with these fields (use null for missing data):
{
  "capacityMW": number or null,
  "annualGenerationMWh": number or null,
  "avgNodalPrice": number or null,
  "generationHours": number or null,
  "curtailmentPct": number or null,
  "location": string or null,
  "facilityType": "Solar" | "Wind" | "Natural Gas" | "Renewable" | null,
  "facilityName": string or null,
  "marketZone": string or null,
  "historicalPricing": { "median": number, "mean": number, "max": number, "min": number } or null,
  "forwardPricing": { "median": number, "mean": number, "max": number, "min": number } or null,
  "productionStats": { "median": number, "mean": number, "max": number, "min": number } or null,
  "impliedEbitda": number or null,
  "miningMW": number or null,
  "floorPrice": number or null,
  "currency": "USD" | "EUR" | string,
  "exchangeRate": number or null,
  "dataSource": string or null,
  "dataPeriod": string or null,
  "notes": string or null,
  "summary": string
}

Extract ALL numerical data you can find - pricing tables, production stats, EBITDA calculations, etc. The "summary" field should be a 1-2 sentence plain-English description of what the sender is sharing/asking. Be aggressive about extracting data - if you see numbers, capture them.`,
    messages: [{
      role: 'user',
      content: `Extract all IPP/energy data from this email:\n\n${body}${attachmentText}`,
    }],
  });

  try {
    const text = response.content[0]?.text || '';
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[IPP Pipeline] Claude extraction parse error:', e.message);
  }
  return null;
}

async function generateTailoredExcel(claudeData, rigidData, emailContext) {
  const wb = new ExcelJS.Workbook();

  // If we have enough data for the standard mine spec analysis, run it
  const capacity = claudeData?.capacityMW || claudeData?.miningMW || rigidData?.capacityMW;
  const generation = claudeData?.annualGenerationMWh || rigidData?.annualGenerationMWh;

  let analysisData = null;
  let analysis = null;

  if (capacity) {
    analysisData = {
      capacityMW: capacity,
      annualGenerationMWh: generation || Math.round(capacity * 8760 * 0.30),
      generationHours: rigidData?.generationHours || (generation ? Math.round(generation / capacity) : 2628),
      curtailmentPct: claudeData?.curtailmentPct || rigidData?.curtailmentPct || 0,
      facilityType: claudeData?.facilityType || rigidData?.facilityType || 'Renewable',
      location: claudeData?.location || claudeData?.marketZone || rigidData?.location,
      facilityName: claudeData?.facilityName || rigidData?.facilityName,
    };
    try {
      analysis = runPricingAnalysis(analysisData, 'Base');
    } catch (e) {
      console.warn('[IPP Pipeline] Analysis failed, generating data-only report:', e.message);
    }
  }

  // Sheet 1: Data Summary (always present - from Claude extraction)
  const summary = wb.addWorksheet('Data Summary');
  summary.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Value', key: 'value', width: 25 },
    { header: 'Source', key: 'source', width: 20 },
  ];

  const headerStyle = { font: { bold: true, size: 12 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A472A' } }, font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 } };
  summary.getRow(1).eachCell(c => { c.style = headerStyle; });

  const addRow = (field, value, source = 'Email') => {
    if (value !== null && value !== undefined) {
      summary.addRow({ field, value: typeof value === 'number' ? value : String(value), source });
    }
  };

  addRow('Summary', claudeData?.summary || 'IPP Inquiry');
  addRow('Capacity (MW)', claudeData?.capacityMW || claudeData?.miningMW);
  addRow('Annual Generation (MWh)', claudeData?.annualGenerationMWh);
  addRow('Facility Type', claudeData?.facilityType);
  addRow('Location / Zone', claudeData?.location || claudeData?.marketZone);
  addRow('Currency', claudeData?.currency);
  addRow('Exchange Rate', claudeData?.exchangeRate);
  addRow('Data Period', claudeData?.dataPeriod);
  addRow('Data Source', claudeData?.dataSource);
  addRow('Curtailment %', claudeData?.curtailmentPct);
  addRow('Floor Price ($/MWh)', claudeData?.floorPrice);
  addRow('Implied EBITDA Uplift', claudeData?.impliedEbitda);
  if (claudeData?.notes) addRow('Notes', claudeData.notes);

  // Sheet 2: Pricing Data (if available)
  if (claudeData?.historicalPricing || claudeData?.forwardPricing) {
    const pricing = wb.addWorksheet('Pricing Analysis');
    pricing.columns = [
      { header: 'Metric', key: 'metric', width: 20 },
      { header: 'Historical', key: 'historical', width: 18 },
      { header: 'Forward Curve', key: 'forward', width: 18 },
    ];
    pricing.getRow(1).eachCell(c => { c.style = headerStyle; });

    const hp = claudeData.historicalPricing || {};
    const fp = claudeData.forwardPricing || {};
    pricing.addRow({ metric: 'Median ($/MWh)', historical: hp.median, forward: fp.median });
    pricing.addRow({ metric: 'Mean ($/MWh)', historical: hp.mean, forward: fp.mean });
    pricing.addRow({ metric: 'Max ($/MWh)', historical: hp.max, forward: fp.max });
    pricing.addRow({ metric: 'Min ($/MWh)', historical: hp.min, forward: fp.min });

    // Format as currency
    ['B', 'C'].forEach(col => {
      for (let r = 2; r <= 5; r++) {
        const cell = pricing.getCell(`${col}${r}`);
        if (cell.value) cell.numFmt = '$#,##0.00';
      }
    });
  }

  // Sheet 3: Production Stats (if available)
  if (claudeData?.productionStats) {
    const prod = wb.addWorksheet('Production');
    prod.columns = [
      { header: 'Metric', key: 'metric', width: 20 },
      { header: 'Value (MWh)', key: 'value', width: 18 },
    ];
    prod.getRow(1).eachCell(c => { c.style = headerStyle; });
    const ps = claudeData.productionStats;
    prod.addRow({ metric: 'Median', value: ps.median });
    prod.addRow({ metric: 'Mean', value: ps.mean });
    prod.addRow({ metric: 'Max', value: ps.max });
    prod.addRow({ metric: 'Min', value: ps.min });
  }

  // Save
  const safeName = (claudeData?.facilityName || claudeData?.marketZone || emailContext?.fromName || 'inquiry').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Sangha_IPP_Analysis_${safeName}_${Date.now()}.xlsx`;
  const filepath = join(SPECS_DIR, filename);
  await wb.xlsx.writeFile(filepath);

  return { filepath, filename, analysis, analysisData };
}

// ─── 6. Process IPP Email ────────────────────────────────────────────────────

export async function processIppEmail({ messageId, threadId, from, fromName, subject, body, attachments, tenantId = DEFAULT_TENANT_ID }) {
  console.log(`[IPP Pipeline] Processing inquiry from ${fromName} <${from}>`);

  const rigidData = parseIppData(body, attachments);

  // Extract first name from sender
  let firstName = null;
  const sigMatch = body.match(/(?:Thanks|Regards|Best|Cheers|Sincerely)[,\s]*\n+([A-Z][a-z]+)/);
  if (sigMatch) firstName = sigMatch[1];
  if (!firstName && fromName && !fromName.includes('@')) firstName = fromName.split(' ')[0];
  if (!firstName) firstName = from.split('@')[0].replace(/[^a-zA-Z]/g, ' ').split(' ')[0];
  if (firstName) firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

  // If rigid parser found clean data, use the standard pipeline
  if (rigidData.capacityMW && rigidData.annualGenerationMWh) {
    // Standard pipeline - unchanged (fall through to existing logic below)
  } else {
    // Route through Claude to extract + analyze messy/non-standard data
    console.log(`[IPP Pipeline] Rigid parser insufficient - routing through Claude`);
    const claudeData = await extractWithClaude(body, attachments);

    if (!claudeData) {
      // Claude extraction failed too - ask for more data
      console.log(`[IPP Pipeline] Claude extraction also failed - requesting more info`);
      const needsDataText = [
        `Hey ${firstName},`,
        '',
        `Appreciate you reaching out - we work with a number of IPPs on BTM mining economics and would be happy to run an analysis for your site.`,
        '',
        `To put together something meaningful, we'd need a few data points: facility capacity (MW), annual generation (MWh), and location or ERCOT zone. If you have hourly generation data as a CSV, even better - that gives us the most accurate picture.`,
        '',
        `What does your generation profile look like? Are you seeing curtailment or mostly selling everything to grid today?`,
        '',
        `Best,`,
        `Coppice`,
        `Sangha Renewables`,
      ].join('\n');
      const gmailMessageId = messageId;
      await sendEmailWithAttachments({
        to: from,
        subject: `RE: ${subject}`,
        html: textToHtml(needsDataText),
        attachments: [],
        tenantId,
        threadId,
        inReplyTo: gmailMessageId,
        references: gmailMessageId,
      });
      insertActivity({
        tenantId, type: 'in',
        title: `IPP Inquiry from ${fromName || from}`,
        subtitle: `${subject} - Requested additional data`,
        detailJson: JSON.stringify({ from, fromName, subject, dataParsed: rigidData }),
        sourceType: 'email', sourceId: `ipp-${messageId}`, agentId: 'coppice',
      });

      // Save to knowledge base for future retrieval
      try {
        const tdb = getTenantDb(tenantId);
        const knId = `KN-ipp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const attachmentTexts = (attachments || []).filter(a => a.content).map(a => ({ filename: a.filename, text: (a.content || '').slice(0, 5000) }));
        const content = JSON.stringify({
          from, fromName, subject,
          body: (body || '').slice(0, 10000),
          attachmentNames: (attachments || []).map(a => a.filename || a.name).filter(Boolean),
          attachmentTexts: attachmentTexts.length ? attachmentTexts : undefined,
          threadId, messageId,
          status: 'need-data',
        });
        tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
          VALUES (?, ?, 'email-observation', ?, ?, ?, 'ipp-pipeline', datetime('now'))`)
          .run(knId, tenantId, `IPP: ${subject} (from ${fromName || from})`, content, `ipp:${from}`);
        processKnowledgeEntry(knId, tenantId).catch(err => {
          console.warn(`[IPP Pipeline] Knowledge processing failed: ${err.message}`);
        });
      } catch (err) {
        console.warn('[IPP Pipeline] Knowledge save failed:', err.message);
      }

      return { status: 'need-data', messageId };
    }

    // Claude found data - generate tailored spreadsheet
    console.log(`[IPP Pipeline] Claude extracted: ${claudeData.summary}`);
    const { filepath, filename, analysis } = await generateTailoredExcel(claudeData, rigidData, { fromName, from });

    insertActivity({
      tenantId, type: 'in',
      title: `IPP Inquiry from ${fromName || from}`,
      subtitle: `${claudeData.summary || subject}`,
      detailJson: JSON.stringify({ from, fromName, subject, claudeExtracted: claudeData }),
      sourceType: 'email', sourceId: `ipp-${messageId}`, agentId: 'coppice',
    });

    // Save to knowledge base for future retrieval
    try {
      const tdb = getTenantDb(tenantId);
      const knId = `KN-ipp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const attachmentTexts = (attachments || []).filter(a => a.content).map(a => ({ filename: a.filename, text: (a.content || '').slice(0, 5000) }));
      const content = JSON.stringify({
        from, fromName, subject,
        body: (body || '').slice(0, 10000),
        attachmentNames: (attachments || []).map(a => a.filename || a.name).filter(Boolean),
        attachmentTexts: attachmentTexts.length ? attachmentTexts : undefined,
        threadId, messageId,
        status: 'claude-analyzed',
        claudeExtracted: claudeData,
      });
      tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
        VALUES (?, ?, 'email-observation', ?, ?, ?, 'ipp-pipeline', datetime('now'))`)
        .run(knId, tenantId, `IPP: ${subject} (from ${fromName || from})`, content, `ipp:${from}`);
      processKnowledgeEntry(knId, tenantId).catch(err => {
        console.warn(`[IPP Pipeline] Knowledge processing failed: ${err.message}`);
      });
    } catch (err) {
      console.warn('[IPP Pipeline] Knowledge save failed:', err.message);
    }

    // Generate reply using Claude for a tailored response
    let replyBody;
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const replyResp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `You are Coppice, an AI agent at Sangha Renewables. Write a brief email reply to an IPP inquiry. Keep it under 150 words. Be specific about the data you analyzed. Don't use markdown formatting - write plain text.

WRITING STYLE (mandatory):
- Greeting: "Hey [First Name]," (casual, never "Dear", never "Hi", never "Hello", never "Good morning")
- Get straight to the point - no pleasantries, no "Thank you for your inquiry"
- Short paragraphs: 2-4 sentences max
- Direct and confident tone, not corporate or stiff
- Use specific numbers over vague claims
- Use dashes freely for asides
- No emoji
- Never say "I'd be happy to discuss", "Please don't hesitate", or "Looking forward to hearing from you"
- IMPORTANT: The LAST paragraph before "Best," must be a specific question that bounces the ball back to the sender. Ask about their data, curtailment patterns, or goals - not generic "would you be available for a call".
- Closing structure (strict order): question paragraph → "Best," → "Coppice" → "Sangha Renewables". NEVER put "Best," before the question.

CONFIDENTIALITY (critical):
- NEVER mention other clients, partners, or prospects by name
- NEVER reference specific case studies, deal terms, contract values, or revenue figures from other engagements
- NEVER fabricate or hallucinate case studies, client names, or partnership details
- If you want to reference past work, say "we've worked with similar portfolios" or "in comparable deployments" - never name names or cite specific numbers from other deals`,
        messages: [{
          role: 'user',
          content: `Write a reply to ${firstName} about their IPP data. Here's what we extracted and analyzed:\n\n${JSON.stringify(claudeData, null, 2)}\n\nWe generated a tailored Excel report (${filename}) with their data organized into sheets. ${analysis ? `Our mine spec analysis suggests an optimal mine size of ${analysis.bestMineSize}MW.` : 'We included all the pricing, production, and market data they shared.'}\n\nThe original email subject was: ${subject}`,
        }],
      });
      replyBody = replyResp.content[0]?.text || '';
    } catch (e) {
      // Fallback reply if Claude fails
      replyBody = [
        `Hey ${firstName},`,
        '',
        `Thanks for sharing the data - we've put together an analysis report based on what you sent over. The attached spreadsheet includes the pricing, production, and market data organized for review.`,
        '',
        analysis ? `Our initial analysis suggests an optimal mine size of ${analysis.bestMineSize}MW. Take a look at the sensitivity analysis in the report and let us know what questions come up.` : `Take a look and let us know what questions come up - happy to dig deeper into any of the numbers.`,
        '',
        `Best,`,
        `Coppice`,
        `Sangha Renewables`,
      ].join('\n');
    }

    const gmailMessageId = messageId;
    await sendEmailWithAttachments({
      to: from,
      subject: subject.startsWith('Re:') || subject.startsWith('RE:') ? subject : `Re: ${subject}`,
      html: textToHtml(replyBody),
      attachments: [{
        filename,
        path: filepath,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
      tenantId,
      threadId,
      inReplyTo: gmailMessageId,
      references: gmailMessageId,
    });

    insertActivity({
      tenantId, type: 'agent',
      title: 'IPP Analysis Generated (Claude-powered)',
      subtitle: claudeData.summary || `Analysis for ${fromName || from}`,
      detailJson: JSON.stringify({ claudeExtracted: claudeData, filename }),
      sourceType: 'email', sourceId: `ipp-spec-${messageId}`, agentId: 'coppice',
    });

    console.log(`[IPP Pipeline] Claude-powered reply sent to ${from} with ${filename}`);
    return { status: 'claude-analyzed', messageId, filename, claudeData };
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

  insertActivity({
    tenantId, type: 'in',
    title: `IPP Inquiry from ${fromName || from}`,
    subtitle: `${data.capacityMW}MW ${data.facilityType} - ${data.annualGenerationMWh?.toLocaleString()} MWh/yr`,
    detailJson: JSON.stringify({ from, fromName, subject, data }),
    sourceType: 'email', sourceId: `ipp-${messageId}`, agentId: 'coppice',
  });

  // Save to knowledge base for future retrieval
  try {
    const tdb = getTenantDb(tenantId);
    const knId = `KN-ipp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const attachmentTexts = (attachments || []).filter(a => a.content).map(a => ({ filename: a.filename, text: (a.content || '').slice(0, 5000) }));
    const content = JSON.stringify({
      from, fromName, subject,
      body: (body || '').slice(0, 10000),
      attachmentNames: (attachments || []).map(a => a.filename || a.name).filter(Boolean),
      attachmentTexts: attachmentTexts.length ? attachmentTexts : undefined,
      threadId, messageId,
      status: 'rigid-parsed',
      parsedData: data,
    });
    tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
      VALUES (?, ?, 'email-observation', ?, ?, ?, 'ipp-pipeline', datetime('now'))`)
      .run(knId, tenantId, `IPP: ${subject} (from ${fromName || from})`, content, `ipp:${from}`);
    processKnowledgeEntry(knId, tenantId).catch(err => {
      console.warn(`[IPP Pipeline] Knowledge processing failed: ${err.message}`);
    });
  } catch (err) {
    console.warn('[IPP Pipeline] Knowledge save failed:', err.message);
  }

  // Run pricing analysis for all 3 scenarios
  const baseAnalysis = runPricingAnalysis(data, 'Base');
  const bestAnalysis = runPricingAnalysis(data, 'Best');
  const worstAnalysis = runPricingAnalysis(data, 'Worst');

  const w = baseAnalysis.winner;
  console.log(`[IPP Pipeline] Best mine size: ${baseAnalysis.bestMineSize}MW, Deal value (VI): $${baseAnalysis.bestDealValue.toLocaleString()}, $/MWh: $${baseAnalysis.bestDealValuePerMwh}`);

  insertActivity({
    tenantId, type: 'agent',
    title: 'Mine Specification Generated',
    subtitle: `${baseAnalysis.bestMineSize}MW optimal - Deal value $${baseAnalysis.bestDealValue.toLocaleString()} ($${baseAnalysis.bestDealValuePerMwh}/MWh)`,
    detailJson: JSON.stringify({
      bestMineSize: baseAnalysis.bestMineSize,
      dealValueVI: baseAnalysis.bestDealValue,
      dealValuePerMwh: baseAnalysis.bestDealValuePerMwh,
      strikePrice: baseAnalysis.strikePrice,
      scenarioResults: {
        best: { bestMineSize: bestAnalysis.bestMineSize, dealValue: bestAnalysis.bestDealValue, strikePrice: bestAnalysis.strikePrice },
        base: { bestMineSize: baseAnalysis.bestMineSize, dealValue: baseAnalysis.bestDealValue, strikePrice: baseAnalysis.strikePrice },
        worst: { bestMineSize: worstAnalysis.bestMineSize, dealValue: worstAnalysis.bestDealValue, strikePrice: worstAnalysis.strikePrice },
      },
    }),
    sourceType: 'email', sourceId: `ipp-spec-${messageId}`, agentId: 'coppice',
  });

  const { filepath, filename } = await generateMineSpecExcel(baseAnalysis, data);
  console.log(`[IPP Pipeline] Excel: ${filename}`);

  const replyBody = [
    `Hey ${firstName},`,
    '',
    `Ran the numbers on your ${data.capacityMW}MW ${data.facilityType.toLowerCase()} site - the short version is a ${baseAnalysis.bestMineSize}MW behind-the-meter mine looks like it adds about ${fmtD(baseAnalysis.bestDealValuePerMwh)}/MWh in deal value, which comes out to roughly ${fmt(baseAnalysis.bestDealValue)} annually on a VI structure. That's at ${w.uptime_pct}% uptime with an all-in electricity cost to the miner of ${fmtD(w.all_in_electricity_cost_miner)}/MWh.`,
    '',
    `Attached the full report with the sensitivity across mine sizes (${baseAnalysis.allResults[0]?.mineSize || 10}MW to ${baseAnalysis.allResults[baseAnalysis.allResults.length - 1]?.mineSize || 150}MW), grid vs offtake vs VI comparisons, and the economic assumptions we used. It's based on ${baseAnalysis.totalHoursProcessed.toLocaleString()} hours of actual ERCOT nodal data so the numbers should be pretty tight.`,
    '',
    `Curious - are you currently curtailing much, or is most of your generation hitting the grid today? That context would help us dial in the offtake structure.`,
    '',
    `Best,`,
    `Coppice`,
    `Sangha Renewables`,
  ].join('\n');

  const gmailMessageId2 = messageId;
  await sendEmailWithAttachments({
    to: from,
    subject: subject.startsWith('Re:') || subject.startsWith('RE:') ? subject : `Re: ${subject}`,
    html: textToHtml(replyBody),
    attachments: [{
      filename,
      path: filepath,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
    tenantId,
    threadId,
    inReplyTo: gmailMessageId2,
    references: gmailMessageId2,
  });
  console.log(`[IPP Pipeline] Reply sent to ${from}`);

  insertActivity({
    tenantId, type: 'out',
    title: 'Mine Specification Sent',
    subtitle: `Replied to ${fromName || from} - ${baseAnalysis.bestMineSize}MW optimal, $${baseAnalysis.bestDealValuePerMwh}/MWh deal value`,
    detailJson: JSON.stringify({ to: from, filename, bestMineSize: baseAnalysis.bestMineSize, dealValuePerMwh: baseAnalysis.bestDealValuePerMwh }),
    sourceType: 'email', sourceId: `ipp-reply-${messageId}`, agentId: 'coppice',
  });

  return { status: 'sent', messageId, analysis: baseAnalysis, filename };
}
