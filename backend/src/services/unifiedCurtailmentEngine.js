/**
 * Unified Curtailment Engine - Phase 7
 *
 * Extends the existing BTC mining curtailment engine to support HPC/AI workloads.
 * Provides unified curtailment recommendations across both BTC mining and HPC
 * compute workloads with contract-aware, SLA-respecting decision making.
 *
 * Key principles:
 *   - Backwards compatible: if no HPC workloads are configured, delegates
 *     entirely to the original curtailment engine (pure BTC miners see no change)
 *   - Contract-aware: firm capacity is never curtailed; interruptible capacity
 *     factors in penalty costs before recommending curtailment
 *   - Unified view: site-level summary across all workload types
 *   - Transparent reasoning: every recommendation includes human-readable rationale
 */

import { getCurrentRecommendation, generateSchedule } from './curtailmentEngine.js';
import { getWorkloads, getHpcContracts, getSlaEventsSummary, getAllWorkloadSnapshots } from '../cache/database.js';
import { getHpcCurtailmentConstraints, calculateCurtailmentPenalty } from './hpcContractService.js';
import { getCache, getFleetConfig, getEnergySettings } from '../cache/database.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Get current real-time energy price in $/MWh from cache.
 * Replicates the logic from curtailmentEngine.js so the unified engine
 * can independently resolve the energy price without private access.
 */
function getCurrentEnergyPriceMWh() {
  const defaultNode = getDefaultNode();
  const iso = 'ERCOT';

  const cacheKey = `energy-rt-${iso}-${defaultNode}`;
  const cached = getCache(cacheKey);
  if (cached?.data?.realTimePrice?.lmp !== undefined) {
    return cached.data.realTimePrice.lmp;
  }

  const rtCache = getCache('energy-realtime-prices');
  if (rtCache?.data?.[defaultNode] !== undefined) {
    return rtCache.data[defaultNode];
  }

  // Fallback: use fleet default energy cost converted to $/MWh
  const config = getFleetConfig();
  const defaultKWh = config?.defaultEnergyCostKWh || 0.05;
  return defaultKWh * 1000;
}

/**
 * Get the default ERCOT node from energy settings or fleet config.
 */
function getDefaultNode() {
  try {
    const settings = getEnergySettings();
    if (settings?.primaryNode) return settings.primaryNode;
    if (settings?.defaultNode) return settings.defaultNode;
  } catch (e) { /* ignore */ }

  return 'HB_NORTH';
}

// ─── HPC Workload Evaluator ────────────────────────────────────────────────

/**
 * Evaluate an individual HPC workload's curtailment recommendation.
 *
 * Contract types handled:
 *   - firm / reserved (non-interruptible): ALWAYS run, never curtail
 *   - spot / burst: treat like BTC mining - curtail when energy cost > spot revenue
 *   - interruptible reserved: curtail only when energy_savings > (contract_revenue + curtailment_penalty)
 *
 * @param {object} workload - Workload row from the database
 * @param {Array}  contracts - HPC contracts associated with this workload
 * @param {number} energyPriceMWh - Current energy price in $/MWh
 * @returns {object} Per-workload curtailment evaluation
 */
