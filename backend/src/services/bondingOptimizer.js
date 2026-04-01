/**
 * Bond Rate Optimizer
 *
 * Tracks DACP's bonding program, flags above-market rates,
 * calculates optimal bond costs based on sliding scale tiers.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDacpBondProgram, upsertDacpBondProgram, checkBondRateFlag, insertActivity } from '../cache/database.js';

// Industry benchmark bond rates by project size tier (2026 market)
const MARKET_BENCHMARKS = {
  // Project size tiers (cumulative)
  tiers: [
    { min: 0, max: 2500000, benchmarkPct: 1.5, label: '$0 - $2.5M' },
    { min: 2500000, max: 5000000, benchmarkPct: 1.25, label: '$2.5M - $5M' },
    { min: 5000000, max: 10000000, benchmarkPct: 1.0, label: '$5M - $10M' },
    { min: 10000000, max: 25000000, benchmarkPct: 0.85, label: '$10M - $25M' },
    { min: 25000000, max: Infinity, benchmarkPct: 0.75, label: '$25M+' },
  ],
  // Average rates by contractor experience
  byExperience: {
    new: 2.5,      // New to bonding
    emerging: 2.0, // 1-3 years
    established: 1.5, // 3-7 years
    seasoned: 1.0, // 7+ years
  },
};

/**
 * Calculate the optimal bond cost using a tiered sliding scale.
 */
export function calculateTieredBondCost(projectAmount, tiers) {
  if (!tiers || !Array.isArray(tiers) || tiers.length === 0) {
    tiers = MARKET_BENCHMARKS.tiers;
  }

  let totalBondCost = 0;
  let remaining = projectAmount;
  const breakdown = [];

  for (const tier of tiers) {
    if (remaining <= 0) break;

    const tierSize = (tier.max || Infinity) - (tier.min || 0);
    const amountInTier = Math.min(remaining, tierSize);
    const tierCost = amountInTier * (tier.benchmarkPct || tier.ratePct || 1.5) / 100;

    breakdown.push({
      tier: tier.label || `$${(tier.min / 1000000).toFixed(1)}M - $${tier.max === Infinity ? 'up' : (tier.max / 1000000).toFixed(1) + 'M'}`,
      amount: amountInTier,
      rate: tier.benchmarkPct || tier.ratePct,
      cost: Math.round(tierCost),
    });

    totalBondCost += tierCost;
    remaining -= amountInTier;
  }

  return {
    totalCost: Math.round(totalBondCost),
    effectiveRate: projectAmount > 0 ? Math.round((totalBondCost / projectAmount) * 10000) / 100 : 0,
    breakdown,
  };
}

/**
 * Analyze an estimate's bond rate and flag if above market.
 */
export function analyzeBondRate(tenantId, { estimateTotal, bondRatePct, projectType }) {
  // Get the tenant's bond program if exists
  const bondPrograms = getDacpBondProgram(tenantId);
  const program = bondPrograms?.[0]; // Use most recent

  // Calculate what the cost SHOULD be with market benchmarks
  const marketCalc = calculateTieredBondCost(estimateTotal, MARKET_BENCHMARKS.tiers);

  // Calculate what the client is currently paying (flat rate)
  const currentCost = Math.round(estimateTotal * bondRatePct / 100);

  // Calculate savings potential
  const savings = currentCost - marketCalc.totalCost;
  const savingsPct = currentCost > 0 ? Math.round((savings / currentCost) * 100) : 0;

  const result = {
    estimateTotal,
    currentRate: bondRatePct,
    currentCost,
    marketRate: marketCalc.effectiveRate,
    marketCost: marketCalc.totalCost,
    savings,
    savingsPct,
    breakdown: marketCalc.breakdown,
    flag: null,
    recommendation: null,
  };

  // Flag logic
  if (bondRatePct > marketCalc.effectiveRate * 1.3) {
    result.flag = 'critical';
    result.recommendation = `Bond rate of ${bondRatePct}% is significantly above market (${marketCalc.effectiveRate}%). Potential savings of $${savings.toLocaleString()} (${savingsPct}%). Strongly recommend renegotiating with surety or shopping for competitive quotes.`;
  } else if (bondRatePct > marketCalc.effectiveRate * 1.15) {
    result.flag = 'warning';
    result.recommendation = `Bond rate of ${bondRatePct}% is above market average (${marketCalc.effectiveRate}%). Could save $${savings.toLocaleString()} with a better rate. Consider requesting a sliding scale from your surety.`;
  } else if (bondRatePct <= marketCalc.effectiveRate) {
    result.flag = 'good';
    result.recommendation = `Bond rate of ${bondRatePct}% is at or below market average. No action needed.`;
  }

  return result;
}

/**
 * Check all flagged bond rates for a tenant.
 */
export function getABoveMarketBonds(tenantId) {
  return checkBondRateFlag(tenantId);
}

/**
 * Set up or update a tenant's bond program.
 */
export function setupBondProgram(tenantId, {
  suretyCompany, suretyContact, suretyEmail, suretyPhone,
  totalCapacity, currentUtilization, tiers,
  currentRatePct, effectiveDate, expiryDate, notes,
}) {
  // Calculate market benchmark for comparison
  const avgProjectSize = totalCapacity ? totalCapacity / 5 : 2500000; // Assume ~5 active jobs
  const marketCalc = calculateTieredBondCost(avgProjectSize, MARKET_BENCHMARKS.tiers);

  const rateFlag = currentRatePct > marketCalc.effectiveRate * 1.2 ? 'above_market'
    : currentRatePct > marketCalc.effectiveRate ? 'slightly_above'
    : 'competitive';

  const id = uuidv4();
  upsertDacpBondProgram({
    id,
    tenantId,
    suretyCompany,
    suretyContact,
    suretyEmail,
    suretyPhone,
    totalCapacity,
    currentUtilization: currentUtilization || 0,
    tiersJson: JSON.stringify(tiers || MARKET_BENCHMARKS.tiers),
    currentRatePct,
    marketBenchmarkPct: marketCalc.effectiveRate,
    rateFlag,
    effectiveDate,
    expiryDate,
    notes,
  });

  insertActivity({
    tenantId,
    type: 'agent',
    title: `Bond program ${rateFlag === 'above_market' ? 'flagged' : 'configured'}: ${suretyCompany}`,
    subtitle: `Rate: ${currentRatePct}% vs market ${marketCalc.effectiveRate}% | Capacity: $${(totalCapacity / 1000000).toFixed(1)}M`,
    detailJson: JSON.stringify({ id, rateFlag, currentRatePct, marketRate: marketCalc.effectiveRate }),
    sourceType: 'bonding',
    sourceId: id,
    agentId: 'estimating',
  });

  return { id, rateFlag, marketRate: marketCalc.effectiveRate };
}

/**
 * Add bond analysis to an estimate's notes.
 */
export function addBondAnalysisToEstimate(tenantId, estimateTotal, bondRatePct) {
  const analysis = analyzeBondRate(tenantId, { estimateTotal, bondRatePct });

  if (analysis.flag === 'critical' || analysis.flag === 'warning') {
    return {
      addToNotes: analysis.recommendation,
      flag: analysis.flag,
      savings: analysis.savings,
    };
  }

  return null;
}

export default {
  calculateTieredBondCost,
  analyzeBondRate,
  getABoveMarketBonds,
  setupBondProgram,
  addBondAnalysisToEstimate,
  MARKET_BENCHMARKS,
};
