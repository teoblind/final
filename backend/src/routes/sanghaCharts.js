/**
 * SanghaModel Chart Data Routes
 *
 * Endpoints that pass through SanghaModel API responses for dashboard charts.
 * Returns mock data when the SanghaModel service is unavailable.
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  requestQuickAssessment,
  requestFullAssessment,
  pollJobUntilDone,
  runScenario,
  getNetworkState,
  isAvailable,
} from '../services/sanghaModelClient.js';
import { getFleetConfig, getEnergySettings } from '../cache/database.js';

const router = express.Router();

// ─── Mock Data Generators ──────────────────────────────────────────────────

function generateMockQuickAssessment(profile) {
  const hashrate = profile?.total_hashrate_th || 500;
  const efficiency = profile?.fleet_efficiency_jth || 28;
  const energyCost = profile?.energy_cost_kwh || 0.045;

  // Derive a risk score from the profile
  const effRisk = Math.min(1, Math.max(0, (efficiency - 15) / 50));
  const costRisk = Math.min(1, Math.max(0, (energyCost - 0.02) / 0.08));
  const riskScore = Math.round((effRisk * 40 + costRisk * 40 + 20) * (0.8 + Math.random() * 0.4));
  const clampedRisk = Math.min(100, Math.max(5, riskScore));

  const currentHashprice = 0.048 + Math.random() * 0.01;
  const breakeven = energyCost * efficiency * 24 / 1e6 * 1e3; // rough $/TH/day

  // Monthly projections (12 months)
  const monthly = [];
  for (let m = 0; m <= 12; m++) {
    const drift = 1 - m * 0.008;
    const base = hashrate * currentHashprice * 30 * drift;
    const cost = hashrate * energyCost * efficiency * 24 * 30 / 1000;
    const net = base - cost;
    monthly.push({
      month: m,
      p10_net_revenue: Math.round(net * 0.55),
      p25_net_revenue: Math.round(net * 0.75),
      p50_net_revenue: Math.round(net),
      p75_net_revenue: Math.round(net * 1.25),
      p90_net_revenue: Math.round(net * 1.55),
      mean_net_revenue: Math.round(net * 1.02),
      prob_negative: Math.max(0.02, Math.min(0.65, 0.08 + m * 0.03 + effRisk * 0.15)),
    });
  }

  // Hashprice horizons
  const horizons = [1, 2, 3, 6, 9, 12].map(mo => {
    const decay = 1 - mo * 0.012;
    const med = currentHashprice * decay;
    return {
      months_ahead: mo,
      median: +med.toFixed(4),
      percentiles: {
        '5': +(med * 0.45).toFixed(4),
        '10': +(med * 0.55).toFixed(4),
        '25': +(med * 0.75).toFixed(4),
        '75': +(med * 1.25).toFixed(4),
        '90': +(med * 1.5).toFixed(4),
        '95': +(med * 1.7).toFixed(4),
      },
      prob_below_current: +(0.45 + mo * 0.025).toFixed(3),
    };
  });

  const floorConservative = +(currentHashprice * 0.6).toFixed(4);
  const floorModerate = +(currentHashprice * 0.75).toFixed(4);
  const floorAggressive = +(currentHashprice * 0.88).toFixed(4);

  return {
    revenue_projections: { monthly_projections: monthly },
    hashprice_distribution: {
      current_hashprice: +currentHashprice.toFixed(4),
      horizons,
    },
    insurance_inputs: {
      risk_score: clampedRisk,
      suggested_floor_conservative: floorConservative,
      suggested_floor_moderate: floorModerate,
      suggested_floor_aggressive: floorAggressive,
      expected_annual_payout_conservative: Math.round(hashrate * floorConservative * 365 * 0.08),
      expected_annual_payout_moderate: Math.round(hashrate * floorModerate * 365 * 0.15),
      expected_annual_payout_aggressive: Math.round(hashrate * floorAggressive * 365 * 0.28),
      loss_ratio_estimate: +(0.25 + clampedRisk * 0.005).toFixed(3),
    },
    risk_metrics: {
      prob_below_breakeven_12m: +(0.15 + clampedRisk * 0.005).toFixed(3),
      prob_extended_loss_12m: +(0.05 + clampedRisk * 0.003).toFixed(3),
      max_drawdown_p95: Math.round(hashrate * currentHashprice * 30 * 0.65),
      fleet_efficiency_percentile: +(1 - effRisk).toFixed(2),
      energy_cost_percentile: +(1 - costRisk).toFixed(2),
      curtailment_effectiveness: +(0.5 + Math.random() * 0.4).toFixed(2),
      value_at_risk_monthly: Math.round(hashrate * currentHashprice * 30 * 0.3),
      expected_loss_given_breach: Math.round(hashrate * currentHashprice * 30 * 0.18),
      diversification_score: +(0.2 + Math.random() * 0.6).toFixed(2),
    },
    simulation_params: {
      num_simulations: 10000,
      horizon_months: 12,
      btc_price_model: 'gbm_jump_diffusion',
      difficulty_model: 'mean_reverting_growth',
    },
    generated_at: new Date().toISOString(),
    model_version: '1.4.2-mock',
    _mock: true,
  };
}

function generateMockScenario(scenario) {
  const btcChange = scenario.btc_price_change_percent || 0;
  const diffChange = scenario.difficulty_change_percent || 0;
  const energyChange = scenario.energy_price_change_percent || 0;
  const halving = scenario.halving_event || false;

  const baseHashprice = 0.052;
  const baseRevenue = 45000;
  const baseNetworkHashrate = 750;

  let hpImpact = btcChange / 100;
  if (diffChange) hpImpact -= diffChange / 100 * 0.8;
  if (halving) hpImpact -= 0.45;
  if (energyChange) hpImpact -= energyChange / 100 * 0.1;

  const shockedHashprice = baseHashprice * (1 + hpImpact);
  const revenueImpact = hpImpact * 1.2;
  const shockedRevenue = baseRevenue * (1 + revenueImpact);
  const minersOffline = Math.max(0, Math.min(60, -hpImpact * 80));
  const shockedNetwork = baseNetworkHashrate * (1 - minersOffline / 100);

  return {
    baseline: {
      hashprice: +baseHashprice.toFixed(4),
      revenue: Math.round(baseRevenue),
      network_hashrate: baseNetworkHashrate,
      btc_price: 67500,
      difficulty: 92.5e12,
      energy_cost_mwh: 45,
    },
    shocked: {
      hashprice: +Math.max(0.001, shockedHashprice).toFixed(4),
      revenue: Math.round(Math.max(0, shockedRevenue)),
      network_hashrate: Math.round(shockedNetwork),
      btc_price: Math.round(67500 * (1 + btcChange / 100)),
      difficulty: Math.round(92.5e12 * (1 + diffChange / 100)),
      energy_cost_mwh: Math.round(45 * (1 + energyChange / 100)),
    },
    impact_summary: {
      hashprice_change_pct: +(hpImpact * 100).toFixed(1),
      revenue_change_pct: +(revenueImpact * 100).toFixed(1),
      network_hashrate_change_pct: +(-minersOffline).toFixed(1),
      miners_offline_pct: +minersOffline.toFixed(1),
    },
    fleet_specific: {
      fleet_revenue_baseline: Math.round(baseRevenue),
      fleet_revenue_shocked: Math.round(Math.max(0, shockedRevenue)),
      fleet_margin_baseline: 0.32,
      fleet_margin_shocked: +(0.32 + revenueImpact * 0.5).toFixed(3),
      fleet_state: shockedHashprice < 0.025 ? 'offline' : shockedHashprice < 0.038 ? 'curtailed' : 'online',
      breakeven_breached: shockedHashprice < 0.032,
    },
    scenario_applied: scenario,
    _mock: true,
  };
}

function generateMockNetworkState() {
  return {
    network_state: {
      btc_price_usd: 67500 + Math.round(Math.random() * 3000 - 1500),
      current_hashprice: +(0.048 + Math.random() * 0.008).toFixed(4),
      network_hashrate_eh: +(740 + Math.random() * 30).toFixed(1),
      difficulty: 92.5e12 + Math.round(Math.random() * 5e12),
      block_reward: 3.125,
      avg_fee_per_block: +(0.15 + Math.random() * 0.2).toFixed(3),
      next_adjustment_blocks: Math.round(Math.random() * 2016),
      next_adjustment_estimate_percent: +(Math.random() * 8 - 2).toFixed(2),
      efficiency_distribution: {
        p10: 18,
        p25: 22,
        p50: 28,
        p75: 38,
        p90: 52,
        mean: 30.5,
      },
    },
    _mock: true,
  };
}

// ─── Helper: Build Miner Profile from Tenant Data ─────────────────────────

function buildMinerProfile(tenantId, overrides = {}) {
  const fleet = getFleetConfig();
  const energy = getEnergySettings();
  const energySettings = energy ? (typeof energy === 'string' ? JSON.parse(energy) : energy) : {};

  let totalHashrate = 0;
  let totalPower = 0;
  let machineCount = 0;

  if (fleet?.entries) {
    for (const e of fleet.entries) {
      const qty = e.quantity || 1;
      totalHashrate += (e.hashrate || 0) * qty;
      totalPower += (e.power || 0) * qty;
      machineCount += qty;
    }
  }

  const efficiency = totalHashrate > 0 ? totalPower / totalHashrate : 28;
  const energyCost = energySettings.energyCostMWh
    ? energySettings.energyCostMWh / 1000
    : energySettings.energyCost
      ? energySettings.energyCost / 1000
      : 0.045;

  return {
    tenant_id: tenantId,
    total_hashrate_th: overrides.hashrate || totalHashrate || 500,
    fleet_efficiency_jth: overrides.efficiency || efficiency || 28,
    energy_cost_kwh: overrides.energyCost || energyCost || 0.045,
    machine_count: machineCount || 50,
    iso: energySettings.iso || 'ERCOT',
    ...overrides,
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /v1/charts/assessment
 * Quick risk assessment for Coverage Explorer charts (1A-1E).
 * Query params: hashrate, efficiency, energyCost (optional overrides)
 */
