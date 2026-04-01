/**
 * Claims Verifier - Phase 9
 *
 * Automated claims verification and generation for hashprice insurance.
 *
 * Monthly flow:
 *   1. For each active policy, compare actual hashprice vs floor
 *   2. If hashprice < floor → generate a claim with shortfall calculation
 *   3. Auto-verify the claim against fleet telemetry:
 *      - Fleet uptime > 95%
 *      - Actual hashrate within 10% of covered hashrate
 *      - Energy costs within expected range
 *      - Curtailment was optimal (not gaming)
 *   4. If hashprice > floor → calculate upside sharing
 *
 * Verification evidence is stored as a JSON object on each claim
 * for full auditability.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  getInsurancePolicies,
  getAllInsurancePolicies,
  getInsuranceClaim,
  createInsuranceClaim,
  updateInsuranceClaim,
  createUpsideSharing,
  getCache,
} from '../cache/database.js';

let claimsSchedulerInterval = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the number of days in a given month string (YYYY-MM).
 */
function daysInMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

/**
 * Retrieve the average actual hashprice for a given month from cache.
 * Looks for cached hashprice data keyed by month or uses the latest available.
 *
 * @param {string} month - Month in YYYY-MM format
 * @returns {number|null} Average hashprice in $/TH/day, or null if unavailable
 */
function getActualHashprice(month) {
  // Try month-specific cache first
  const monthCache = getCache(`hashprice-monthly-${month}`);
  if (monthCache && monthCache.data && monthCache.data.hashprice !== undefined) {
    return monthCache.data.hashprice;
  }

  // Fall back to the general hashprice cache
  const general = getCache('fleet-network-data');
  if (general && general.data) {
    // If the cache contains a computed hashprice value, use it
    if (general.data.hashprice !== undefined) return general.data.hashprice;
  }

  // Try the hashprice engine cache
  const hpCache = getCache('network-hashprice');
  if (hpCache && hpCache.data && hpCache.data.hashpriceUsd !== undefined) {
    return hpCache.data.hashpriceUsd;
  }

  return null;
}

/**
 * Retrieve fleet telemetry for a given tenant and month.
 * Used to verify that the miner was operating as claimed.
 *
 * @param {string} tenantId
 * @param {string} month - YYYY-MM
 * @returns {object} Fleet telemetry summary
 */
function getFleetTelemetry(tenantId, month) {
  // Try tenant-specific fleet data
  const fleetCache = getCache(`fleet-telemetry-${tenantId}-${month}`);
  if (fleetCache && fleetCache.data) {
    return fleetCache.data;
  }

  // Fall back to general fleet snapshots
  const snapshotCache = getCache(`fleet-snapshot-latest`);
  if (snapshotCache && snapshotCache.data) {
    return {
      avgUptimePct: snapshotCache.data.uptimePct || 97,
      avgHashrateTH: snapshotCache.data.totalHashrate || 0,
      avgEnergyCostMWh: snapshotCache.data.energyCostMWh || null,
      curtailmentHours: snapshotCache.data.curtailedHours || 0,
      miningHours: snapshotCache.data.miningHours || 0,
    };
  }

  // Return defaults indicating no telemetry available
  return {
    avgUptimePct: null,
    avgHashrateTH: null,
    avgEnergyCostMWh: null,
    curtailmentHours: null,
    miningHours: null,
  };
}

// ─── Verification Engine ─────────────────────────────────────────────────────

/**
 * Run verification checks against fleet telemetry for a claim.
 *
 * @param {object} policy - Insurance policy record
 * @param {string} month - YYYY-MM
 * @param {object} telemetry - Fleet telemetry data
 * @returns {object} Verification result with pass/fail and evidence
 */
