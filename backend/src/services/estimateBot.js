/**
 * Estimating Bot Service — DACP Construction
 *
 * In-process service that processes bid requests, generates estimates,
 * and drafts emails. No external dependencies.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  getDacpPricing,
  getDacpBidRequest,
  getDacpJobs,
  createDacpEstimate,
  updateDacpBidRequest,
} from '../cache/database.js';

const TENANT_ID = 'dacp-construction-001';

// ─── Scope → Pricing Matching ───────────────────────────────────────────────

function normalizeText(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

const KEYWORD_MAP = {
  'slab on grade': ['FW-001', 'FW-002', 'FW-003'],
  'sog': ['FW-001', 'FW-002', 'FW-003'],
  'slab': ['FW-001', 'FW-002', 'FW-003'],
  'topping slab': ['FW-004'],
  'strip footing': ['FN-001'],
  'spread footing': ['FN-002'],
  'grade beam': ['FN-003'],
  'pier': ['FN-004'],
  'caisson': ['FN-004'],
  'drilled shaft': ['FN-004'],
  'curb': ['CG-001', 'CG-002'],
  'gutter': ['CG-001'],
  'sidewalk': ['CG-003'],
  'retaining wall': ['WL-001', 'WL-002'],
  'cast in place wall': ['WL-002', 'WL-003'],
  'cip wall': ['WL-002', 'WL-003'],
  'elevated deck': ['ST-001'],
  'pt slab': ['ST-001'],
  'post tension': ['ST-001'],
  'column': ['ST-002'],
  'beam': ['ST-003'],
  'stair': ['ST-004'],
  'stamped': ['DC-001'],
  'exposed aggregate': ['DC-002'],
  'polished': ['DC-003'],
  'demolition': ['DM-001', 'DM-002'],
  'demo': ['DM-001', 'DM-002'],
  'removal': ['DM-001', 'DM-002'],
  'rebar': ['RB-001', 'RB-002'],
  'wwf': ['RB-003'],
  'welded wire': ['RB-003'],
  'vapor barrier': ['AC-001'],
  'expansion joint': ['AC-002'],
  'curing': ['AC-003'],
  'equipment pad': ['FW-003'],
  'containment': ['WL-003'],
  'loading dock': ['FW-003'],
  'approach slab': ['FW-003'],
  'barrier rail': ['CG-001'],
  'trench drain': ['AC-004'],
  'housekeeping pad': ['FW-001'],
  'pipe support': ['FN-002'],
  'clarifier': ['WL-002'],
  'pool deck': ['FW-002'],
  'ada ramp': ['CG-003'],
  'apparatus bay': ['FW-003'],
  'drive apron': ['FW-003'],
  'foundation': ['FN-001', 'FN-002', 'FN-003'],
  'mat foundation': ['FW-003'],
  'elevator pit': ['WL-002'],
};

function parseQuantity(text) {
  const match = text.match(/([\d,]+(?:\.\d+)?)\s*(sf|lf|cy|ea|lb|cf)/i);
  if (match) {
    return { qty: parseFloat(match[1].replace(/,/g, '')), unit: match[2].toUpperCase() };
  }
  const numMatch = text.match(/([\d,]+)/);
  return numMatch ? { qty: parseFloat(numMatch[1].replace(/,/g, '')), unit: null } : { qty: 0, unit: null };
}

export function matchScopeToPricing(bidRequest, pricingTable) {
  const scope = bidRequest.scope || (bidRequest.scope_json ? JSON.parse(bidRequest.scope_json) : {});
  const items = scope.items || [];
  const pricingMap = {};
  for (const p of pricingTable) pricingMap[p.id] = p;

  const lineItems = [];

  for (const item of items) {
    const norm = normalizeText(item);
    const { qty, unit: parsedUnit } = parseQuantity(item);

    let matchedPricingIds = [];
    for (const [keyword, ids] of Object.entries(KEYWORD_MAP)) {
      if (norm.includes(keyword)) {
        matchedPricingIds = ids;
        break;
      }
    }

    if (matchedPricingIds.length > 0 && qty > 0) {
      const pricingId = matchedPricingIds[0];
      const pricing = pricingMap[pricingId];
      if (pricing) {
        lineItems.push({
          description: item,
          pricingId: pricing.id,
          pricingItem: pricing.item,
          category: pricing.category,
          quantity: qty,
          unit: parsedUnit || pricing.unit,
          unitPrice: pricing.unit_price,
          extended: Math.round(qty * pricing.unit_price * 100) / 100,
        });
      }
    } else if (qty > 0) {
      // Unmatched item — use generic estimate
      lineItems.push({
        description: item,
        pricingId: null,
        pricingItem: 'Custom / Unmatched',
        category: 'Other',
        quantity: qty,
        unit: parsedUnit || 'EA',
        unitPrice: 0,
        extended: 0,
      });
    }
  }

  return lineItems;
}

// ─── Historical Comparables ─────────────────────────────────────────────────

export function findHistoricalComparables(bidRequest, jobsHistory) {
  const scope = bidRequest.scope || (bidRequest.scope_json ? JSON.parse(bidRequest.scope_json) : {});
  const gcName = bidRequest.gc_name || '';
  const body = normalizeText(bidRequest.body || '');

  const scored = jobsHistory
    .filter(j => j.status === 'complete' || j.status === 'lost')
    .map(j => {
      let score = 0;
      if (j.gc_name === gcName) score += 3;
      const jNorm = normalizeText(j.project_name + ' ' + (j.notes || ''));
      const scopeText = normalizeText((scope.items || []).join(' '));
      // Simple keyword overlap
      const keywords = ['slab', 'foundation', 'wall', 'deck', 'pier', 'curb', 'demo', 'warehouse', 'office', 'residential', 'parking'];
      for (const kw of keywords) {
        if (jNorm.includes(kw) && (scopeText.includes(kw) || body.includes(kw))) score += 1;
      }
      return { ...j, score };
    })
    .filter(j => j.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored;
}

function computeConfidence(lineItems, comparables, missingInfo) {
  let score = 100;
  const unmatchedCount = lineItems.filter(li => !li.pricingId).length;
  score -= unmatchedCount * 15;
  if (comparables.length === 0) score -= 20;
  if (comparables.length === 1) score -= 10;
  const missing = missingInfo || [];
  score -= missing.length * 10;
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

// ─── Estimate Generation ────────────────────────────────────────────────────

export function generateEstimate(bidRequest, tenantId = TENANT_ID) {
  const pricingTable = getDacpPricing(tenantId);
  const jobsHistory = getDacpJobs(tenantId);

  const lineItems = matchScopeToPricing(bidRequest, pricingTable);
  const comparables = findHistoricalComparables(bidRequest, jobsHistory);

  const subtotal = lineItems.reduce((sum, li) => sum + li.extended, 0);
  const overheadPct = 10;
  const profitPct = 15;
  const overhead = subtotal * (overheadPct / 100);
  const profit = (subtotal + overhead) * (profitPct / 100);

  // Mobilization
  let mobilization = 1500;
  if (subtotal >= 150000) mobilization = 3500;
  else if (subtotal >= 50000) mobilization = 2500;

  // Testing allowance
  let testing = 1200;
  if (subtotal >= 100000) testing = 2400;

  const rawTotal = subtotal + overhead + profit + mobilization + testing;
  const totalBid = Math.round(rawTotal / 500) * 500; // Round to nearest $500

  const missingInfo = bidRequest.missing_info || (bidRequest.missing_info_json ? JSON.parse(bidRequest.missing_info_json) : []);
  const confidence = computeConfidence(lineItems, comparables, missingInfo);

  const estimate = {
    id: `EST-${uuidv4().slice(0, 8).toUpperCase()}`,
    tenantId,
    bidRequestId: bidRequest.id,
    projectName: bidRequest.subject.replace(/^(RFQ|ITB|RFP|Pricing Request|Budget Pricing|Budget Request|Quick Turn|Bid|Pre-Qual \+ RFQ|FYI):?\s*/i, '').trim(),
    gcName: bidRequest.gc_name,
    status: 'draft',
    lineItems: lineItems.map(li => ({ ...li, comparables: undefined })),
    subtotal,
    overheadPct,
    profitPct,
    mobilization: mobilization + testing,
    totalBid,
    confidence,
    notes: `Auto-generated estimate. ${comparables.length} historical comparable(s) found. ${missingInfo.length > 0 ? `Missing info: ${missingInfo.join(', ')}` : 'All info provided.'}`,
  };

  createDacpEstimate(estimate);

  // Update bid request status
  updateDacpBidRequest(tenantId, bidRequest.id, { status: 'estimated' });

  return { estimate, comparables };
}