function evaluateHpcWorkload(workload, contracts, energyPriceMWh) {
  const powerMW = workload.power_allocation_mw || 0;
  const energyCostPerHr = powerMW * energyPriceMWh; // $/hr

  // Parse stored JSON fields safely
  let revenueModel = {};
  try { revenueModel = JSON.parse(workload.revenue_model_json || '{}'); } catch (e) { /* ignore */ }
  let curtailmentProfile = {};
  try { curtailmentProfile = JSON.parse(workload.curtailment_profile_json || '{}'); } catch (e) { /* ignore */ }

  // If there are no contracts for this workload, treat all capacity as spot
  if (!contracts || contracts.length === 0) {
    const spotRevenuePerHr = revenueModel.spotRevenuePerHr || revenueModel.revenuePerHr || 0;
    const netRevenuePerHr = spotRevenuePerHr - energyCostPerHr;
    const shouldCurtail = energyCostPerHr > spotRevenuePerHr;

    return {
      workloadId: workload.id,
      workloadName: workload.name,
      workloadType: workload.type,
      powerMW,
      contractType: 'spot',
      action: shouldCurtail ? 'CURTAIL' : 'RUN',
      confidence: 'high',
      revenuePerHr: spotRevenuePerHr,
      energyCostPerHr,
      netRevenuePerHr,
      curtailmentSavings: shouldCurtail ? energyCostPerHr : 0,
      curtailmentPenalty: 0,
      netBenefitOfCurtailment: shouldCurtail ? (energyCostPerHr - spotRevenuePerHr) : -(spotRevenuePerHr - energyCostPerHr),
      firmCapacityMW: 0,
      flexibleCapacityMW: powerMW,
      reason: shouldCurtail
        ? `Spot HPC workload "${workload.name}": energy cost ($${energyCostPerHr.toFixed(2)}/hr) exceeds spot revenue ($${spotRevenuePerHr.toFixed(2)}/hr). Recommend curtailment.`
        : `Spot HPC workload "${workload.name}": spot revenue ($${spotRevenuePerHr.toFixed(2)}/hr) exceeds energy cost ($${energyCostPerHr.toFixed(2)}/hr). Keep running.`,
    };
  }

  // Aggregate across all contracts for this workload
  let firmCapacityMW = 0;
  let firmRevenuePerHr = 0;
  let spotCapacityMW = 0;
  let spotRevenuePerHr = 0;
  let interruptibleCapacityMW = 0;
  let interruptibleRevenuePerHr = 0;
  let totalPenaltyPerHr = 0;

  let curtailableCapacityMW = 0;
  let curtailableRevenuePerHr = 0;
  let curtailableSavingsPerHr = 0;
  let curtailablePenaltyPerHr = 0;

  const contractDetails = [];

  for (const contract of contracts) {
    const contractPowerMW = contract.power_draw_mw || 0;
    const contractRevenuePerHr = (contract.monthly_revenue || 0) / (30 * 24);
    const isInterruptible = contract.interruptible === 1 || contract.interruptible === true;
    const contractType = (contract.contract_type || '').toLowerCase();
    const isFirm = !isInterruptible && (contractType === 'firm' || contractType === 'reserved' || contractType === 'dedicated');
    const isSpot = contractType === 'spot' || contractType === 'burst';

    // Get penalty for this contract
    let penaltyPerHr = 0;
    try {
      penaltyPerHr = calculateCurtailmentPenalty(contract.id, 60) / 60; // per-minute to per-hour
    } catch (e) {
      // Fallback: use contract's stated penalty rate
      penaltyPerHr = (contract.curtailment_penalty || 0);
    }

    const contractEnergyCostPerHr = contractPowerMW * energyPriceMWh;

    if (isFirm) {
      // Firm: never curtail
      firmCapacityMW += contractPowerMW;
      firmRevenuePerHr += contractRevenuePerHr;
      contractDetails.push({
        contractId: contract.id,
        customer: contract.customer,
        type: 'firm',
        powerMW: contractPowerMW,
        action: 'RUN',
        reason: `Firm contract for ${contract.customer}: non-interruptible, always runs.`,
      });
    } else if (isSpot) {
      // Spot: curtail when energy cost > spot revenue (like BTC)
      spotCapacityMW += contractPowerMW;
      spotRevenuePerHr += contractRevenuePerHr;
      const shouldCurtailSpot = contractEnergyCostPerHr > contractRevenuePerHr;
      if (shouldCurtailSpot) {
        curtailableCapacityMW += contractPowerMW;
        curtailableRevenuePerHr += contractRevenuePerHr;
        curtailableSavingsPerHr += contractEnergyCostPerHr;
      }
      contractDetails.push({
        contractId: contract.id,
        customer: contract.customer,
        type: 'spot',
        powerMW: contractPowerMW,
        action: shouldCurtailSpot ? 'CURTAIL' : 'RUN',
        reason: shouldCurtailSpot
          ? `Spot contract (${contract.customer}): energy cost ($${contractEnergyCostPerHr.toFixed(2)}/hr) > revenue ($${contractRevenuePerHr.toFixed(2)}/hr).`
          : `Spot contract (${contract.customer}): revenue ($${contractRevenuePerHr.toFixed(2)}/hr) >= energy cost ($${contractEnergyCostPerHr.toFixed(2)}/hr).`,
      });
    } else {
      // Interruptible reserved: curtail only when savings > (revenue + penalty)
      interruptibleCapacityMW += contractPowerMW;
      interruptibleRevenuePerHr += contractRevenuePerHr;
      totalPenaltyPerHr += penaltyPerHr;
      const energySaved = contractEnergyCostPerHr;
      const curtailmentCost = contractRevenuePerHr + penaltyPerHr;
      const shouldCurtailInterruptible = energySaved > curtailmentCost;

      if (shouldCurtailInterruptible) {
        curtailableCapacityMW += contractPowerMW;
        curtailableRevenuePerHr += contractRevenuePerHr;
        curtailableSavingsPerHr += contractEnergyCostPerHr;
        curtailablePenaltyPerHr += penaltyPerHr;
      }
      contractDetails.push({
        contractId: contract.id,
        customer: contract.customer,
        type: 'interruptible',
        powerMW: contractPowerMW,
        action: shouldCurtailInterruptible ? 'CURTAIL' : 'RUN',
        penaltyPerHr,
        reason: shouldCurtailInterruptible
          ? `Interruptible contract (${contract.customer}): energy savings ($${energySaved.toFixed(2)}/hr) > contract revenue + penalty ($${curtailmentCost.toFixed(2)}/hr). Curtailment recommended.`
          : `Interruptible contract (${contract.customer}): contract revenue + penalty ($${curtailmentCost.toFixed(2)}/hr) >= energy savings ($${energySaved.toFixed(2)}/hr). Keep running.`,
      });
    }
  }

  // Determine overall action for this workload
  const totalRevenuePerHr = firmRevenuePerHr + spotRevenuePerHr + interruptibleRevenuePerHr;
  const totalNetRevenue = totalRevenuePerHr - energyCostPerHr;
  const onlineMW = powerMW - curtailableCapacityMW;
  const shouldCurtailAny = curtailableCapacityMW > 0;

  // Build reasoning string
  const reasonParts = [];
  if (firmCapacityMW > 0) {
    reasonParts.push(`${firmCapacityMW.toFixed(1)} MW firm capacity always running`);
  }
  if (curtailableCapacityMW > 0) {
    reasonParts.push(`${curtailableCapacityMW.toFixed(1)} MW recommended for curtailment (saves $${curtailableSavingsPerHr.toFixed(2)}/hr, penalties $${curtailablePenaltyPerHr.toFixed(2)}/hr)`);
  }
  if (spotCapacityMW > 0 && curtailableCapacityMW === 0) {
    reasonParts.push(`${spotCapacityMW.toFixed(1)} MW spot capacity profitable, keep running`);
  }
  if (interruptibleCapacityMW > 0 && curtailableCapacityMW === 0) {
    reasonParts.push(`${interruptibleCapacityMW.toFixed(1)} MW interruptible capacity profitable after penalty, keep running`);
  }

  return {
    workloadId: workload.id,
    workloadName: workload.name,
    workloadType: workload.type,
    powerMW,
    action: shouldCurtailAny ? 'PARTIAL' : 'RUN',
    confidence: shouldCurtailAny ? 'high' : 'high',
    revenuePerHr: totalRevenuePerHr,
    energyCostPerHr,
    netRevenuePerHr: totalNetRevenue,
    curtailmentSavings: curtailableSavingsPerHr,
    curtailmentPenalty: curtailablePenaltyPerHr,
    netBenefitOfCurtailment: curtailableSavingsPerHr - curtailableRevenuePerHr - curtailablePenaltyPerHr,
    firmCapacityMW,
    flexibleCapacityMW: spotCapacityMW + interruptibleCapacityMW,
    onlineMW,
    curtailedMW: curtailableCapacityMW,
    contractDetails,
    reason: `HPC workload "${workload.name}" @ $${energyPriceMWh.toFixed(2)}/MWh: ${reasonParts.join('; ')}.`,
  };
}

