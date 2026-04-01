/**
 * Workload Management Routes - Phase 7
 *
 * API endpoints for the unified workload abstraction layer.
 * Manages BTC mining and HPC/AI compute workloads with
 * economics comparison, site overview, and revenue tracking.
 */

import express from 'express';
import crypto from 'crypto';
import {
  getWorkloads,
  getWorkload,
  createWorkload,
  updateWorkload,
  deleteWorkload,
  getAllWorkloadSnapshots,
  getWorkloadSnapshots,
  getHpcContracts,
} from '../cache/database.js';

const router = express.Router();

// ─── List All Workloads ─────────────────────────────────────────────────────

/**
 * GET / - List all workloads with parsed JSON fields
 */
router.get('/', (req, res) => {
  try {
    const rows = getWorkloads();
    const workloads = rows.map(row => ({
      ...row,
      revenueModel: safeJsonParse(row.revenue_model_json),
      fleet: safeJsonParse(row.fleet_json),
      curtailmentProfile: safeJsonParse(row.curtailment_profile_json),
    }));
    res.json({ workloads });
  } catch (error) {
    console.error('Error listing workloads:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Side-by-Side Economics Comparison ──────────────────────────────────────

/**
 * GET /comparison - Side-by-side economics comparison across workload types
 * Query params: ?days=30
 */
router.get('/comparison', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const snapshots = getAllWorkloadSnapshots(days);

    // Aggregate snapshots by workload type
    const byType = {};
    for (const snap of snapshots) {
      const type = snap.workload_type || 'unknown';
      if (!byType[type]) {
        byType[type] = {
          type,
          totalCapacityMW: 0,
          totalGrossRevenue: 0,
          totalEnergyCost: 0,
          totalCurtailmentSavings: 0,
          totalCurtailmentPenalties: 0,
          totalNetRevenue: 0,
          snapshotCount: 0,
        };
      }
      byType[type].totalCapacityMW = Math.max(byType[type].totalCapacityMW, snap.capacity_mw || 0);
      byType[type].totalGrossRevenue += snap.gross_revenue || 0;
      byType[type].totalEnergyCost += snap.energy_cost || 0;
      byType[type].totalCurtailmentSavings += snap.curtailment_savings || 0;
      byType[type].totalCurtailmentPenalties += snap.curtailment_penalties || 0;
      byType[type].totalNetRevenue += snap.net_revenue || 0;
      byType[type].snapshotCount += 1;
    }

    const workloadTypes = Object.values(byType).map(t => ({
      ...t,
      avgRevenuePerMW: t.totalCapacityMW > 0 ? t.totalNetRevenue / t.totalCapacityMW : 0,
      avgMarginPercent: t.totalGrossRevenue > 0
        ? ((t.totalNetRevenue / t.totalGrossRevenue) * 100)
        : 0,
    }));

    // Combined metrics
    const combined = {
      totalGrossRevenue: workloadTypes.reduce((s, w) => s + w.totalGrossRevenue, 0),
      totalEnergyCost: workloadTypes.reduce((s, w) => s + w.totalEnergyCost, 0),
      totalNetRevenue: workloadTypes.reduce((s, w) => s + w.totalNetRevenue, 0),
      totalCapacityMW: workloadTypes.reduce((s, w) => s + w.totalCapacityMW, 0),
    };
    combined.overallMarginPercent = combined.totalGrossRevenue > 0
      ? (combined.totalNetRevenue / combined.totalGrossRevenue) * 100
      : 0;

    // Generate insight comparing BTC vs HPC
    let insight = '';
    const btc = byType['btc'] || byType['BTC'];
    const hpc = byType['hpc'] || byType['HPC'];
    if (btc && hpc) {
      const btcRevenuePerMW = btc.totalCapacityMW > 0 ? btc.totalNetRevenue / btc.totalCapacityMW : 0;
      const hpcRevenuePerMW = hpc.totalCapacityMW > 0 ? hpc.totalNetRevenue / hpc.totalCapacityMW : 0;
      if (hpcRevenuePerMW > btcRevenuePerMW) {
        const pctBetter = btcRevenuePerMW > 0
          ? (((hpcRevenuePerMW - btcRevenuePerMW) / btcRevenuePerMW) * 100).toFixed(1)
          : 'N/A';
        insight = `HPC workloads generated ${pctBetter}% more net revenue per MW than BTC mining over the last ${days} days. Consider increasing HPC allocation for higher risk-adjusted returns.`;
      } else if (btcRevenuePerMW > hpcRevenuePerMW) {
        const pctBetter = hpcRevenuePerMW > 0
          ? (((btcRevenuePerMW - hpcRevenuePerMW) / hpcRevenuePerMW) * 100).toFixed(1)
          : 'N/A';
        insight = `BTC mining generated ${pctBetter}% more net revenue per MW than HPC workloads over the last ${days} days. BTC is currently the higher-yielding workload, though with more volatility.`;
      } else {
        insight = `BTC and HPC workloads are generating comparable revenue per MW over the last ${days} days.`;
      }
    } else if (btc) {
      insight = `Only BTC workloads are active. Add HPC contracts to diversify revenue streams.`;
    } else if (hpc) {
      insight = `Only HPC workloads are active. BTC mining can provide additional revenue during low energy price periods.`;
    } else {
      insight = `No workload snapshot data available for the last ${days} days.`;
    }

    res.json({
      period: { days, startDate: new Date(Date.now() - days * 86400000).toISOString().split('T')[0] },
      workloads: workloadTypes,
      combined,
      insight,
    });
  } catch (error) {
    console.error('Error generating workload comparison:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Site Overview ──────────────────────────────────────────────────────────

/**
 * GET /site-overview - Unified site overview aggregating all active workloads
 */
router.get('/site-overview', (req, res) => {
  try {
    const rows = getWorkloads();
    const activeWorkloads = rows.filter(r => r.status === 'active');

    let totalCapacityMW = 0;
    let onlineMW = 0;
    let curtailedMW = 0;
    let firmMW = 0;
    let combinedNetRevenuePerHr = 0;
    let combinedEnergyCostPerHr = 0;

    // Get HPC contracts for firm power calculation
    let hpcContracts = [];
    try {
      hpcContracts = getHpcContracts('active');
    } catch (e) {
      // HPC contracts may not exist yet
    }

    // Sum firm MW from non-interruptible HPC contracts
    for (const contract of hpcContracts) {
      if (!contract.interruptible) {
        firmMW += contract.power_draw_mw || 0;
      }
    }

    const workloadDetails = activeWorkloads.map(row => {
      const revenueModel = safeJsonParse(row.revenue_model_json);
      const fleet = safeJsonParse(row.fleet_json);
      const curtailmentProfile = safeJsonParse(row.curtailment_profile_json);
      const powerMW = row.power_allocation_mw || 0;

      totalCapacityMW += powerMW;

      // Determine current operational status
      const isCurtailed = curtailmentProfile && curtailmentProfile.currentlyCurtailed;
      const currentOnlineMW = isCurtailed ? 0 : powerMW;
      const currentCurtailedMW = isCurtailed ? powerMW : 0;

      onlineMW += currentOnlineMW;
      curtailedMW += currentCurtailedMW;

      // Estimate hourly revenue and energy cost
      const revenuePerMWPerDay = revenueModel?.revenuePerMWPerDay || 0;
      const energyCostPerMWPerDay = revenueModel?.energyCostPerMWPerDay || 0;
      const netRevenuePerHr = (revenuePerMWPerDay * currentOnlineMW) / 24;
      const energyCostPerHr = (energyCostPerMWPerDay * currentOnlineMW) / 24;

      combinedNetRevenuePerHr += netRevenuePerHr;
      combinedEnergyCostPerHr += energyCostPerHr;

      return {
        id: row.id,
        name: row.name,
        type: row.type,
        site: row.site,
        powerAllocationMW: powerMW,
        status: isCurtailed ? 'curtailed' : 'online',
        onlineMW: currentOnlineMW,
        curtailedMW: currentCurtailedMW,
        netRevenuePerHr,
        energyCostPerHr,
      };
    });

    res.json({
      totalCapacityMW,
      onlineMW,
      curtailedMW,
      firmMW,
      workloads: workloadDetails,
      combinedNetRevenuePerHr,
      combinedEnergyCostPerHr,
    });
  } catch (error) {
    console.error('Error generating site overview:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Create Workload ────────────────────────────────────────────────────────

/**
 * POST / - Create a new workload
 */
router.post('/', (req, res) => {
  try {
    const { name, type, site, energyNode, powerAllocationMW, revenueModel, fleet, curtailmentProfile } = req.body;
    let { id } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'name and type are required' });
    }

    // Generate id if not provided: type prefix + random hex
    if (!id) {
      const prefix = type.toLowerCase().substring(0, 3);
      const hex = crypto.randomBytes(4).toString('hex');
      id = `${prefix}-${hex}`;
    }

    createWorkload({
      id,
      name,
      type,
      site: site || null,
      energyNode: energyNode || null,
      powerAllocationMW: powerAllocationMW || 0,
      revenueModel: revenueModel || {},
      fleet: fleet || {},
      curtailmentProfile: curtailmentProfile || {},
    });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Error creating workload:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Update Workload ────────────────────────────────────────────────────────

/**
 * PUT /:id - Update an existing workload
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getWorkload(id);
    if (!existing) {
      return res.status(404).json({ error: `Workload not found: ${id}` });
    }

    updateWorkload(id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating workload:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Delete Workload ────────────────────────────────────────────────────────

/**
 * DELETE /:id - Delete a workload
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getWorkload(id);
    if (!existing) {
      return res.status(404).json({ error: `Workload not found: ${id}` });
    }

    deleteWorkload(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting workload:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Workload Economics ─────────────────────────────────────────────────────

/**
 * GET /:id/economics - Get economics for a single workload
 */
router.get('/:id/economics', async (req, res) => {
  try {
    const { id } = req.params;
    const row = getWorkload(id);
    if (!row) {
      return res.status(404).json({ error: `Workload not found: ${id}` });
    }

    const revenueModel = safeJsonParse(row.revenue_model_json);
    const fleet = safeJsonParse(row.fleet_json);
    const capacityMW = row.power_allocation_mw || 0;
    const workloadType = row.type;

    let grossRevenuePerDay = 0;
    let energyCostPerDay = 0;

    if (workloadType === 'btc' || workloadType === 'BTC') {
      // Try to get real data from curtailment engine
      try {
        const { getCurrentRecommendation } = await import('../services/curtailmentEngine.js');
        const rec = await getCurrentRecommendation();
        if (rec.hasFleet && rec.summary) {
          grossRevenuePerDay = rec.summary.revenuePerHr * 24;
          energyCostPerDay = rec.summary.costPerHr * 24;
        } else {
          // Fallback to revenue model estimates
          grossRevenuePerDay = (revenueModel?.revenuePerMWPerDay || 1200) * capacityMW;
          energyCostPerDay = (revenueModel?.energyCostPerMWPerDay || 800) * capacityMW;
        }
      } catch (e) {
        // Fallback if curtailment engine unavailable
        grossRevenuePerDay = (revenueModel?.revenuePerMWPerDay || 1200) * capacityMW;
        energyCostPerDay = (revenueModel?.energyCostPerMWPerDay || 800) * capacityMW;
      }
    } else if (workloadType === 'hpc' || workloadType === 'HPC') {
      // Compute from HPC contracts
      let hpcContracts = [];
      try {
        hpcContracts = getHpcContracts('active');
      } catch (e) { /* no contracts */ }

      for (const contract of hpcContracts) {
        const monthlyRev = contract.monthly_revenue || 0;
        grossRevenuePerDay += monthlyRev / 30;
      }
      // Energy cost estimate from capacity
      const energyPriceMWh = revenueModel?.energyPriceMWh || 50;
      energyCostPerDay = capacityMW * energyPriceMWh * 24;
    } else {
      // Generic workload
      grossRevenuePerDay = (revenueModel?.revenuePerMWPerDay || 0) * capacityMW;
      energyCostPerDay = (revenueModel?.energyCostPerMWPerDay || 0) * capacityMW;
    }

    const netRevenuePerDay = grossRevenuePerDay - energyCostPerDay;
    const revenuePerMW = capacityMW > 0 ? netRevenuePerDay / capacityMW : 0;
    const marginPercent = grossRevenuePerDay > 0
      ? (netRevenuePerDay / grossRevenuePerDay) * 100
      : 0;

    res.json({
      workloadId: id,
      type: workloadType,
      capacityMW,
      grossRevenuePerDay,
      energyCostPerDay,
      netRevenuePerDay,
      revenuePerMW,
      marginPercent,
    });
  } catch (error) {
    console.error('Error getting workload economics:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeJsonParse(str) {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch (e) {
    return {};
  }
}

export default router;
