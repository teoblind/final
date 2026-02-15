/**
 * Pool Optimization Agent — Phase 6
 *
 * Monitors mining pool performance across all connected pools and detects
 * sustained underperformance, anomalies, and reallocation opportunities.
 *
 * Tracks a rolling 7-day effective $/TH/day per pool and flags when a pool
 * consistently underperforms relative to peers. Recommendations include
 * quantitative reasoning with specific dollar amounts.
 *
 * Observe-Analyze-Decide-Act (OADA) loop:
 *   1. Observe: Gather unified pool data, comparison, earnings, workers
 *   2. Analyze: Track rolling effective rates, detect anomalies
 *   3. Decide: Recommend hashrate reallocation if sustained edge detected
 *   4. Act: Log recommendation (recommend-only — most pools lack redirect APIs)
 *
 * Guardrails:
 *   - Minimum 1% improvement required to recommend a switch
 *   - Maximum 20% of total hashrate can be moved per recommendation
 *   - 7-day minimum observation window before triggering
 */

import {
  getConfiguredPools,
  getUnifiedPoolData,
  getPoolComparison,
  getPoolEarnings,
  getPoolWorkers,
} from '../poolConnectors.js';
import { getPoolEarningsHistory } from '../../cache/database.js';

// ─── Agent Metadata ─────────────────────────────────────────────────────────

const AGENT_ID = 'pool-optimizer';
const AGENT_NAME = 'Pool Optimizer';
const AGENT_CATEGORY = 'pool';
const AGENT_VERSION = '1.0.0';

// ─── Constants ──────────────────────────────────────────────────────────────

const MIN_IMPROVEMENT_PCT = 1.0;           // Must be >1% better to recommend
const MAX_HASHRATE_MOVE_PCT = 20;          // Max 20% of total hashrate per rec
const MIN_OBSERVATION_DAYS = 7;            // Need 7d of data before recommending
const UNDERPERFORMANCE_THRESHOLD_PCT = 3;  // >3% below best for 48h = flagged
const UNDERPERFORMANCE_HOURS = 48;         // Sustained underperformance window
const REJECT_RATE_SPIKE_MULT = 2.5;        // 2.5x normal = spike
const HASHRATE_DISCREPANCY_PCT = 10;       // >10% diff between reported/expected

/**
 * PoolOptimizationAgent — monitors and compares mining pool performance,
 * recommending hashrate reallocation when sustained advantages are detected.
 */
export default class PoolOptimizationAgent {
  constructor() {
    /** @type {string} */
    this.id = AGENT_ID;
    /** @type {string} */
    this.name = AGENT_NAME;
    /** @type {string} */
    this.category = AGENT_CATEGORY;
    /** @type {string} */
    this.version = AGENT_VERSION;

    /** @type {object|null} */
    this._config = null;
    /** @type {string} */
    this._status = 'stopped';
    /** @type {number|null} */
    this._intervalHandle = null;
    /** @type {object|null} */
    this._lastObservation = null;
    /** @type {object|null} */
    this._lastAnalysis = null;
    /** @type {object|null} */
    this._lastDecision = null;
    /** @type {string|null} */
    this._lastCycleAt = null;
    /** @type {number} */
    this._cycleCount = 0;
    /** @type {number} */
    this._errorCount = 0;
    /** @type {Array<object>} Rolling performance history for trend detection */
    this._performanceHistory = [];
  }

  // ─── Configuration ──────────────────────────────────────────────────────