// ─── Unified Recommendation ────────────────────────────────────────────────

/**
 * Get a unified curtailment recommendation across all workload types.
 *
 * If no HPC workloads exist, delegates entirely to the existing BTC curtailment
 * engine and wraps the result for shape compatibility.
 *
 * @returns {object} UnifiedCurtailmentRecommendation
 */
export async function getUnifiedRecommendation() {
  // Fetch all configured workloads
  let workloads = [];
  try {
    workloads = getWorkloads() || [];
  } catch (e) {
    workloads = [];
  }

  const hpcWorkloads = workloads.filter(w => w.type !== 'btc_mining');

  // If no HPC workloads, delegate entirely to existing engine
  if (hpcWorkloads.length === 0) {
    const btcRecommendation = await getCurrentRecommendation();
    return {
      unified: true,
      hasHpcWorkloads: false,
      timestamp: new Date().toISOString(),
      btcRecommendation,
      hpcRecommendations: [],
      siteSummary: buildSiteSummaryFromBtcOnly(btcRecommendation),
      reasoning: 'No HPC workloads configured. Recommendation based on BTC mining fleet only.',
    };
  }

  // Get BTC recommendation from existing engine
  const btcRecommendation = await getCurrentRecommendation();

  // Get energy price for HPC evaluation
  const energyPriceMWh = getCurrentEnergyPriceMWh();

  // Fetch all HPC contracts
  let allContracts = [];
  try {
    allContracts = getHpcContracts('active') || [];
  } catch (e) {
    allContracts = [];
  }

  // Evaluate each HPC workload
  const hpcRecommendations = [];
  for (const workload of hpcWorkloads) {
    // Find contracts linked to this workload (by site or workload id)
    let workloadContracts = allContracts;

    // Get HPC-specific curtailment constraints for this workload
    let constraints = {};
    try {
      constraints = getHpcCurtailmentConstraints(workload.id) || {};
    } catch (e) {
      constraints = {};
    }

    const evaluation = evaluateHpcWorkload(workload, workloadContracts, energyPriceMWh);
    hpcRecommendations.push(evaluation);
  }

  // Build unified site summary
  const siteSummary = buildSiteSummary(btcRecommendation, hpcRecommendations, energyPriceMWh);

  // Build overall reasoning
  const reasoningParts = [];
  if (btcRecommendation.hasFleet) {
    reasoningParts.push(`BTC fleet: ${btcRecommendation.fleetState} (${btcRecommendation.summary?.miningMachines || 0} mining, ${btcRecommendation.summary?.curtailedMachines || 0} curtailed)`);
  }
  for (const hpc of hpcRecommendations) {
    reasoningParts.push(`HPC "${hpc.workloadName}": ${hpc.action} (${hpc.onlineMW?.toFixed(1) || hpc.powerMW?.toFixed(1)} MW online, ${hpc.curtailedMW?.toFixed(1) || '0.0'} MW curtailed)`);
  }
  reasoningParts.push(`Energy price: $${energyPriceMWh.toFixed(2)}/MWh`);
  reasoningParts.push(`Site net revenue: $${siteSummary.totalNetRevenue.toFixed(2)}/hr`);
  if (siteSummary.curtailmentSavings > 0) {
    reasoningParts.push(`Curtailment net benefit: $${siteSummary.netBenefit.toFixed(2)}/hr (savings $${siteSummary.curtailmentSavings.toFixed(2)}/hr - penalties $${siteSummary.curtailmentPenalties.toFixed(2)}/hr)`);
  }

  return {
    unified: true,
    hasHpcWorkloads: true,
    timestamp: new Date().toISOString(),
    energyPrice: {
      current: energyPriceMWh,
      unit: '$/MWh',
    },
    btcRecommendation,
    hpcRecommendations,
    siteSummary,
    reasoning: reasoningParts.join('. ') + '.',
  };
}