// ─── Process Inbound Request ────────────────────────────────────────────────

export function processInboundRequest(bidRequest) {
  const scope = bidRequest.scope || (bidRequest.scope_json ? JSON.parse(bidRequest.scope_json) : {});
  const items = scope.items || [];

  // Identify missing info
  const missingInfo = [];
  const body = (bidRequest.body || '').toLowerCase();
  const hasRebar = items.some(i => normalizeText(i).includes('rebar')) || body.includes('rebar');
  const hasStructural = items.some(i => {
    const n = normalizeText(i);
    return n.includes('foundation') || n.includes('wall') || n.includes('deck') || n.includes('beam');
  });

  if (hasStructural && !hasRebar && !body.includes('rebar schedule')) {
    missingInfo.push('Rebar schedule not provided');
  }
  if (!body.includes('geotech') && !body.includes('soil') && hasStructural) {
    missingInfo.push('Geotechnical report not referenced');
  }

  // Calculate urgency
  const dueDate = new Date(bidRequest.due_date);
  const now = new Date();
  const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
  let urgency = 'low';
  if (daysUntilDue <= 7) urgency = 'high';
  else if (daysUntilDue <= 14) urgency = 'medium';

  return {
    scopeItems: items,
    missingInfo: [...new Set([...(bidRequest.missing_info || []), ...missingInfo])],
    urgency,
    daysUntilDue,
    itemCount: items.length,
  };
}