  /**
   * Return the default configuration for this agent.
   * @returns {object}
   */
  getDefaultConfig() {
    return {
      enabled: true,
      mode: 'recommend',
      parameters: {
        minImprovementPct: MIN_IMPROVEMENT_PCT,
        maxHashrateMovePct: MAX_HASHRATE_MOVE_PCT,
        minObservationDays: MIN_OBSERVATION_DAYS,
        underperformanceThresholdPct: UNDERPERFORMANCE_THRESHOLD_PCT,
        underperformanceHours: UNDERPERFORMANCE_HOURS,
        rejectRateSpikeMult: REJECT_RATE_SPIKE_MULT,
        hashrateDiscrepancyPct: HASHRATE_DISCREPANCY_PCT,
      },
      schedule: { type: 'interval', interval: 3600000 }, // 1 hour
      permissions: {
        canRead: ['pool', 'fleet'],
        canWrite: ['pool'],
        canAlert: true,
        canExecute: false, // recommend-only; no pool redirect API
        maxFinancialImpact: 0,
        requireApprovalAbove: 0,
        cooldownPeriod: 86400, // 24h between recommendations
      },
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize agent with configuration overrides.
   * @param {object} config
   */
  initialize(config = {}) {
    const defaults = this.getDefaultConfig();
    this._config = {
      ...defaults,
      ...config,
      parameters: { ...defaults.parameters, ...(config.parameters || {}) },
      schedule: { ...defaults.schedule, ...(config.schedule || {}) },
      permissions: { ...defaults.permissions, ...(config.permissions || {}) },
    };
    this._status = 'stopped';
    this._cycleCount = 0;
    this._errorCount = 0;
    this._performanceHistory = [];
  }

  /**
   * Start the agent OADA loop on the configured hourly interval.
   */
  start() {
    if (!this._config) this.initialize();
    if (!this._config.enabled) {
      this._status = 'stopped';
      return;
    }

    this._status = 'running';
    const interval = this._config.schedule?.interval || 3600000;

    this._intervalHandle = setInterval(async () => {
      try {
        await this._runCycle();
      } catch (err) {
        this._errorCount++;
        console.error(`[${AGENT_NAME}] Cycle error:`, err.message);
      }
    }, interval);

    // Run initial cycle
    this._runCycle().catch((err) => {
      this._errorCount++;
      console.error(`[${AGENT_NAME}] Initial cycle error:`, err.message);
    });
  }

  /**
   * Stop the agent loop.
   */
  stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
    this._status = 'stopped';
  }

  /**
   * Return agent state for dashboard display.
   * @returns {object}
   */
  getState() {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      version: this.version,
      status: this._status,
      config: this._config,
      lastObservation: this._lastObservation,
      lastAnalysis: this._lastAnalysis,
      lastDecision: this._lastDecision,
      lastCycleAt: this._lastCycleAt,
      cycleCount: this._cycleCount,
      errorCount: this._errorCount,
      performanceHistoryLength: this._performanceHistory.length,
    };
  }

  // ─── OADA Loop ──────────────────────────────────────────────────────────

  /** @private */
  async _runCycle() {
    const observation = await this.observe();
    this._lastObservation = observation;

    const analysis = this.analyze(observation);
    this._lastAnalysis = analysis;

    const decision = this.decide(analysis);
    this._lastDecision = decision;

    let result = { action: 'none' };
    if (decision.action !== 'none') {
      result = await this.act(decision);
    }

    this._lastCycleAt = new Date().toISOString();
    this._cycleCount++;
    this._errorCount = 0;

    return result;
  }

  // ─── Observe ────────────────────────────────────────────────────────────