/**
 * Build a site-level summary from only BTC recommendation (no HPC).
 */
function buildSiteSummaryFromBtcOnly(btcRec) {
  if (!btcRec.hasFleet) {
    return {
      totalCapacityMW: 0,
      onlineMW: 0,
      curtailedMW: 0,
      firmMW: 0,
      flexibleMW: 0,
      totalRevenueRate: 0,
      totalEnergyCost: 0,
      totalNetRevenue: 0,
      curtailmentSavings: 0,
      curtailmentPenalties: 0,
      netBenefit: 0,
    };
  }

  const s = btcRec.summary || {};
  const totalCapacityMW = (s.miningPowerMW || 0) + (s.curtailedPowerMW || 0);

  return {
    totalCapacityMW,
    onlineMW: s.miningPowerMW || 0,
    curtailedMW: s.curtailedPowerMW || 0,
    firmMW: 0, // BTC mining has no firm contracts
    flexibleMW: totalCapacityMW, // All BTC mining capacity is flexible
    totalRevenueRate: s.revenuePerHr || 0,
    totalEnergyCost: s.costPerHr || 0,
    totalNetRevenue: s.netRevenuePerHr || 0,
    curtailmentSavings: s.curtailmentSavingsPerHr || 0,
    curtailmentPenalties: 0,
    netBenefit: s.curtailmentSavingsPerHr || 0,
  };
}

/**
 * Build a unified site-level summary combining BTC and HPC workloads.
 */
function buildSiteSummary(btcRec, hpcRecommendations, energyPriceMWh) {
  const btcSummary = buildSiteSummaryFromBtcOnly(btcRec);

  let hpcTotalCapacityMW = 0;
  let hpcOnlineMW = 0;
  let hpcCurtailedMW = 0;
  let hpcFirmMW = 0;
  let hpcFlexibleMW = 0;
  let hpcRevenueRate = 0;
  let hpcEnergyCost = 0;
  let hpcCurtailmentSavings = 0;
  let hpcCurtailmentPenalties = 0;

  for (const hpc of hpcRecommendations) {
    hpcTotalCapacityMW += hpc.powerMW || 0;
    hpcOnlineMW += hpc.onlineMW ?? (hpc.powerMW || 0);
    hpcCurtailedMW += hpc.curtailedMW || 0;
    hpcFirmMW += hpc.firmCapacityMW || 0;
    hpcFlexibleMW += hpc.flexibleCapacityMW || 0;
    hpcRevenueRate += hpc.revenuePerHr || 0;
    hpcEnergyCost += hpc.energyCostPerHr || 0;
    hpcCurtailmentSavings += hpc.curtailmentSavings || 0;
    hpcCurtailmentPenalties += hpc.curtailmentPenalty || 0;
  }

  const totalCapacityMW = btcSummary.totalCapacityMW + hpcTotalCapacityMW;
  const onlineMW = btcSummary.onlineMW + hpcOnlineMW;
  const curtailedMW = btcSummary.curtailedMW + hpcCurtailedMW;
  const firmMW = btcSummary.firmMW + hpcFirmMW;
  const flexibleMW = btcSummary.flexibleMW + hpcFlexibleMW;
  const totalRevenueRate = btcSummary.totalRevenueRate + hpcRevenueRate;
  const totalEnergyCost = btcSummary.totalEnergyCost + hpcEnergyCost;
  const totalNetRevenue = totalRevenueRate - totalEnergyCost;
  const curtailmentSavings = btcSummary.curtailmentSavings + hpcCurtailmentSavings;
  const curtailmentPenalties = btcSummary.curtailmentPenalties + hpcCurtailmentPenalties;
  const netBenefit = curtailmentSavings - curtailmentPenalties;

  return {
    totalCapacityMW,
    onlineMW,
    curtailedMW,
    firmMW,
    flexibleMW,
    totalRevenueRate,
    totalEnergyCost,
    totalNetRevenue,
    curtailmentSavings,
    curtailmentPenalties,
    netBenefit,
  };
}

