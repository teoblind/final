/**
 * Calibration Exporter - Phase 9
 *
 * Exports anonymized, aggregated fleet telemetry to the SanghaModel simulator
 * for calibration of its Monte Carlo risk models. All data is anonymized
 * before export - no tenant identifiers, site names, or individually
 * identifiable information leaves the platform.
 *
 * Aggregation buckets:
 *   1. Fleet: total hashrate, efficiency distribution, generation mix
 *   2. Curtailment: hours/month, thresholds, DR participation rates
 *   3. Energy: cost distribution, ISO breakdown, PPA vs spot mix
 *
 * Scheduled to run periodically (default: every 6 hours).
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllTenants,
  getSites,
  getFleetConfig,
  getEnergySettings,
  getCurtailmentSettings,
  getCurtailmentPerformance,
  getCache,
  createCalibrationExport,
  getCalibrationExports,
  getLatestCalibrationExport,
} from '../cache/database.js';
import { sendCalibrationData } from './sanghaModelClient.js';

const EXPORT_VERSION = '1.0.0';
let schedulerInterval = null;

// ─── Aggregation Helpers ─────────────────────────────────────────────────────

/**
 * Aggregate fleet data across all tenants.
 * Returns anonymized totals and distributions - no tenant identifiers.
 */
function aggregateFleetData() {
  let totalHashrateTH = 0;
  let totalPowerMW = 0;
  let machineCount = 0;
  const efficiencyBuckets = { ultra: 0, high: 0, mid: 0, low: 0 };
  const generationMix = {};

  try {
    const tenants = getAllTenants();
    let tenantsWithFleet = 0;

    for (const tenant of tenants) {
      // Attempt to read per-tenant fleet data from sites
      const sites = getSites(tenant.id);
      if (!sites || sites.length === 0) continue;

      let tenantHasFleet = false;
      for (const site of sites) {
        // Sites may link to workloads which contain fleet_json
        // For aggregation, we gather what we can from site-level data
        if (site.capacity_mw) {
          totalPowerMW += site.capacity_mw;
          tenantHasFleet = true;
        }
        if (site.energy_source) {
          generationMix[site.energy_source] = (generationMix[site.energy_source] || 0) + 1;
        }
      }
      if (tenantHasFleet) tenantsWithFleet++;
    }

    // Also include the single-tenant fleet config (legacy/default)
    const fleetConfig = getFleetConfig();
    if (fleetConfig && fleetConfig.entries) {
      for (const entry of fleetConfig.entries) {
        const qty = entry.quantity || 1;
        const hashrate = (entry.hashrate || 0) * qty;
        const power = (entry.power || 0) * qty;

        totalHashrateTH += hashrate;
        totalPowerMW += power / 1_000_000; // W to MW
        machineCount += qty;

        // Classify efficiency: J/TH
        const efficiency = entry.power && entry.hashrate ? entry.power / entry.hashrate : 999;
        if (efficiency <= 21) efficiencyBuckets.ultra++;
        else if (efficiency <= 30) efficiencyBuckets.high++;
        else if (efficiency <= 45) efficiencyBuckets.mid++;
        else efficiencyBuckets.low++;
      }
    }

    return {
      totalHashrateTH,
      totalPowerMW: Math.round(totalPowerMW * 1000) / 1000,
      machineCount,
      efficiencyDistribution: efficiencyBuckets,
      generationMix,
      tenantsIncluded: tenants.length,
    };
  } catch (error) {
    console.error('[CalibrationExporter] Fleet aggregation error:', error.message);
    return {
      totalHashrateTH: 0,
      totalPowerMW: 0,
      machineCount: 0,
      efficiencyDistribution: efficiencyBuckets,
      generationMix: {},
      tenantsIncluded: 0,
    };
  }
}

/**
 * Aggregate curtailment behavior across the platform.
 * Returns anonymized curtailment patterns.
 */
