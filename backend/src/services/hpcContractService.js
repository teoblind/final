/**
 * HPC Contract Management & SLA Tracking Service — Phase 7
 *
 * Manages high-performance compute contracts (reserved, interruptible, spot),
 * tracks SLA compliance against uptime targets, computes curtailment
 * constraints derived from active contracts, and provides calendar/renewal
 * views for the operations dashboard.
 */

import {
  getHpcContracts,
  getHpcContract,
  createHpcContract,
  updateHpcContract,
  deleteHpcContract,
  insertSlaEvent,
  getSlaEvents,
  getSlaEventsSummary,
  getAllSlaSummary,
} from '../cache/database.js';

// ─── Contract Aggregation ───────────────────────────────────────────────────

/**
 * Aggregate summary metrics across all active HPC contracts.
 *
 * @returns {{
 *   totalFirmMW: number,
 *   totalInterruptibleMW: number,
 *   totalSpotMW: number,
 *   totalMonthlyRevenue: number,
 *   avgWeightedSLA: number,
 *   curtailableCapacityMW: number
 * }}
 */
export function getContractSummary() {
  const contracts = getHpcContracts('active');

  let totalFirmMW = 0;
  let totalInterruptibleMW = 0;
  let totalSpotMW = 0;
  let totalMonthlyRevenue = 0;
  let weightedSlaSum = 0;
  let totalPowerForSla = 0;

  for (const c of contracts) {
    const powerMW = c.power_draw_mw || 0;
    const monthlyRev = c.monthly_revenue || 0;
    const sla = c.uptime_sla || 99.0;
    const contractType = (c.contract_type || '').toLowerCase();

    totalMonthlyRevenue += monthlyRev;
    weightedSlaSum += sla * powerMW;
    totalPowerForSla += powerMW;

    if (contractType === 'spot' || contractType === 'burst') {
      totalSpotMW += powerMW;
    } else if (c.interruptible || contractType === 'interruptible') {
      totalInterruptibleMW += powerMW;
    } else {
      // reserved, dedicated, firm
      totalFirmMW += powerMW;
    }
  }

  const avgWeightedSLA = totalPowerForSla > 0
    ? weightedSlaSum / totalPowerForSla
    : 0;

  // Curtailable = interruptible + spot (firm capacity cannot be curtailed)
  const curtailableCapacityMW = totalInterruptibleMW + totalSpotMW;

  return {
    totalFirmMW,
    totalInterruptibleMW,
    totalSpotMW,
    totalMonthlyRevenue,
    avgWeightedSLA,
    curtailableCapacityMW,
  };
}

// ─── SLA Compliance ─────────────────────────────────────────────────────────

/**
 * Calculate SLA compliance for a specific contract over a rolling window.
 *
 * @param {string} contractId
 * @param {number} [days=30] — Rolling window in days
 * @returns {{
 *   contractId: string,
 *   customer: string,
 *   totalMinutesInPeriod: number,
 *   downtimeMinutes: number,
 *   uptimePercent: number,
 *   slaTarget: number,
 *   slaBuffer: number,
 *   breachRisk: 'low'|'medium'|'high',
 *   penalties: number
 * }}
 */
export function getContractSlaCompliance(contractId, days = 30) {
  const contract = getHpcContract(contractId);
  if (!contract) {
    return null;
  }

  const summary = getSlaEventsSummary(contractId, days);

  const totalMinutesInPeriod = days * 24 * 60;
  const downtimeMinutes = summary.total_downtime_minutes || 0;
  const uptimeMinutes = totalMinutesInPeriod - downtimeMinutes;
  const uptimePercent = totalMinutesInPeriod > 0
    ? (uptimeMinutes / totalMinutesInPeriod) * 100
    : 100;

  const slaTarget = contract.uptime_sla || 99.9;

  // Buffer: how many more minutes of downtime before breaching SLA
  const maxAllowedDowntime = totalMinutesInPeriod * (1 - slaTarget / 100);
  const slaBuffer = Math.max(0, maxAllowedDowntime - downtimeMinutes);

  // Risk assessment
  let breachRisk;
  if (uptimePercent < slaTarget) {
    breachRisk = 'high'; // Already in breach
  } else if (slaBuffer < 30) {
    breachRisk = 'high'; // Less than 30 minutes buffer
  } else if (slaBuffer < 120) {
    breachRisk = 'medium'; // Less than 2 hours buffer
  } else {
    breachRisk = 'low';
  }

  const penalties = summary.total_penalties || 0;

  return {
    contractId,
    customer: contract.customer,
    totalMinutesInPeriod,
    downtimeMinutes,
    uptimePercent,
    slaTarget,
    slaBuffer,
    breachRisk,
    penalties,
  };
}

/**
 * Get SLA compliance for all active contracts.
 *
 * @param {number} [days=30]
 * @returns {Array<object>}
 */