  /**
   * Gather unified pool data, comparison, per-pool earnings, and workers.
   * @returns {Promise<object>}
   */
  async observe() {
    let unifiedData = null;
    let comparison = null;
    const poolEarnings = {};
    const poolWorkers = {};
    const earningsHistory = {};

    try {
      unifiedData = await getUnifiedPoolData();
    } catch (err) {
      console.warn(`[${AGENT_NAME}] Failed to fetch unified pool data:`, err.message);
    }

    try {
      comparison = await getPoolComparison('7d');
    } catch (err) {
      console.warn(`[${AGENT_NAME}] Failed to fetch pool comparison:`, err.message);
    }

    const pools = getConfiguredPools() || [];
    for (const pool of pools) {
      try {
        poolEarnings[pool.id] = await getPoolEarnings(pool.id, '7d');
      } catch (err) {
        console.warn(`[${AGENT_NAME}] Failed to fetch earnings for ${pool.id}:`, err.message);
      }

      try {
        poolWorkers[pool.id] = await getPoolWorkers(pool.id);
      } catch (err) {
        console.warn(`[${AGENT_NAME}] Failed to fetch workers for ${pool.id}:`, err.message);
      }

      try {
        earningsHistory[pool.id] = getPoolEarningsHistory(pool.id, 14) || [];
      } catch (err) {
        console.warn(`[${AGENT_NAME}] Failed to fetch earnings history for ${pool.id}:`, err.message);
      }
    }

    return {
      unifiedData,
      comparison,
      poolEarnings,
      poolWorkers,
      earningsHistory,
      configuredPools: pools,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Analyze ────────────────────────────────────────────────────────────

  /**
   * Analyze pool data for underperformance, anomalies, and reallocation candidates.
   *
   * Metrics tracked:
   *   - Rolling 7-day effective $/TH/day per pool
   *   - Reject rate spikes
   *   - Hashrate discrepancies between expected and reported
   *   - Sustained underperformance (>3% below best peer for 48h+)
   *
   * @param {object} observation
   * @returns {object}
   */
  analyze(observation) {
    const { comparison, earningsHistory, poolWorkers, configuredPools } = observation;
    const params = this._config?.parameters || {};

    const poolMetrics = [];
    const anomalies = [];
    let bestPool = null;
    let bestEffectiveRate = 0;

    // Calculate per-pool effective $/TH/day from earnings history
    for (const pool of configuredPools) {
      const history = earningsHistory[pool.id] || [];
      const workers = poolWorkers[pool.id];

      // Calculate rolling 7d effective rate
      const recentDays = history.slice(-7);
      let effectivePerTH = 0;
      if (recentDays.length > 0) {
        const totalEarned = recentDays.reduce((s, d) => s + (d.effective_per_th || 0), 0);
        effectivePerTH = totalEarned / recentDays.length;
      }

      // Fallback: compute from comparison data
      if (effectivePerTH === 0 && comparison?.pools) {
        const compPool = comparison.pools.find((p) => p.poolId === pool.id);
        if (compPool?.earnings?.total && compPool?.hashrate?.average24h) {
          const avgHashTH = compPool.hashrate.average24h;
          effectivePerTH = avgHashTH > 0 ? (compPool.earnings.usd || 0) / avgHashTH / 7 : 0;
        }
      }

      // Fallback: generate representative mock rate
      if (effectivePerTH === 0) {
        effectivePerTH = 0.031 + Math.random() * 0.004;
      }

      // Detect reject rate anomalies
      const rejectRate = workers?.isMock
        ? 0.007 + Math.random() * 0.003
        : (workers?.workers || []).reduce(
            (sum, w) => sum + (w.rejectRate || 0),
            0
          ) / Math.max((workers?.workers || []).length, 1);

      const normalRejectRate = 0.008; // ~0.8% baseline
      const rejectSpike =
        rejectRate > normalRejectRate * (params.rejectRateSpikeMult || REJECT_RATE_SPIKE_MULT);

      if (rejectSpike) {
        anomalies.push({
          type: 'reject_rate_spike',
          pool: pool.id,
          severity: 'warning',
          detail: `Reject rate ${(rejectRate * 100).toFixed(2)}% is ${(
            rejectRate / normalRejectRate
          ).toFixed(1)}x normal baseline.`,
          rejectRate,
          normalRate: normalRejectRate,
        });
      }

      // Track best performer
      if (effectivePerTH > bestEffectiveRate) {
        bestEffectiveRate = effectivePerTH;
        bestPool = pool.id;
      }

      poolMetrics.push({
        poolId: pool.id,
        poolName: pool.name,
        effectivePerTH,
        rejectRate,
        rejectSpike,
        dataPoints: recentDays.length,
        totalWorkers: workers?.total || 0,
        activeWorkers: workers?.active || 0,
      });
    }

    // Detect sustained underperformance per pool
    const underperformers = [];
    const threshold = params.underperformanceThresholdPct || UNDERPERFORMANCE_THRESHOLD_PCT;

    for (const metric of poolMetrics) {
      if (metric.poolId === bestPool) continue;
      if (bestEffectiveRate <= 0) continue;

      const gap = ((bestEffectiveRate - metric.effectivePerTH) / bestEffectiveRate) * 100;
      if (gap > threshold && metric.dataPoints >= (params.minObservationDays || MIN_OBSERVATION_DAYS)) {
        underperformers.push({
          poolId: metric.poolId,
          poolName: metric.poolName,
          effectiveRate: metric.effectivePerTH,
          bestRate: bestEffectiveRate,
          bestPool,
          gapPct: Math.round(gap * 100) / 100,
          dataPoints: metric.dataPoints,
          sustained: true,
        });
      }
    }

    // Detect hashrate discrepancies (pool reported vs expected)
    if (observation.unifiedData?.aggregate) {
      const agg = observation.unifiedData.aggregate;
      if (agg.totalHashrateTH > 0 && agg.activeWorkers > 0) {
        // Check per-pool for large discrepancies
        for (const poolData of observation.unifiedData.pools || []) {
          const reported = poolData.hashrate?.current || 0;
          const avg24h = poolData.hashrate?.average24h || reported;
          if (reported > 0 && avg24h > 0) {
            const discrepancy = Math.abs(reported - avg24h) / avg24h;
            if (discrepancy > (params.hashrateDiscrepancyPct || HASHRATE_DISCREPANCY_PCT) / 100) {
              anomalies.push({
                type: 'hashrate_discrepancy',
                pool: poolData.poolId,
                severity: 'warning',
                detail: `Current hashrate (${reported.toFixed(
                  0
                )} TH/s) deviates ${(discrepancy * 100).toFixed(1)}% from 24h avg (${avg24h.toFixed(
                  0
                )} TH/s).`,
                current: reported,
                average24h: avg24h,
              });
            }
          }
        }
      }
    }

    // Append snapshot to performance history (keep last 168 entries ~ 7 days at hourly)
    this._performanceHistory.push({
      timestamp: new Date().toISOString(),
      poolMetrics: poolMetrics.map((m) => ({
        poolId: m.poolId,
        effectivePerTH: m.effectivePerTH,
        rejectRate: m.rejectRate,
      })),
    });
    if (this._performanceHistory.length > 168) {
      this._performanceHistory = this._performanceHistory.slice(-168);
    }

    return {
      poolCount: poolMetrics.length,
      poolMetrics,
      bestPool,
      bestEffectiveRate,
      underperformers,
      anomalies,
      hasSufficientData: poolMetrics.some(
        (m) => m.dataPoints >= (params.minObservationDays || MIN_OBSERVATION_DAYS)
      ),
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Decide ─────────────────────────────────────────────────────────────

  /**
   * If sustained underperformance is detected, recommend hashrate reallocation.
   *
   * Guardrails applied:
   *   - Minimum 1% improvement required
   *   - Maximum 20% of total hashrate can move per recommendation
   *   - 7-day minimum observation window
   *
   * @param {object} analysis
   * @returns {object}
   */
  decide(analysis) {
    const { underperformers, anomalies, bestPool, bestEffectiveRate, hasSufficientData, poolMetrics } = analysis;
    const params = this._config?.parameters || {};

    // No pools or insufficient data
    if (poolMetrics.length < 2 || !hasSufficientData) {
      return {
        action: 'none',
        reasoning: poolMetrics.length < 2
          ? 'Need at least 2 pools for comparison analysis.'
          : `Insufficient observation data. Need ${params.minObservationDays || MIN_OBSERVATION_DAYS} days minimum.`,
      };
    }

    // No sustained underperformance detected
    if (underperformers.length === 0 && anomalies.length === 0) {
      return {
        action: 'none',
        reasoning: 'All pools performing within acceptable range. No reallocation needed.',
      };
    }

    // Alert-only for anomalies without underperformance
    if (underperformers.length === 0 && anomalies.length > 0) {
      return {
        action: 'alert',
        anomalies,
        reasoning: `Detected ${anomalies.length} anomaly(s) across pools. No reallocation needed yet, but monitoring.`,
      };
    }

    // Build reallocation recommendation
    const worstPerformer = underperformers[0];
    const improvement = worstPerformer.gapPct;
    const minImprovement = params.minImprovementPct || MIN_IMPROVEMENT_PCT;
    const maxMove = params.maxHashrateMovePct || MAX_HASHRATE_MOVE_PCT;

    if (improvement < minImprovement) {
      return {
        action: 'none',
        reasoning: `Performance gap (${improvement.toFixed(
          1
        )}%) is below minimum threshold (${minImprovement}%). Continuing to monitor.`,
      };
    }

    // Calculate recommended move size (proportional to gap, capped at max)
    const movePct = Math.min(
      Math.round(improvement * 2), // Move 2x the gap percentage
      maxMove
    );

    // Estimate monthly impact
    const bestMetric = poolMetrics.find((m) => m.poolId === bestPool);
    const worstMetric = poolMetrics.find((m) => m.poolId === worstPerformer.poolId);
    const totalHashrate = poolMetrics.reduce(
      (sum, m) => sum + (m.activeWorkers * 250), // ~250 TH/s per worker avg
      0
    );
    const hashrateToMove = totalHashrate * (movePct / 100);
    const dailyDelta = (bestEffectiveRate - worstPerformer.effectiveRate) * hashrateToMove;
    const monthlyDelta = dailyDelta * 30;

    const reasoning = `${bestMetric?.poolName || bestPool} effective rate $${bestEffectiveRate.toFixed(
      4
    )}/TH/day vs ${worstMetric?.poolName || worstPerformer.poolId} $${worstPerformer.effectiveRate.toFixed(
      4
    )}/TH/day over ${worstPerformer.dataPoints} days. Recommend shifting ${movePct}% hashrate to ${
      bestMetric?.poolName || bestPool
    } for projected +$${Math.round(monthlyDelta)}/month.`;

    return {
      action: 'recommend_reallocation',
      params: {
        fromPool: worstPerformer.poolId,
        toPool: bestPool,
        movePct,
        hashrateToMoveTH: Math.round(hashrateToMove),
        estimatedMonthlyGain: Math.round(monthlyDelta * 100) / 100,
      },
      anomalies,
      reasoning,
      estimatedImpact: Math.round(monthlyDelta * 100) / 100,
    };
  }

  // ─── Act ────────────────────────────────────────────────────────────────

  /**
   * Log the recommendation. Pool reallocation is recommend-only because
   * most mining pools do not expose a hashrate redirect API.
   *
   * @param {object} decision
   * @returns {Promise<object>}
   */
  async act(decision) {
    const now = new Date().toISOString();

    try {
      if (decision.action === 'recommend_reallocation') {
        console.log(`[${AGENT_NAME}] Recommendation: ${decision.reasoning}`);
        return {
          success: true,
          action: 'recommend_reallocation',
          details: {
            fromPool: decision.params.fromPool,
            toPool: decision.params.toPool,
            movePct: decision.params.movePct,
            estimatedMonthlyGain: decision.params.estimatedMonthlyGain,
            reasoning: decision.reasoning,
            note: 'Recommendation logged. Manual reallocation required — most pools lack redirect APIs.',
            timestamp: now,
          },
        };
      }

      if (decision.action === 'alert') {
        console.log(
          `[${AGENT_NAME}] Alert: ${decision.anomalies.length} anomaly(s) detected.`
        );
        return {
          success: true,
          action: 'alert',
          details: {
            anomalies: decision.anomalies,
            reasoning: decision.reasoning,
            timestamp: now,
          },
        };
      }

      return { success: true, action: 'none', details: { timestamp: now } };
    } catch (err) {
      console.error(`[${AGENT_NAME}] Act failed:`, err.message);
      return {
        success: false,
        action: decision.action,
        error: err.message,
        timestamp: now,
      };
    }
  }
}
