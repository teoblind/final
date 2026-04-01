/**
 * Capital Allocation Scenario Modeler Routes - Phase 7
 *
 * API endpoints for simulating BTC/HPC capital allocation scenarios,
 * running sensitivity analysis across different capacity splits,
 * and identifying optimal allocation strategies.
 */

import express from 'express';
import {
  getWorkloads,
  getAllWorkloadSnapshots,
} from '../cache/database.js';

const router = express.Router();

// ─── Simulate Capital Allocation Scenario ───────────────────────────────────

/**
 * POST /simulate - Run a full capital allocation scenario
 * Body: {
 *   totalCapacityMW,
 *   btcPercentage,
 *   hpcPercentage,
 *   btcAssumptions: { hashpriceTHPerDay, energyPriceMWh, efficiencyJPerTH, ... },
 *   hpcAssumptions: { contractRevenuePerMWPerDay, uptimeSLA, ... },
 *   energyProfile: { avgPriceMWh, peakPriceMWh, offPeakPriceMWh, ... }
 * }
 */
router.post('/simulate', (req, res) => {
  try {
    const {
      totalCapacityMW = 150,
      btcPercentage = 50,
      hpcPercentage = 50,
      btcAssumptions = {},
      hpcAssumptions = {},
      energyProfile = {},
    } = req.body;

    // Validate split
    if (btcPercentage + hpcPercentage > 100) {
      return res.status(400).json({ error: 'btcPercentage + hpcPercentage cannot exceed 100' });
    }

    const btcCapacityMW = totalCapacityMW * (btcPercentage / 100);
    const hpcCapacityMW = totalCapacityMW * (hpcPercentage / 100);

    // ── BTC Projection ──

    // Assumptions with defaults
    const hashpriceTHPerDay = btcAssumptions.hashpriceTHPerDay || 0.00005; // $/TH/day (BTC hashprice)
    const btcEnergyPriceMWh = energyProfile.avgPriceMWh || btcAssumptions.energyPriceMWh || 50;
    const btcEfficiencyJPerTH = btcAssumptions.efficiencyJPerTH || 25; // J/TH for modern ASICs
    // Convert efficiency: TH/s per MW = 1e6 / efficiencyJPerTH
    const thPerSecondPerMW = 1e6 / btcEfficiencyJPerTH;
    const thPerDayPerMW = thPerSecondPerMW; // hashprice is already $/TH/s/day
    const btcGrossRevenuePerMWPerDay = hashpriceTHPerDay * thPerDayPerMW;
    const btcEnergyPerMWPerDay = btcEnergyPriceMWh * 24; // $/MW/day
    const btcCurtailmentSavingsRate = 0.15; // 15% savings from curtailment

    const btcAnnualGrossRevenue = btcGrossRevenuePerMWPerDay * btcCapacityMW * 365;
    const btcAnnualEnergyCost = btcEnergyPerMWPerDay * btcCapacityMW * 365;
    const btcAnnualCurtailmentSavings = btcAnnualEnergyCost * btcCurtailmentSavingsRate;
    const btcAnnualNetRevenue = btcAnnualGrossRevenue - btcAnnualEnergyCost + btcAnnualCurtailmentSavings;
    const btcRevenuePerMW = btcCapacityMW > 0 ? btcAnnualNetRevenue / btcCapacityMW : 0;

    // BTC volatility: higher due to hashprice/BTC price fluctuations
    const btcDailyVolatility = btcAssumptions.dailyVolatility || 0.04; // 4% daily std dev

    const btcProjection = {
      capacityMW: btcCapacityMW,
      annualGrossRevenue: btcAnnualGrossRevenue,
      annualEnergyCost: btcAnnualEnergyCost,
      annualCurtailmentSavings: btcAnnualCurtailmentSavings,
      annualNetRevenue: btcAnnualNetRevenue,
      revenuePerMW: btcRevenuePerMW,
      volatility: btcDailyVolatility,
      marginPercent: btcAnnualGrossRevenue > 0
        ? (btcAnnualNetRevenue / btcAnnualGrossRevenue) * 100
        : 0,
      assumptions: {
        hashpriceTHPerDay,
        energyPriceMWh: btcEnergyPriceMWh,
        efficiencyJPerTH: btcEfficiencyJPerTH,
        curtailmentSavingsRate: btcCurtailmentSavingsRate,
      },
    };

    // ── HPC Projection ──

    const hpcContractRevenuePerMWPerDay = hpcAssumptions.contractRevenuePerMWPerDay || 1500;
    const hpcEnergyPriceMWh = energyProfile.avgPriceMWh || hpcAssumptions.energyPriceMWh || 50;
    const hpcEnergyPerMWPerDay = hpcEnergyPriceMWh * 24;
    const hpcUptimeSLA = hpcAssumptions.uptimeSLA || 99.9;
    const hpcEffectiveUtilization = hpcUptimeSLA / 100;

    const hpcAnnualGrossRevenue = hpcContractRevenuePerMWPerDay * hpcCapacityMW * 365 * hpcEffectiveUtilization;
    const hpcAnnualEnergyCost = hpcEnergyPerMWPerDay * hpcCapacityMW * 365;
    const hpcAnnualCurtailmentSavings = 0; // HPC contracts generally cannot curtail
    const hpcAnnualNetRevenue = hpcAnnualGrossRevenue - hpcAnnualEnergyCost + hpcAnnualCurtailmentSavings;
    const hpcRevenuePerMW = hpcCapacityMW > 0 ? hpcAnnualNetRevenue / hpcCapacityMW : 0;

    // HPC volatility: lower due to fixed contracts
    const hpcDailyVolatility = hpcAssumptions.dailyVolatility || 0.005; // 0.5% daily std dev

    const hpcProjection = {
      capacityMW: hpcCapacityMW,
      annualGrossRevenue: hpcAnnualGrossRevenue,
      annualEnergyCost: hpcAnnualEnergyCost,
      annualCurtailmentSavings: hpcAnnualCurtailmentSavings,
      annualNetRevenue: hpcAnnualNetRevenue,
      revenuePerMW: hpcRevenuePerMW,
      volatility: hpcDailyVolatility,
      marginPercent: hpcAnnualGrossRevenue > 0
        ? (hpcAnnualNetRevenue / hpcAnnualGrossRevenue) * 100
        : 0,
      assumptions: {
        contractRevenuePerMWPerDay: hpcContractRevenuePerMWPerDay,
        energyPriceMWh: hpcEnergyPriceMWh,
        uptimeSLA: hpcUptimeSLA,
      },
    };

    // ── Combined Metrics ──

    const combinedAnnualGross = btcAnnualGrossRevenue + hpcAnnualGrossRevenue;
    const combinedAnnualEnergy = btcAnnualEnergyCost + hpcAnnualEnergyCost;
    const combinedAnnualNet = btcAnnualNetRevenue + hpcAnnualNetRevenue;
    // Portfolio volatility: weighted combination (simplified, assumes low correlation)
    const btcWeight = totalCapacityMW > 0 ? btcCapacityMW / totalCapacityMW : 0;
    const hpcWeight = totalCapacityMW > 0 ? hpcCapacityMW / totalCapacityMW : 0;
    const combinedVolatility = Math.sqrt(
      (btcWeight * btcDailyVolatility) ** 2 +
      (hpcWeight * hpcDailyVolatility) ** 2
    );

    const combined = {
      totalCapacityMW,
      annualGrossRevenue: combinedAnnualGross,
      annualEnergyCost: combinedAnnualEnergy,
      annualNetRevenue: combinedAnnualNet,
      revenuePerMW: totalCapacityMW > 0 ? combinedAnnualNet / totalCapacityMW : 0,
      marginPercent: combinedAnnualGross > 0
        ? (combinedAnnualNet / combinedAnnualGross) * 100
        : 0,
      portfolioVolatility: combinedVolatility,
      sharpeRatio: combinedVolatility > 0
        ? (combinedAnnualNet / totalCapacityMW) / (combinedVolatility * combinedAnnualGross / totalCapacityMW)
        : 0,
    };

    // ── Sensitivity Analysis ──

    const splits = [
      { btcPercent: 0, hpcPercent: 100 },
      { btcPercent: 20, hpcPercent: 80 },
      { btcPercent: 40, hpcPercent: 60 },
      { btcPercent: 50, hpcPercent: 50 },
      { btcPercent: 60, hpcPercent: 40 },
      { btcPercent: 80, hpcPercent: 20 },
      { btcPercent: 100, hpcPercent: 0 },
    ];

    const sensitivityAnalysis = splits.map(split => {
      const sBtcMW = totalCapacityMW * (split.btcPercent / 100);
      const sHpcMW = totalCapacityMW * (split.hpcPercent / 100);

      const sBtcNet = (btcCapacityMW > 0 ? btcRevenuePerMW : btcGrossRevenuePerMWPerDay * 365 - btcEnergyPerMWPerDay * 365 + btcEnergyPerMWPerDay * 365 * btcCurtailmentSavingsRate) * sBtcMW;
      const sHpcNet = (hpcCapacityMW > 0 ? hpcRevenuePerMW : (hpcContractRevenuePerMWPerDay * 365 * hpcEffectiveUtilization - hpcEnergyPerMWPerDay * 365)) * sHpcMW;
      const sNetRevenue = sBtcNet + sHpcNet;

      const sBtcGross = btcGrossRevenuePerMWPerDay * sBtcMW * 365;
      const sHpcGross = hpcContractRevenuePerMWPerDay * sHpcMW * 365 * hpcEffectiveUtilization;
      const sGross = sBtcGross + sHpcGross;
      const sMargin = sGross > 0 ? (sNetRevenue / sGross) * 100 : 0;

      const sBtcW = totalCapacityMW > 0 ? sBtcMW / totalCapacityMW : 0;
      const sHpcW = totalCapacityMW > 0 ? sHpcMW / totalCapacityMW : 0;
      const sVol = Math.sqrt((sBtcW * btcDailyVolatility) ** 2 + (sHpcW * hpcDailyVolatility) ** 2);
      const sRevenuePerMW = totalCapacityMW > 0 ? sNetRevenue / totalCapacityMW : 0;
      const sGrossPerMW = totalCapacityMW > 0 ? sGross / totalCapacityMW : 0;
      const sSharpe = sVol > 0 && sGrossPerMW > 0 ? sRevenuePerMW / (sVol * sGrossPerMW) : 0;

      return {
        btcPercent: split.btcPercent,
        hpcPercent: split.hpcPercent,
        netRevenue: sNetRevenue,
        margin: sMargin,
        sharpeRatio: sSharpe,
      };
    });

    const scenario = {
      totalCapacityMW,
      btcPercentage,
      hpcPercentage,
      timestamp: new Date().toISOString(),
    };

    res.json({
      scenario,
      btcProjection,
      hpcProjection,
      combined,
      sensitivityAnalysis,
    });
  } catch (error) {
    console.error('Error running allocation simulation:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Quick Sensitivity Analysis ─────────────────────────────────────────────

/**
 * GET /sensitivity - Quick sensitivity analysis across BTC/HPC splits
 * Query params: ?totalCapacityMW=150&btcRevenuePerMW=1000&hpcRevenuePerMW=1200
 */
router.get('/sensitivity', (req, res) => {
  try {
    const totalCapacityMW = parseFloat(req.query.totalCapacityMW) || 150;
    const btcRevenuePerMW = parseFloat(req.query.btcRevenuePerMW) || 1000;
    const hpcRevenuePerMW = parseFloat(req.query.hpcRevenuePerMW) || 1200;

    // BTC and HPC volatility assumptions for Sharpe ratio
    const btcVolatility = 0.04;  // 4% daily
    const hpcVolatility = 0.005; // 0.5% daily

    const splitPoints = [
      { btcPercent: 0, hpcPercent: 100 },
      { btcPercent: 20, hpcPercent: 80 },
      { btcPercent: 40, hpcPercent: 60 },
      { btcPercent: 50, hpcPercent: 50 },
      { btcPercent: 60, hpcPercent: 40 },
      { btcPercent: 80, hpcPercent: 20 },
      { btcPercent: 100, hpcPercent: 0 },
    ];

    let bestSharpe = -Infinity;
    let optimalSplit = null;

    const splits = splitPoints.map(split => {
      const btcMW = totalCapacityMW * (split.btcPercent / 100);
      const hpcMW = totalCapacityMW * (split.hpcPercent / 100);

      const netRevenue = (btcMW * btcRevenuePerMW) + (hpcMW * hpcRevenuePerMW);
      const revenuePerMW = totalCapacityMW > 0 ? netRevenue / totalCapacityMW : 0;

      // Gross estimate (assume 60% margin for BTC, 80% for HPC)
      const grossRevenue = (btcMW * btcRevenuePerMW / 0.6) + (hpcMW * hpcRevenuePerMW / 0.8);
      const margin = grossRevenue > 0 ? (netRevenue / grossRevenue) * 100 : 0;

      // Portfolio volatility
      const btcWeight = totalCapacityMW > 0 ? btcMW / totalCapacityMW : 0;
      const hpcWeight = totalCapacityMW > 0 ? hpcMW / totalCapacityMW : 0;
      const portfolioVol = Math.sqrt(
        (btcWeight * btcVolatility) ** 2 +
        (hpcWeight * hpcVolatility) ** 2
      );

      // Sharpe ratio: risk-adjusted return
      const sharpeRatio = portfolioVol > 0 ? revenuePerMW / (portfolioVol * revenuePerMW * 365) : 0;

      const result = {
        btcPercent: split.btcPercent,
        hpcPercent: split.hpcPercent,
        btcCapacityMW: btcMW,
        hpcCapacityMW: hpcMW,
        netRevenue,
        revenuePerMW,
        margin,
        portfolioVolatility: portfolioVol,
        sharpeRatio,
      };

      if (sharpeRatio > bestSharpe) {
        bestSharpe = sharpeRatio;
        optimalSplit = {
          btcPercent: split.btcPercent,
          hpcPercent: split.hpcPercent,
          sharpeRatio,
          netRevenue,
        };
      }

      return result;
    });

    res.json({
      totalCapacityMW,
      btcRevenuePerMW,
      hpcRevenuePerMW,
      splits,
      optimalSplit,
    });
  } catch (error) {
    console.error('Error running sensitivity analysis:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