function aggregateCurtailmentData() {
  try {
    const performance = getCurtailmentPerformance(90); // Last 90 days
    const settings = getCurtailmentSettings();

    let totalCurtailedHours = 0;
    let totalMiningHours = 0;
    let totalCurtailmentSavings = 0;
    let totalEvents = 0;
    let peakEnergyPriceSeen = 0;
    const dailyRatios = [];

    for (const day of performance) {
      totalCurtailedHours += day.curtailed_hours || 0;
      totalMiningHours += day.mining_hours || 0;
      totalCurtailmentSavings += day.curtailment_savings || 0;
      totalEvents += day.curtailment_events || 0;
      if (day.peak_energy_price_mwh > peakEnergyPriceSeen) {
        peakEnergyPriceSeen = day.peak_energy_price_mwh;
      }
      if (day.mining_hours && day.curtailed_hours) {
        dailyRatios.push(day.curtailed_hours / (day.mining_hours + day.curtailed_hours));
      }
    }

    const avgCurtailmentRatio = dailyRatios.length > 0
      ? dailyRatios.reduce((a, b) => a + b, 0) / dailyRatios.length
      : 0;

    // Extract thresholds from settings (anonymized - just the numbers)
    let curtailmentThresholdMWh = null;
    let drParticipation = false;
    if (settings) {
      const parsed = typeof settings === 'string' ? JSON.parse(settings) : settings;
      curtailmentThresholdMWh = parsed.curtailmentThresholdMWh || parsed.threshold || null;
      drParticipation = !!parsed.demandResponseEnabled;
    }

    return {
      periodDays: performance.length,
      totalCurtailedHours: Math.round(totalCurtailedHours * 100) / 100,
      totalMiningHours: Math.round(totalMiningHours * 100) / 100,
      avgCurtailmentRatio: Math.round(avgCurtailmentRatio * 10000) / 10000,
      totalCurtailmentEvents: totalEvents,
      totalCurtailmentSavingsUSD: Math.round(totalCurtailmentSavings * 100) / 100,
      peakEnergyPriceMWh: peakEnergyPriceSeen,
      curtailmentThresholdMWh,
      drParticipation,
    };
  } catch (error) {
    console.error('[CalibrationExporter] Curtailment aggregation error:', error.message);
    return {
      periodDays: 0,
      totalCurtailedHours: 0,
      totalMiningHours: 0,
      avgCurtailmentRatio: 0,
      totalCurtailmentEvents: 0,
      totalCurtailmentSavingsUSD: 0,
      peakEnergyPriceMWh: 0,
      curtailmentThresholdMWh: null,
      drParticipation: false,
    };
  }
}

/**
 * Aggregate energy profiles across the platform.
 * Returns anonymized energy cost distributions and ISO breakdown.
 */
function aggregateEnergyData() {
  try {
    const energySettings = getEnergySettings();
    const tenants = getAllTenants();

    const isoBuckets = {};
    const costBuckets = { below30: 0, range30_50: 0, range50_70: 0, above70: 0 };
    let totalEnergyCostAvg = 0;
    let costEntries = 0;

    // Gather from energy settings (single-tenant)
    if (energySettings) {
      const settings = typeof energySettings === 'string' ? JSON.parse(energySettings) : energySettings;
      if (settings.iso) {
        isoBuckets[settings.iso] = (isoBuckets[settings.iso] || 0) + 1;
      }
      if (settings.energyCostMWh || settings.energyCost) {
        const cost = settings.energyCostMWh || settings.energyCost;
        totalEnergyCostAvg += cost;
        costEntries++;
        if (cost < 30) costBuckets.below30++;
        else if (cost < 50) costBuckets.range30_50++;
        else if (cost < 70) costBuckets.range50_70++;
        else costBuckets.above70++;
      }
    }

    // Gather from multi-tenant sites (anonymized)
    for (const tenant of tenants) {
      const sites = getSites(tenant.id);
      for (const site of sites) {
        if (site.iso) {
          isoBuckets[site.iso] = (isoBuckets[site.iso] || 0) + 1;
        }
        if (site.energy_cost_mwh) {
          const cost = site.energy_cost_mwh;
          totalEnergyCostAvg += cost;
          costEntries++;
          if (cost < 30) costBuckets.below30++;
          else if (cost < 50) costBuckets.range30_50++;
          else if (cost < 70) costBuckets.range50_70++;
          else costBuckets.above70++;
        }
      }
    }

    return {
      isoDistribution: isoBuckets,
      costDistribution: costBuckets,
      avgEnergyCostMWh: costEntries > 0 ? Math.round((totalEnergyCostAvg / costEntries) * 100) / 100 : null,
      dataPoints: costEntries,
    };
  } catch (error) {
    console.error('[CalibrationExporter] Energy aggregation error:', error.message);
    return {
      isoDistribution: {},
      costDistribution: { below30: 0, range30_50: 0, range50_70: 0, above70: 0 },
      avgEnergyCostMWh: null,
      dataPoints: 0,
    };
  }
}