export function getAllSlaCompliance(days = 30) {
  const contracts = getHpcContracts('active');
  const results = [];

  for (const contract of contracts) {
    const compliance = getContractSlaCompliance(contract.id, days);
    if (compliance) {
      results.push(compliance);
    }
  }

  return results;
}

// ─── SLA Breach Risk Detection ──────────────────────────────────────────────

/**
 * Scan all active contracts for SLA breach risk.
 * Returns warnings for any contract where the remaining buffer is less than
 * 30 minutes for a 99.9% SLA (scaled proportionally for other SLA tiers).
 *
 * @returns {Array<{
 *   contractId: string,
 *   customer: string,
 *   slaTarget: number,
 *   uptimePercent: number,
 *   slaBuffer: number,
 *   breachRisk: string,
 *   message: string
 * }>}
 */
export function checkSlaBreachRisk() {
  const contracts = getHpcContracts('active');
  const warnings = [];

  for (const contract of contracts) {
    const compliance = getContractSlaCompliance(contract.id, 30);
    if (!compliance) continue;

    // Alert threshold: scale buffer warning relative to SLA strictness.
    // For 99.9% SLA over 30 days, allowed downtime = ~43 min. Alert at <30 min.
    // For 99.5% SLA over 30 days, allowed downtime = ~216 min. Alert at <30 min still reasonable.
    const isAtRisk = compliance.breachRisk === 'high' || compliance.breachRisk === 'medium';

    if (isAtRisk) {
      const inBreach = compliance.uptimePercent < compliance.slaTarget;
      const message = inBreach
        ? `SLA BREACH: ${contract.customer} contract is at ${compliance.uptimePercent.toFixed(3)}% uptime, below ${compliance.slaTarget}% target. Penalties accruing.`
        : `SLA WARNING: ${contract.customer} contract has only ${compliance.slaBuffer.toFixed(1)} minutes of downtime buffer remaining before ${compliance.slaTarget}% SLA breach.`;

      warnings.push({
        contractId: contract.id,
        customer: contract.customer,
        slaTarget: compliance.slaTarget,
        uptimePercent: compliance.uptimePercent,
        slaBuffer: compliance.slaBuffer,
        breachRisk: compliance.breachRisk,
        message,
      });
    }
  }

  return warnings;
}

// ─── Curtailment Constraints from Contracts ─────────────────────────────────

/**
 * Build HPC curtailment constraints from all active contracts.
 *
 * Returns an object describing how much HPC capacity can be curtailed, for
 * how long, and at what cost — used by the curtailment engine to make
 * workload-aware decisions.
 *
 * @returns {{
 *   firmCapacityMW: number,
 *   interruptibleCapacityMW: number,
 *   maxCurtailmentHoursPerMonth: number,
 *   minimumNoticeMinutes: number,
 *   curtailmentPenaltyPerMWH: number,
 *   curtailmentPriority: string[]
 * }}
 */
export function getHpcCurtailmentConstraints() {
  const contracts = getHpcContracts('active');

  let firmCapacityMW = 0;
  let interruptibleCapacityMW = 0;
  let weightedPenaltySum = 0;
  let penaltyWeightMW = 0;
  let minNoticeMinutes = Infinity;
  let minMaxHoursPerMonth = Infinity;

  for (const c of contracts) {
    const powerMW = c.power_draw_mw || 0;
    const contractType = (c.contract_type || '').toLowerCase();
    const isInterruptible = c.interruptible ||
      contractType === 'interruptible' ||
      contractType === 'spot' ||
      contractType === 'burst' ||
      contractType === 'batch_interruptible';

    if (isInterruptible) {
      interruptibleCapacityMW += powerMW;

      // Accumulate weighted penalty for interruptible contracts
      const penalty = c.curtailment_penalty || 0;
      weightedPenaltySum += penalty * powerMW;
      penaltyWeightMW += powerMW;

      // Track most restrictive notice period across interruptible contracts
      const noticeMin = c.curtailment_notice_min || 0;
      if (noticeMin > 0 && noticeMin < minNoticeMinutes) {
        minNoticeMinutes = noticeMin;
      }

      // Track most restrictive max curtailment hours
      const maxHours = c.curtailment_max_hours || 0;
      if (maxHours > 0 && maxHours < minMaxHoursPerMonth) {
        minMaxHoursPerMonth = maxHours;
      }
    } else {
      firmCapacityMW += powerMW;
    }
  }

  // Weighted average penalty across interruptible contracts
  const curtailmentPenaltyPerMWH = penaltyWeightMW > 0
    ? weightedPenaltySum / penaltyWeightMW
    : 0;

  // Default to reasonable values if no constraints found
  const minimumNoticeMinutes = minNoticeMinutes === Infinity ? 0 : minNoticeMinutes;
  const maxCurtailmentHoursPerMonth = minMaxHoursPerMonth === Infinity ? 0 : minMaxHoursPerMonth;

  // Priority order: curtail spot first, then burst, then interruptible batch,
  // then reserved-interruptible. Firm capacity is never curtailed.
  const curtailmentPriority = [
    'spot',
    'burst',
    'batch_interruptible',
    'reserved_interruptible',
  ];

  return {
    firmCapacityMW,
    interruptibleCapacityMW,
    maxCurtailmentHoursPerMonth,
    minimumNoticeMinutes,
    curtailmentPenaltyPerMWH,
    curtailmentPriority,
  };
}