function runVerificationChecks(policy, month, telemetry) {
  const checks = [];
  let allPassed = true;

  // Check 1: Fleet uptime > 95%
  const uptimeCheck = {
    name: 'fleet_uptime',
    description: 'Fleet uptime must be above 95% during the claim period',
    threshold: 95,
    actual: telemetry.avgUptimePct,
    passed: false,
    skipped: false,
  };
  if (telemetry.avgUptimePct !== null) {
    uptimeCheck.passed = telemetry.avgUptimePct >= 95;
    if (!uptimeCheck.passed) allPassed = false;
  } else {
    uptimeCheck.skipped = true;
    uptimeCheck.note = 'No uptime telemetry available for verification';
  }
  checks.push(uptimeCheck);

  // Check 2: Actual hashrate within 10% of covered hashrate
  const hashrateCheck = {
    name: 'hashrate_match',
    description: 'Actual hashrate must be within 10% of covered hashrate',
    coveredHashrate: policy.covered_hashrate,
    actual: telemetry.avgHashrateTH,
    tolerance: 0.10,
    passed: false,
    skipped: false,
  };
  if (telemetry.avgHashrateTH !== null && policy.covered_hashrate > 0) {
    const ratio = telemetry.avgHashrateTH / policy.covered_hashrate;
    hashrateCheck.ratio = Math.round(ratio * 1000) / 1000;
    hashrateCheck.passed = ratio >= (1 - hashrateCheck.tolerance);
    if (!hashrateCheck.passed) allPassed = false;
  } else {
    hashrateCheck.skipped = true;
    hashrateCheck.note = 'No hashrate telemetry available for verification';
  }
  checks.push(hashrateCheck);

  // Check 3: Energy costs within expected range
  const energyCheck = {
    name: 'energy_cost_range',
    description: 'Energy costs must be within expected operational range',
    expectedRangeMWh: [15, 120], // $/MWh - reasonable range for mining
    actual: telemetry.avgEnergyCostMWh,
    passed: false,
    skipped: false,
  };
  if (telemetry.avgEnergyCostMWh !== null) {
    const [lo, hi] = energyCheck.expectedRangeMWh;
    energyCheck.passed = telemetry.avgEnergyCostMWh >= lo && telemetry.avgEnergyCostMWh <= hi;
    if (!energyCheck.passed) allPassed = false;
  } else {
    energyCheck.skipped = true;
    energyCheck.note = 'No energy cost data available for verification';
  }
  checks.push(energyCheck);

  // Check 4: Curtailment was optimal (not gaming - excessive curtailment to trigger claim)
  const curtailmentCheck = {
    name: 'curtailment_optimality',
    description: 'Curtailment hours must be reasonable - not artificially high',
    maxCurtailmentRatio: 0.40, // No more than 40% of total hours curtailed
    passed: false,
    skipped: false,
  };
  if (telemetry.curtailmentHours !== null && telemetry.miningHours !== null) {
    const totalHours = telemetry.curtailmentHours + telemetry.miningHours;
    if (totalHours > 0) {
      curtailmentCheck.curtailmentRatio = Math.round((telemetry.curtailmentHours / totalHours) * 10000) / 10000;
      curtailmentCheck.passed = curtailmentCheck.curtailmentRatio <= curtailmentCheck.maxCurtailmentRatio;
      if (!curtailmentCheck.passed) allPassed = false;
    } else {
      curtailmentCheck.skipped = true;
      curtailmentCheck.note = 'No operational hours recorded';
    }
  } else {
    curtailmentCheck.skipped = true;
    curtailmentCheck.note = 'No curtailment telemetry available for verification';
  }
  checks.push(curtailmentCheck);

  // Determine overall result
  const skippedCount = checks.filter(c => c.skipped).length;
  const failedCount = checks.filter(c => !c.passed && !c.skipped).length;

  let overallStatus;
  if (failedCount > 0) {
    overallStatus = 'failed';
  } else if (skippedCount === checks.length) {
    overallStatus = 'insufficient_data';
  } else if (skippedCount > 0) {
    overallStatus = 'partial_pass';
  } else {
    overallStatus = 'passed';
  }

  return {
    overallStatus,
    timestamp: new Date().toISOString(),
    checksRun: checks.length,
    checksPassed: checks.filter(c => c.passed).length,
    checksSkipped: skippedCount,
    checksFailed: failedCount,
    checks,
  };
}