// ─── Main Export Function ────────────────────────────────────────────────────

/**
 * Export anonymized aggregate telemetry to the SanghaModel simulator.
 *
 * Steps:
 *   1. Aggregate fleet data across all tenants
 *   2. Aggregate curtailment behavior
 *   3. Aggregate energy profiles
 *   4. Send to SanghaModel via sendCalibrationData()
 *   5. Log the export in calibration_exports table with payload hash
 *   6. Return export summary
 *
 * @returns {Promise<object>} Export summary
 */
export async function exportCalibrationData() {
  console.log('[CalibrationExporter] Starting calibration data export...');

  // Step 1-3: Aggregate all data
  const fleet = aggregateFleetData();
  const curtailment = aggregateCurtailmentData();
  const energy = aggregateEnergyData();

  // Build anonymized payload (no tenant identifiers)
  const payload = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    fleet: {
      totalHashrateTH: fleet.totalHashrateTH,
      totalPowerMW: fleet.totalPowerMW,
      machineCount: fleet.machineCount,
      efficiencyDistribution: fleet.efficiencyDistribution,
      generationMix: fleet.generationMix,
    },
    curtailment: {
      periodDays: curtailment.periodDays,
      totalCurtailedHours: curtailment.totalCurtailedHours,
      totalMiningHours: curtailment.totalMiningHours,
      avgCurtailmentRatio: curtailment.avgCurtailmentRatio,
      totalCurtailmentEvents: curtailment.totalCurtailmentEvents,
      curtailmentSavingsUSD: curtailment.totalCurtailmentSavingsUSD,
      peakEnergyPriceMWh: curtailment.peakEnergyPriceMWh,
      curtailmentThresholdMWh: curtailment.curtailmentThresholdMWh,
      drParticipation: curtailment.drParticipation,
    },
    energy: {
      isoDistribution: energy.isoDistribution,
      costDistribution: energy.costDistribution,
      avgEnergyCostMWh: energy.avgEnergyCostMWh,
    },
  };

  // Step 4: Hash the payload for deduplication and audit
  const payloadString = JSON.stringify(payload);
  const payloadHash = crypto.createHash('sha256').update(payloadString).digest('hex');

  // Step 5: Send to SanghaModel
  let response = null;
  let responseStatus = null;
  try {
    response = await sendCalibrationData(payload);
    responseStatus = response ? 200 : null;
    console.log('[CalibrationExporter] Data sent to SanghaModel successfully');
  } catch (error) {
    console.error('[CalibrationExporter] Failed to send calibration data:', error.message);
    responseStatus = 500;
  }

  // Step 6: Log the export
  const exportId = uuidv4();
  try {
    createCalibrationExport({
      id: exportId,
      tenantId: 'sangha',
      exportVersion: EXPORT_VERSION,
      payloadHash,
      tenantsIncluded: fleet.tenantsIncluded,
      totalHashrateTH: fleet.totalHashrateTH,
      responseStatus,
      responseBody: response ? JSON.stringify(response) : null,
    });
  } catch (error) {
    console.error('[CalibrationExporter] Failed to log export:', error.message);
  }

  // Step 7: Return summary
  const summary = {
    exportId,
    exportedAt: payload.exportedAt,
    version: EXPORT_VERSION,
    payloadHash,
    tenantsIncluded: fleet.tenantsIncluded,
    fleet: {
      totalHashrateTH: fleet.totalHashrateTH,
      totalPowerMW: fleet.totalPowerMW,
      machineCount: fleet.machineCount,
    },
    curtailment: {
      periodDays: curtailment.periodDays,
      avgCurtailmentRatio: curtailment.avgCurtailmentRatio,
    },
    energy: {
      avgEnergyCostMWh: energy.avgEnergyCostMWh,
      dataPoints: energy.dataPoints,
    },
    sanghaModelResponse: responseStatus === 200 ? 'accepted' : 'failed',
  };

  console.log(`[CalibrationExporter] Export complete: ${exportId} (hash: ${payloadHash.slice(0, 12)}...)`);
  return summary;
}

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Get the latest calibration export info and data quality indicators.
 *
 * @returns {object} Status with latest export info and quality metrics
 */