// ─── Email Templates ────────────────────────────────────────────────────────

export function draftClarificationEmail(bidRequest, missingItems) {
  return {
    to: bidRequest.from_email,
    subject: `RE: ${bidRequest.subject} — Clarification Needed`,
    body: `Hi ${bidRequest.from_name},\n\nThank you for the opportunity to bid on this project. Before we can finalize our pricing, we need the following information:\n\n${missingItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\nPlease send these at your earliest convenience so we can meet the ${bidRequest.due_date} deadline.\n\nBest regards,\nDACP Construction Estimating`,
  };
}

export function draftQuoteEmail(estimate) {
  return {
    to: '',
    subject: `DACP Construction — ${estimate.projectName} — Bid Proposal`,
    body: `Dear ${estimate.gcName} Estimating Team,\n\nPlease find our bid for the above-referenced project:\n\nTotal Bid Amount: $${estimate.totalBid.toLocaleString()}\n\nThis proposal includes:\n- All concrete materials, labor, and equipment\n- ${estimate.overheadPct}% overhead and ${estimate.profitPct}% profit\n- Mobilization & testing allowance: $${estimate.mobilization.toLocaleString()}\n\nExclusions:\n- Subgrade preparation (by others)\n- Earthwork and backfill\n- Waterproofing\n- Structural steel embeds (unless noted)\n\nThis bid is valid for 30 days. Please don't hesitate to reach out with questions.\n\nBest regards,\nDACP Construction`,
  };
}