// ─── Monthly Claim Generation ────────────────────────────────────────────────

/**
 * Generate monthly claims for all active policies.
 *
 * For each active policy:
 *   - If actual hashprice < floor → create a claim
 *   - Auto-verify the claim using fleet telemetry
 *   - Store verification evidence on the claim
 *
 * @param {string} month - Month in YYYY-MM format (e.g., '2025-04')
 * @returns {Promise<object>} Summary of claims generated
 */
export async function generateMonthlyClaims(month) {
  console.log(`[ClaimsVerifier] Generating claims for month: ${month}`);

  const actualHashprice = getActualHashprice(month);
  if (actualHashprice === null) {
    console.warn(`[ClaimsVerifier] No hashprice data available for ${month}`);
    return {
      month,
      error: 'No hashprice data available',
      claimsGenerated: 0,
      upsideSharingGenerated: 0,
    };
  }

  const activePolicies = getAllInsurancePolicies('active');
  const days = daysInMonth(month);

  let claimsGenerated = 0;
  let upsideSharingGenerated = 0;
  let claimsTotalAmount = 0;
  let upsideTotalAmount = 0;
  const results = [];

  for (const policy of activePolicies) {
    // Check if policy covers this month
    const policyStart = policy.start_date;
    const policyEnd = policy.end_date;
    if (month < policyStart.slice(0, 7) || month > policyEnd.slice(0, 7)) {
      continue; // Policy not active for this month
    }

    if (actualHashprice < policy.floor_price) {
      // ── Claim: hashprice below floor ──
      const shortfallPerTH = policy.floor_price - actualHashprice;
      const grossClaimAmount = shortfallPerTH * policy.covered_hashrate * days;

      // Run verification
      const telemetry = getFleetTelemetry(policy.tenant_id, month);
      const verification = runVerificationChecks(policy, month, telemetry);

      // Determine recommended payout based on verification
      let recommendedPayout = grossClaimAmount;
      let adjustmentReason = null;

      if (verification.overallStatus === 'failed') {
        // Reduce payout if verification checks fail
        const failedChecks = verification.checks.filter(c => !c.passed && !c.skipped);
        const reductionPct = failedChecks.length * 0.25; // 25% reduction per failed check
        recommendedPayout = grossClaimAmount * Math.max(0, 1 - reductionPct);
        adjustmentReason = `Verification failures: ${failedChecks.map(c => c.name).join(', ')}`;
      } else if (verification.overallStatus === 'insufficient_data') {
        adjustmentReason = 'Insufficient telemetry for full verification - manual review recommended';
      }

      const claimId = uuidv4();
      const claim = {
        id: claimId,
        tenantId: policy.tenant_id,
        policyId: policy.id,
        claimMonth: month,
        status: verification.overallStatus === 'passed' ? 'verified' : 'pending',
        actualHashprice,
        floorPrice: policy.floor_price,
        shortfallPerTH: Math.round(shortfallPerTH * 100) / 100,
        coveredHashrate: policy.covered_hashrate,
        grossClaimAmount: Math.round(grossClaimAmount * 100) / 100,
        verificationJson: {
          ...verification,
          evidence: {
            actualHashprice,
            floorPrice: policy.floor_price,
            coveredHashrate: policy.covered_hashrate,
            daysInMonth: days,
            telemetry,
          },
        },
        verificationStatus: verification.overallStatus,
        recommendedPayout: Math.round(recommendedPayout * 100) / 100,
        adjustmentReason,
      };

      try {
        createInsuranceClaim(claim);
        claimsGenerated++;
        claimsTotalAmount += grossClaimAmount;
        results.push({
          type: 'claim',
          claimId,
          policyId: policy.id,
          policyNumber: policy.policy_number,
          grossAmount: claim.grossClaimAmount,
          verificationStatus: verification.overallStatus,
        });
      } catch (error) {
        console.error(`[ClaimsVerifier] Failed to create claim for policy ${policy.id}:`, error.message);
      }
    } else {
      // ── Upside sharing: hashprice above floor ──
      try {
        const result = calculateUpsideSharing(policy.id, month, actualHashprice, days);
        if (result) {
          upsideSharingGenerated++;
          upsideTotalAmount += result.sanghaShareAmount;
          results.push({
            type: 'upside_sharing',
            upsideId: result.id,
            policyId: policy.id,
            policyNumber: policy.policy_number,
            sanghaShare: result.sanghaShareAmount,
          });
        }
      } catch (error) {
        console.error(`[ClaimsVerifier] Failed to calculate upside for policy ${policy.id}:`, error.message);
      }
    }
  }

  const summary = {
    month,
    actualHashprice,
    daysInMonth: days,
    policiesEvaluated: activePolicies.length,
    claimsGenerated,
    claimsTotalAmount: Math.round(claimsTotalAmount * 100) / 100,
    upsideSharingGenerated,
    upsideTotalAmount: Math.round(upsideTotalAmount * 100) / 100,
    results,
  };

  console.log(`[ClaimsVerifier] Month ${month}: ${claimsGenerated} claims ($${summary.claimsTotalAmount}), ${upsideSharingGenerated} upside records ($${summary.upsideTotalAmount})`);
  return summary;
}