export function getCalibrationStatus() {
  const latest = getLatestCalibrationExport();
  const recentExports = getCalibrationExports(5);

  // Data quality indicators
  const fleet = aggregateFleetData();
  const hasFleetData = fleet.totalHashrateTH > 0;
  const hasCurtailmentData = fleet.machineCount > 0;
  const hasEnergyData = aggregateEnergyData().dataPoints > 0;

  const qualityScore = [hasFleetData, hasCurtailmentData, hasEnergyData].filter(Boolean).length;
  const qualityLabel = qualityScore === 3 ? 'good' : qualityScore >= 1 ? 'partial' : 'insufficient';

  return {
    latestExport: latest ? {
      id: latest.id,
      exportedAt: latest.exported_at,
      version: latest.export_version,
      payloadHash: latest.payload_hash,
      tenantsIncluded: latest.tenants_included,
      totalHashrateTH: latest.total_hashrate_th,
      responseStatus: latest.response_status,
    } : null,
    recentExports: recentExports.map(e => ({
      id: e.id,
      exportedAt: e.exported_at,
      responseStatus: e.response_status,
    })),
    dataQuality: {
      score: qualityScore,
      label: qualityLabel,
      hasFleetData,
      hasCurtailmentData,
      hasEnergyData,
    },
    schedulerRunning: schedulerInterval !== null,
  };
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Start a periodic calibration export scheduler.
 *
 * @param {number} intervalHours - Hours between exports (default: 6)
 * @returns {NodeJS.Timeout} The interval handle
 */
export function startCalibrationScheduler(intervalHours = 6) {
  if (schedulerInterval) {
    console.log('[CalibrationExporter] Scheduler already running');
    return schedulerInterval;
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;
  console.log(`[CalibrationExporter] Starting scheduler (interval: ${intervalHours}h)`);

  // Run initial export after a short delay to let the system stabilize
  setTimeout(() => {
    exportCalibrationData().catch(err => {
      console.error('[CalibrationExporter] Initial export failed:', err.message);
    });
  }, 30_000);

  // Then run periodically
  schedulerInterval = setInterval(() => {
    exportCalibrationData().catch(err => {
      console.error('[CalibrationExporter] Scheduled export failed:', err.message);
    });
  }, intervalMs);

  return schedulerInterval;
}

/**
 * Stop the calibration export scheduler.
 */
export function stopCalibrationScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[CalibrationExporter] Scheduler stopped');
  }
}

export default {
  exportCalibrationData,
  getCalibrationStatus,
  startCalibrationScheduler,
  stopCalibrationScheduler,
};