router.get('/assessment', authenticate, async (req, res) => {
  try {
    const { hashrate, efficiency, energyCost } = req.query;
    const profile = buildMinerProfile(req.tenantId, {
      hashrate: hashrate ? parseFloat(hashrate) : undefined,
      efficiency: efficiency ? parseFloat(efficiency) : undefined,
      energyCost: energyCost ? parseFloat(energyCost) : undefined,
    });

    let data;
    if (await isAvailable()) {
      try {
        data = await requestQuickAssessment(profile);
      } catch {
        data = generateMockQuickAssessment(profile);
      }
    } else {
      data = generateMockQuickAssessment(profile);
    }

    res.json({ assessment: data, profile, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[SanghaCharts] Assessment error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/charts/assessment/full
 * Full Monte Carlo assessment for Risk Detail charts (2A-2D).
 */
router.post('/assessment/full', authenticate, async (req, res) => {
  try {
    const profile = buildMinerProfile(req.tenantId, req.body);

    let data;
    if (await isAvailable()) {
      try {
        const result = await requestFullAssessment(profile);
        if (result.jobId && result.status === 'running') {
          data = await pollJobUntilDone(result.jobId, 90000, 3000);
        } else {
          data = result;
        }
      } catch {
        data = generateMockQuickAssessment(profile);
        data.simulation_params.num_simulations = 100000;
      }
    } else {
      data = generateMockQuickAssessment(profile);
      data.simulation_params.num_simulations = 100000;
    }

    res.json({ assessment: data, profile, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[SanghaCharts] Full assessment error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/charts/scenario
 * Stress test scenario for charts (3A-3D).
 * Body: { btc_price_change_percent, difficulty_change_percent, energy_price_change_percent, halving_event }
 */
router.post('/scenario', authenticate, async (req, res) => {
  try {
    const scenario = {
      ...req.body,
      miner_profile: buildMinerProfile(req.tenantId),
    };

    let data;
    if (await isAvailable()) {
      try {
        data = await runScenario(scenario);
      } catch {
        data = generateMockScenario(req.body);
      }
    } else {
      data = generateMockScenario(req.body);
    }

    res.json({ scenario: data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[SanghaCharts] Scenario error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/charts/scenario/multi
 * Run multiple preset scenarios for the comparison chart (3D).
 */
router.post('/scenario/multi', authenticate, async (req, res) => {
  try {
    const presets = [
      { name: 'BTC -30%', btc_price_change_percent: -30 },
      { name: 'BTC -50%', btc_price_change_percent: -50 },
      { name: 'Difficulty +30%', difficulty_change_percent: 30 },
      { name: 'Energy +50%', energy_price_change_percent: 50 },
      { name: 'Halving', halving_event: true },
      { name: 'Combined', btc_price_change_percent: -30, difficulty_change_percent: 30 },
    ];

    const available = await isAvailable();
    const results = [];

    for (const preset of presets) {
      const { name, ...params } = preset;
      let data;
      if (available) {
        try {
          data = await runScenario({ ...params, miner_profile: buildMinerProfile(req.tenantId) });
        } catch {
          data = generateMockScenario(params);
        }
      } else {
        data = generateMockScenario(params);
      }
      results.push({ name, ...data });
    }

    res.json({ scenarios: results, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[SanghaCharts] Multi-scenario error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/charts/network
 * Network state for the context widget (4A-4C).
 */
router.get('/network', authenticate, async (req, res) => {
  try {
    let data;
    if (await isAvailable()) {
      data = await getNetworkState();
      if (!data) data = generateMockNetworkState();
    } else {
      data = generateMockNetworkState();
    }

    // Include tenant fleet efficiency for overlay
    const profile = buildMinerProfile(req.tenantId);
    data.tenant_fleet_efficiency = profile.fleet_efficiency_jth;

    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[SanghaCharts] Network state error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