// ─── Unified Schedule Generator ────────────────────────────────────────────

/**
 * Generate a unified 24-hour operating schedule across BTC and HPC workloads.
 *
 * If no HPC workloads, delegates to the existing BTC schedule generator and
 * wraps the result.
 *
 * HPC schedule logic:
 *   - Firm capacity: solid "RUN" for all 24 hours
 *   - Spot capacity: follows same breakeven logic as BTC
 *   - Interruptible: penalty-aware breakeven per hour
 *
 * @param {object} opts - Options passed through to existing schedule generator
 * @returns {object} Unified schedule with btcSchedule and hpcSchedule sections
 */
export async function generateUnifiedSchedule(opts = {}) {
  // Fetch all configured workloads
  let workloads = [];
  try {
    workloads = getWorkloads() || [];
  } catch (e) {
    workloads = [];
  }

  const hpcWorkloads = workloads.filter(w => w.type !== 'btc_mining');

  // If no HPC workloads, delegate entirely to existing engine
  if (hpcWorkloads.length === 0) {
    const btcSchedule = await generateSchedule(opts);
    return {
      unified: true,
      hasHpcWorkloads: false,
      timestamp: new Date().toISOString(),
      btcSchedule,
      hpcSchedule: [],
      mergedSchedule: btcSchedule.schedule || [],
      reasoning: 'No HPC workloads configured. Schedule based on BTC mining fleet only.',
    };
  }

  // Generate BTC schedule from existing engine
  const btcSchedule = await generateSchedule(opts);

  // Fetch HPC contracts
  let allContracts = [];
  try {
    allContracts = getHpcContracts('active') || [];
  } catch (e) {
    allContracts = [];
  }

  // Build a mock day-ahead price curve (or extract from BTC schedule)
  const dayAheadPrices = extractDayAheadPrices(btcSchedule);

  // Generate HPC schedule for each workload
  const hpcScheduleEntries = [];

  for (const workload of hpcWorkloads) {
    const workloadContracts = allContracts;

    let constraints = {};
    try {
      constraints = getHpcCurtailmentConstraints(workload.id) || {};
    } catch (e) {
      constraints = {};
    }

    const hourlyActions = [];

    for (let hour = 0; hour < 24; hour++) {
      const priceMWh = dayAheadPrices[hour] ?? getCurrentEnergyPriceMWh();
      const evaluation = evaluateHpcWorkload(workload, workloadContracts, priceMWh);

      // Build per-hour action based on contract types
      const contractHourActions = [];

      if (evaluation.contractDetails && evaluation.contractDetails.length > 0) {
        for (const cd of evaluation.contractDetails) {
          if (cd.type === 'firm') {
            // Firm: always RUN for all 24 hours
            contractHourActions.push({
              contractId: cd.contractId,
              customer: cd.customer,
              type: 'firm',
              action: 'RUN',
            });
          } else if (cd.type === 'spot') {
            // Spot: follows breakeven like BTC
            contractHourActions.push({
              contractId: cd.contractId,
              customer: cd.customer,
              type: 'spot',
              action: cd.action,
            });
          } else {
            // Interruptible: penalty-aware breakeven
            contractHourActions.push({
              contractId: cd.contractId,
              customer: cd.customer,
              type: 'interruptible',
              action: cd.action,
            });
          }
        }
      } else {
        // No contracts - treat as spot
        contractHourActions.push({
          contractId: null,
          customer: null,
          type: 'spot',
          action: evaluation.action === 'CURTAIL' ? 'CURTAIL' : 'RUN',
        });
      }

      const allRunning = contractHourActions.every(a => a.action === 'RUN');
      const allCurtailed = contractHourActions.every(a => a.action === 'CURTAIL');
      const hourState = allRunning ? 'RUN' : allCurtailed ? 'CURTAIL' : 'PARTIAL';

      hourlyActions.push({
        hour,
        priceMWh,
        state: hourState,
        onlineMW: evaluation.onlineMW ?? evaluation.powerMW,
        curtailedMW: evaluation.curtailedMW || 0,
        revenuePerHr: evaluation.revenuePerHr,
        energyCostPerHr: evaluation.energyCostPerHr,
        netRevenuePerHr: evaluation.netRevenuePerHr,
        contracts: contractHourActions,
      });
    }

    const runHours = hourlyActions.filter(h => h.state === 'RUN').length;
    const curtailHours = hourlyActions.filter(h => h.state === 'CURTAIL').length;
    const partialHours = hourlyActions.filter(h => h.state === 'PARTIAL').length;

    hpcScheduleEntries.push({
      workloadId: workload.id,
      workloadName: workload.name,
      workloadType: workload.type,
      powerMW: workload.power_allocation_mw || 0,
      schedule: hourlyActions,
      summary: {
        runHours,
        curtailHours,
        partialHours,
        estimatedRevenue: hourlyActions.reduce((s, h) => s + (h.revenuePerHr || 0), 0),
        estimatedEnergyCost: hourlyActions.reduce((s, h) => s + (h.energyCostPerHr || 0), 0),
        estimatedNetRevenue: hourlyActions.reduce((s, h) => s + (h.netRevenuePerHr || 0), 0),
      },
    });
  }

  // Merge BTC model schedule with HPC entries for a unified 24-hour view
  const mergedSchedule = buildMergedSchedule(btcSchedule, hpcScheduleEntries, dayAheadPrices);

  return {
    unified: true,
    hasHpcWorkloads: true,
    timestamp: new Date().toISOString(),
    btcSchedule,
    hpcSchedule: hpcScheduleEntries,
    mergedSchedule,
    reasoning: buildScheduleReasoning(btcSchedule, hpcScheduleEntries),
  };
}