// ─── Curtailment Penalty Calculation ────────────────────────────────────────

/**
 * Calculate the total penalty cost for curtailing a given amount of HPC
 * capacity for a specified duration.
 *
 * Allocates curtailment across the provided contracts in priority order
 * (lowest penalty first) and sums up total penalty cost.
 *
 * @param {number} capacityMW — MW to curtail
 * @param {number} durationHours — Duration of curtailment
 * @param {Array<object>} contracts — Contracts to evaluate (from DB rows)
 * @returns {{ totalPenalty: number, affectedContracts: Array<{ contractId: string, customer: string, curtailedMW: number, penalty: number }> }}
 */
export function calculateCurtailmentPenalty(capacityMW, durationHours, contracts) {
  // Filter to interruptible contracts and sort by penalty rate ascending
  // (curtail cheapest-penalty contracts first)
  const interruptible = contracts
    .filter(c => {
      const type = (c.contract_type || '').toLowerCase();
      return c.interruptible ||
        type === 'interruptible' ||
        type === 'spot' ||
        type === 'burst' ||
        type === 'batch_interruptible';
    })
    .sort((a, b) => (a.curtailment_penalty || 0) - (b.curtailment_penalty || 0));

  let remainingMW = capacityMW;
  let totalPenalty = 0;
  const affectedContracts = [];

  for (const c of interruptible) {
    if (remainingMW <= 0) break;

    const contractPowerMW = c.power_draw_mw || 0;
    const curtailedMW = Math.min(remainingMW, contractPowerMW);
    const penaltyRate = c.curtailment_penalty || 0; // $/MWh
    const penalty = curtailedMW * durationHours * penaltyRate;

    affectedContracts.push({
      contractId: c.id,
      customer: c.customer,
      curtailedMW,
      penalty,
    });

    totalPenalty += penalty;
    remainingMW -= curtailedMW;
  }

  return {
    totalPenalty,
    affectedContracts,
  };
}

// ─── Contract Calendar ──────────────────────────────────────────────────────

/**
 * Return all contracts sorted by end date with days-until-expiry and
 * renewal status indicators. Used by the dashboard calendar view.
 *
 * @returns {Array<{
 *   id: string,
 *   customer: string,
 *   contractType: string,
 *   powerDrawMW: number,
 *   monthlyRevenue: number,
 *   startDate: string,
 *   endDate: string,
 *   autoRenew: boolean,
 *   status: string,
 *   daysUntilExpiry: number|null,
 *   renewalStatus: 'auto_renew'|'expiring_soon'|'active'|'expired'
 * }>}
 */
export function getContractCalendar() {
  const contracts = getHpcContracts();
  const now = new Date();

  const calendar = contracts.map(c => {
    const endDate = c.end_date ? new Date(c.end_date) : null;
    const daysUntilExpiry = endDate
      ? Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    let renewalStatus;
    if (c.status !== 'active') {
      renewalStatus = 'expired';
    } else if (c.auto_renew) {
      renewalStatus = 'auto_renew';
    } else if (daysUntilExpiry !== null && daysUntilExpiry <= 90) {
      renewalStatus = 'expiring_soon';
    } else {
      renewalStatus = 'active';
    }

    return {
      id: c.id,
      customer: c.customer,
      contractType: c.contract_type,
      powerDrawMW: c.power_draw_mw || 0,
      monthlyRevenue: c.monthly_revenue || 0,
      startDate: c.start_date || null,
      endDate: c.end_date || null,
      autoRenew: !!c.auto_renew,
      status: c.status,
      daysUntilExpiry,
      renewalStatus,
    };
  });

  // Sort by end_date ascending (soonest expiry first), nulls last
  calendar.sort((a, b) => {
    if (a.endDate === null && b.endDate === null) return 0;
    if (a.endDate === null) return 1;
    if (b.endDate === null) return -1;
    return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
  });

  return calendar;
}

// ─── Default Export ─────────────────────────────────────────────────────────

export default {
  getContractSummary,
  getContractSlaCompliance,
  getAllSlaCompliance,
  checkSlaBreachRisk,
  getHpcCurtailmentConstraints,
  calculateCurtailmentPenalty,
  getContractCalendar,
};