// ─── Single Claim Verification ───────────────────────────────────────────────

/**
 * Verify (or re-verify) a specific claim.
 *
 * @param {string} claimId - Claim ID to verify
 * @returns {object} Verification result with evidence
 */
export function verifyClaim(claimId) {
  const claim = getInsuranceClaim(claimId);
  if (!claim) {
    throw new Error(`Claim not found: ${claimId}`);
  }

  // Look up the policy
  const policies = getAllInsurancePolicies();
  const policy = policies.find(p => p.id === claim.policy_id);
  if (!policy) {
    throw new Error(`Policy not found for claim: ${claim.policy_id}`);
  }

  // Run verification checks
  const telemetry = getFleetTelemetry(claim.tenant_id, claim.claim_month);
  const verification = runVerificationChecks(policy, claim.claim_month, telemetry);

  // Calculate recommended payout
  let recommendedPayout = claim.gross_claim_amount || 0;
  let adjustmentReason = null;

  if (verification.overallStatus === 'failed') {
    const failedChecks = verification.checks.filter(c => !c.passed && !c.skipped);
    const reductionPct = failedChecks.length * 0.25;
    recommendedPayout = (claim.gross_claim_amount || 0) * Math.max(0, 1 - reductionPct);
    adjustmentReason = `Verification failures: ${failedChecks.map(c => c.name).join(', ')}`;
  } else if (verification.overallStatus === 'insufficient_data') {
    adjustmentReason = 'Insufficient telemetry for full verification - manual review recommended';
  }

  // Update the claim with verification results
  const verificationJson = {
    ...verification,
    evidence: {
      actualHashprice: claim.actual_hashprice,
      floorPrice: claim.floor_price,
      coveredHashrate: claim.covered_hashrate,
      telemetry,
    },
  };

  updateInsuranceClaim(claimId, {
    verificationJson,
    verificationStatus: verification.overallStatus,
    recommendedPayout: Math.round(recommendedPayout * 100) / 100,
    adjustmentReason,
    status: verification.overallStatus === 'passed' ? 'verified' : claim.status,
  });

  return {
    claimId,
    policyId: claim.policy_id,
    month: claim.claim_month,
    verification,
    recommendedPayout: Math.round(recommendedPayout * 100) / 100,
    adjustmentReason,
  };
}