/**
 * Extract day-ahead prices from BTC schedule, or fall back to current price.
 */
function extractDayAheadPrices(btcSchedule) {
  const prices = new Array(24).fill(null);

  if (btcSchedule?.schedule && Array.isArray(btcSchedule.schedule)) {
    for (const hour of btcSchedule.schedule) {
      if (hour.hour !== undefined && hour.priceMWh !== undefined) {
        prices[hour.hour] = hour.priceMWh;
      }
    }
  }

  // Fill any gaps with current price
  const currentPrice = getCurrentEnergyPriceMWh();
  for (let i = 0; i < 24; i++) {
    if (prices[i] === null) {
      prices[i] = currentPrice;
    }
  }

  return prices;
}

/**
 * Build a merged 24-hour schedule combining BTC and HPC data.
 */
function buildMergedSchedule(btcSchedule, hpcScheduleEntries, dayAheadPrices) {
  const merged = [];

  for (let hour = 0; hour < 24; hour++) {
    const btcHour = btcSchedule?.schedule?.[hour] || null;
    const priceMWh = dayAheadPrices[hour];

    let btcPowerMW = btcHour?.miningPowerMW || 0;
    let btcCurtailedMW = btcHour?.curtailedPowerMW || 0;
    let hpcOnlineMW = 0;
    let hpcCurtailedMW = 0;

    for (const hpcEntry of hpcScheduleEntries) {
      const hpcHour = hpcEntry.schedule[hour];
      if (hpcHour) {
        hpcOnlineMW += hpcHour.onlineMW || 0;
        hpcCurtailedMW += hpcHour.curtailedMW || 0;
      }
    }

    const totalOnlineMW = btcPowerMW + hpcOnlineMW;
    const totalCurtailedMW = btcCurtailedMW + hpcCurtailedMW;

    merged.push({
      hour,
      priceMWh,
      btc: {
        state: btcHour?.state || 'UNKNOWN',
        onlineMW: btcPowerMW,
        curtailedMW: btcCurtailedMW,
      },
      hpc: {
        onlineMW: hpcOnlineMW,
        curtailedMW: hpcCurtailedMW,
      },
      totalOnlineMW,
      totalCurtailedMW,
      totalCapacityMW: totalOnlineMW + totalCurtailedMW,
    });
  }

  return merged;
}

/**
 * Build a human-readable reasoning string for the unified schedule.
 */