// ─── Upside Sharing ──────────────────────────────────────────────────────────

/**
 * Calculate upside sharing for a policy when hashprice is above floor.
 *
 * @param {string} policyId - Policy ID
 * @param {string} month - Month in YYYY-MM format
 * @param {number} [actualHashprice] - Actual hashprice (fetched if not provided)
 * @param {number} [days] - Days in month (calculated if not provided)
 * @returns {object|null} Upside sharing record or null
 */
export function calculateUpsideSharing(policyId, month, actualHashprice = null, days = null) {
  const policies = getAllInsurancePolicies();
  const policy = policies.find(p => p.id === policyId);
  if (!policy) {
    throw new Error(`Policy not found: ${policyId}`);
  }

  // Get hashprice if not provided
  if (actualHashprice === null) {
    actualHashprice = getActualHashprice(month);
    if (actualHashprice === null) {
      console.warn(`[ClaimsVerifier] No hashprice data for upside calculation: ${month}`);
      return null;
    }
  }

  // Only calculate if hashprice is above floor
  if (actualHashprice <= policy.floor_price) {
    return null; // No upside to share
  }

  if (days === null) {
    days = daysInMonth(month);
  }

  const upsidePerTH = actualHashprice - policy.floor_price;
  const sharePct = policy.upside_share_pct || 0.15;
  const sanghaShareAmount = upsidePerTH * sharePct * policy.covered_hashrate * days;
  const minerNetAmount = upsidePerTH * (1 - sharePct) * policy.covered_hashrate * days;

  const record = {
    id: uuidv4(),
    tenantId: policy.tenant_id,
    policyId: policy.id,
    sharingMonth: month,
    actualHashprice,
    floorPrice: policy.floor_price,
    upsidePerTH: Math.round(upsidePerTH * 100) / 100,
    sharePct,
    coveredHashrate: policy.covered_hashrate,
    sanghaShareAmount: Math.round(sanghaShareAmount * 100) / 100,
    minerNetAmount: Math.round(minerNetAmount * 100) / 100,
    status: 'calculated',
  };

  try {
    createUpsideSharing(record);
    return record;
  } catch (error) {
    console.error(`[ClaimsVerifier] Failed to create upside sharing record:`, error.message);
    return null;
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Start the monthly claims auto-generation scheduler.
 * Runs on the specified day of each month.
 *
 * @param {number} dayOfMonth - Day of the month to run (1-28, default: 3)
 * @returns {NodeJS.Timeout} The interval handle
 */
export function startClaimsScheduler(dayOfMonth = 3) {
  if (claimsSchedulerInterval) {
    console.log('[ClaimsVerifier] Scheduler already running');
    return claimsSchedulerInterval;
  }

  console.log(`[ClaimsVerifier] Starting claims scheduler (runs on day ${dayOfMonth} of each month)`);

  // Check every hour if it's time to generate claims
  claimsSchedulerInterval = setInterval(async () => {
    const now = new Date();
    if (now.getDate() === dayOfMonth && now.getHours() === 2) {
      // Generate claims for the previous month
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const monthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

      console.log(`[ClaimsVerifier] Scheduler triggered for month: ${monthStr}`);
      try {
        await generateMonthlyClaims(monthStr);
      } catch (error) {
        console.error(`[ClaimsVerifier] Scheduled claim generation failed:`, error.message);
      }
    }
  }, 60 * 60 * 1000); // Check every hour

  return claimsSchedulerInterval;
}

/**
 * Stop the claims scheduler.
 */
export function stopClaimsScheduler() {
  if (claimsSchedulerInterval) {
    clearInterval(claimsSchedulerInterval);
    claimsSchedulerInterval = null;
    console.log('[ClaimsVerifier] Scheduler stopped');
  }
}

export default {
  generateMonthlyClaims,
  verifyClaim,
  calculateUpsideSharing,
  startClaimsScheduler,
  stopClaimsScheduler,
};