function buildScheduleReasoning(btcSchedule, hpcScheduleEntries) {
  const parts = [];

  if (btcSchedule?.hasFleet && btcSchedule?.summary) {
    parts.push(`BTC mining: ${btcSchedule.summary.miningHours || 0}h mining, ${btcSchedule.summary.curtailedHours || 0}h curtailed`);
  }

  for (const hpc of hpcScheduleEntries) {
    parts.push(`HPC "${hpc.workloadName}": ${hpc.summary.runHours}h running, ${hpc.summary.curtailHours}h curtailed, ${hpc.summary.partialHours}h partial`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : 'No schedule data available.';
}

// ─── Workload Economics Comparison ─────────────────────────────────────────

/**
 * Compare economics between BTC mining and HPC workloads over a given period.
 *
 * Fetches workload snapshots, groups by type, and calculates key financial
 * metrics for each type including revenue volatility and risk-adjusted return.
 *
 * @param {number} days - Number of days to look back (default 30)
 * @returns {object} WorkloadComparison with per-type economics and insight
 */
export async function compareWorkloadEconomics(days = 30) {
  // Fetch all workload snapshots for the period
  let snapshots = [];
  try {
    snapshots = getAllWorkloadSnapshots(days) || [];
  } catch (e) {
    snapshots = [];
  }

  if (snapshots.length === 0) {
    return {
      period: { days, startDate: new Date(Date.now() - days * 86400000).toISOString().split('T')[0], endDate: new Date().toISOString().split('T')[0] },
      hasData: false,
      workloadTypes: {},
      comparison: null,
      insight: `No workload snapshot data available for the last ${days} days. Snapshots are recorded daily as workloads operate.`,
    };
  }

  // Group snapshots by workload type
  const grouped = {};
  for (const snap of snapshots) {
    const type = snap.workload_type || 'unknown';
    if (!grouped[type]) {
      grouped[type] = [];
    }
    grouped[type].push(snap);
  }

  // Calculate economics for each type
  const typeEconomics = {};

  for (const [type, typeSnapshots] of Object.entries(grouped)) {
    const grossRevenue = typeSnapshots.reduce((s, r) => s + (r.gross_revenue || 0), 0);
    const energyCost = typeSnapshots.reduce((s, r) => s + (r.energy_cost || 0), 0);
    const curtailmentSavings = typeSnapshots.reduce((s, r) => s + (r.curtailment_savings || 0), 0);
    const curtailmentPenalties = typeSnapshots.reduce((s, r) => s + (r.curtailment_penalties || 0), 0);
    const netRevenue = grossRevenue - energyCost + curtailmentSavings - curtailmentPenalties;

    // Total MW across snapshots for revenuePerMW
    const totalMW = typeSnapshots.reduce((s, r) => s + (r.capacity_mw || 0), 0);
    const avgMW = typeSnapshots.length > 0 ? totalMW / typeSnapshots.length : 0;
    const revenuePerMW = avgMW > 0 ? netRevenue / avgMW : 0;

    // Margin percent
    const marginPercent = grossRevenue > 0 ? ((netRevenue / grossRevenue) * 100) : 0;

    // Curtailment flexibility: ratio of curtailed MW to total capacity
    const totalCurtailedMW = typeSnapshots.reduce((s, r) => s + (r.curtailed_mw || 0), 0);
    const totalCapacityMW = typeSnapshots.reduce((s, r) => s + (r.capacity_mw || 0), 0);
    const curtailmentFlexibility = totalCapacityMW > 0 ? Math.min(1, totalCurtailedMW / totalCapacityMW) : 0;

    // Daily revenue for volatility calculation
    const dailyRevenueMap = {};
    for (const snap of typeSnapshots) {
      const date = snap.date;
      if (!dailyRevenueMap[date]) {
        dailyRevenueMap[date] = 0;
      }
      dailyRevenueMap[date] += (snap.net_revenue || 0);
    }
    const dailyRevenues = Object.values(dailyRevenueMap);
    const revenueVolatility = calculateStdDev(dailyRevenues);

    // Risk-adjusted return: net revenue / volatility (Sharpe-like ratio)
    const avgDailyRevenue = dailyRevenues.length > 0
      ? dailyRevenues.reduce((s, v) => s + v, 0) / dailyRevenues.length
      : 0;
    const riskAdjustedReturn = revenueVolatility > 0
      ? avgDailyRevenue / revenueVolatility
      : (avgDailyRevenue > 0 ? Infinity : 0);

    typeEconomics[type] = {
      type,
      snapshotCount: typeSnapshots.length,
      daysWithData: dailyRevenues.length,
      grossRevenue,
      energyCost,
      curtailmentSavings,
      curtailmentPenalties,
      netRevenue,
      revenuePerMW,
      marginPercent,
      curtailmentFlexibility,
      revenueVolatility,
      avgDailyRevenue,
      riskAdjustedReturn,
    };
  }

  // Generate comparison insight
  const insight = generateComparisonInsight(typeEconomics, days);

  return {
    period: {
      days,
      startDate: new Date(Date.now() - days * 86400000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
    },
    hasData: true,
    workloadTypes: typeEconomics,
    comparison: buildComparisonMatrix(typeEconomics),
    insight,
  };
}

/**
 * Calculate standard deviation of an array of numbers.
 */
function calculateStdDev(values) {
  if (!values || values.length < 2) return 0;

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((s, v) => s + v, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Build a side-by-side comparison matrix between workload types.
 */
function buildComparisonMatrix(typeEconomics) {
  const types = Object.keys(typeEconomics);
  if (types.length < 2) return null;

  const matrix = {};
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const a = typeEconomics[types[i]];
      const b = typeEconomics[types[j]];
      const key = `${types[i]}_vs_${types[j]}`;
      matrix[key] = {
        revenuePerMWDelta: (b.revenuePerMW || 0) - (a.revenuePerMW || 0),
        marginDelta: (b.marginPercent || 0) - (a.marginPercent || 0),
        volatilityRatio: a.revenueVolatility > 0 ? (b.revenueVolatility / a.revenueVolatility) : null,
        riskReturnDelta: (b.riskAdjustedReturn === Infinity || a.riskAdjustedReturn === Infinity)
          ? null
          : (b.riskAdjustedReturn || 0) - (a.riskAdjustedReturn || 0),
        flexibilityDelta: (b.curtailmentFlexibility || 0) - (a.curtailmentFlexibility || 0),
      };
    }
  }

  return matrix;
}

/**
 * Generate a human-readable insight comparing workload types.
 */
function generateComparisonInsight(typeEconomics, days) {
  const types = Object.keys(typeEconomics);

  if (types.length === 0) {
    return `No workload data available for comparison over the last ${days} days.`;
  }

  if (types.length === 1) {
    const t = typeEconomics[types[0]];
    return `Only ${types[0]} workloads found over the last ${days} days. ` +
      `Net revenue: $${t.netRevenue.toFixed(2)}, margin: ${t.marginPercent.toFixed(1)}%, ` +
      `revenue/MW: $${t.revenuePerMW.toFixed(2)}/MW, volatility: $${t.revenueVolatility.toFixed(2)}/day. ` +
      `Add other workload types to enable comparison analysis.`;
  }

  // Compare BTC vs HPC if both exist
  const btc = typeEconomics['btc_mining'];
  const hpcTypes = types.filter(t => t !== 'btc_mining');

  const parts = [];
  parts.push(`Over the last ${days} days:`);

  if (btc) {
    parts.push(`BTC mining generated $${btc.netRevenue.toFixed(2)} net revenue ($${btc.revenuePerMW.toFixed(2)}/MW) with ${btc.marginPercent.toFixed(1)}% margin and $${btc.revenueVolatility.toFixed(2)}/day volatility.`);
  }

  for (const hpcType of hpcTypes) {
    const hpc = typeEconomics[hpcType];
    parts.push(`${hpcType} workloads generated $${hpc.netRevenue.toFixed(2)} net revenue ($${hpc.revenuePerMW.toFixed(2)}/MW) with ${hpc.marginPercent.toFixed(1)}% margin and $${hpc.revenueVolatility.toFixed(2)}/day volatility.`);

    if (btc) {
      const revDelta = hpc.revenuePerMW - btc.revenuePerMW;
      const betterRevPerMW = revDelta > 0 ? hpcType : 'btc_mining';
      parts.push(`Revenue/MW comparison: ${betterRevPerMW} leads by $${Math.abs(revDelta).toFixed(2)}/MW.`);

      if (btc.revenueVolatility > 0 && hpc.revenueVolatility > 0) {
        const volRatio = hpc.revenueVolatility / btc.revenueVolatility;
        if (volRatio < 0.8) {
          parts.push(`${hpcType} has significantly lower revenue volatility (${(volRatio * 100).toFixed(0)}% of BTC), offering more predictable cash flow.`);
        } else if (volRatio > 1.2) {
          parts.push(`${hpcType} has higher revenue volatility (${(volRatio * 100).toFixed(0)}% of BTC).`);
        } else {
          parts.push(`Revenue volatility is similar between workload types.`);
        }
      }

      const btcRAR = btc.riskAdjustedReturn === Infinity ? 'infinite (zero vol)' : btc.riskAdjustedReturn.toFixed(3);
      const hpcRAR = hpc.riskAdjustedReturn === Infinity ? 'infinite (zero vol)' : hpc.riskAdjustedReturn.toFixed(3);
      parts.push(`Risk-adjusted return: BTC=${btcRAR}, ${hpcType}=${hpcRAR}.`);
    }
  }

  return parts.join(' ');
}

// ─── Default Export ────────────────────────────────────────────────────────

export default {
  getUnifiedRecommendation,
  generateUnifiedSchedule,
  compareWorkloadEconomics,
};
