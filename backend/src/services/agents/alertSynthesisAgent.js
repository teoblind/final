/**
 * Alert Synthesis Agent - Phase 6
 *
 * Aggregates, correlates, and deduplicates alerts from all system phases:
 *   - Energy price alerts (Phase 2)
 *   - Hashprice alerts (Phase 3)
 *   - Curtailment events (Phase 4)
 *   - Pool events (Phase 5)
 *   - Diagnostic events (Phase 5)
 *
 * Runs every minute (autonomous/informational only). Reduces alert fatigue by:
 *   - Correlating related alerts into single situations (e.g., energy spike + curtailment)
 *   - Suppressing duplicates within a configurable window
 *   - Detecting alert storms (5+ alerts in 5 minutes)
 *   - Scoring alerts by financial impact for priority ranking
 *   - Generating periodic digest summaries
 *
 * This agent never executes operational changes - it purely synthesizes
 * information to keep operators focused on what matters.
 */

import { getAlerts, getCache } from '../../cache/database.js';

// ─── Agent Metadata ─────────────────────────────────────────────────────────

const AGENT_ID = 'alert-synthesizer';
const AGENT_NAME = 'Alert Synthesizer';
const AGENT_CATEGORY = 'alerting';
const AGENT_VERSION = '1.0.0';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALERT_STORM_THRESHOLD = 5;    // Alerts within window to trigger storm
const ALERT_STORM_WINDOW_MS = 300000; // 5 minutes
const DUPLICATE_WINDOW_MS = 600000;  // 10 min dedup window
const CORRELATION_WINDOW_MS = 300000; // 5 min correlation window
const MAX_HISTORY_SIZE = 500;         // Max alert history entries retained

/**
 * AlertSynthesisAgent - correlates, deduplicates, and summarizes alerts
 * from all system phases to reduce operator fatigue.
 */
export default class AlertSynthesisAgent {
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

    /** @type {Array<object>} Rolling alert history for correlation and dedup */
    this._alertHistory = [];
    /** @type {Map<string, object>} Dedup map: fingerprint -> last seen alert */
    this._dedupMap = new Map();
    /** @type {number} Total alerts suppressed since start */
    this._suppressedCount = 0;
    /** @type {Array<object>} Consolidated situation summaries */
    this._activeSituations = [];
    /** @type {object} Latest digest data for dashboard consumption */
    this._latestDigest = null;
  }

  // ─── Configuration ──────────────────────────────────────────────────────

  /**
   * Return the default configuration.
   * @returns {object}
   */
  getDefaultConfig() {
    return {
      enabled: true,
      mode: 'autonomous', // informational only - no operational changes
      parameters: {
        alertStormThreshold: ALERT_STORM_THRESHOLD,
        alertStormWindowMs: ALERT_STORM_WINDOW_MS,
        duplicateWindowMs: DUPLICATE_WINDOW_MS,
        correlationWindowMs: CORRELATION_WINDOW_MS,
        maxHistorySize: MAX_HISTORY_SIZE,
      },
      schedule: { type: 'interval', interval: 60000 }, // every minute
      permissions: {
        canRead: ['energy', 'hashprice', 'fleet', 'pool', 'curtailment', 'diagnostics'],
        canWrite: [],
        canAlert: true,
        canExecute: false,
        maxFinancialImpact: 0,
        requireApprovalAbove: 0,
        cooldownPeriod: 0,
      },
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize with configuration overrides.
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
    this._alertHistory = [];
    this._dedupMap = new Map();
    this._suppressedCount = 0;
    this._activeSituations = [];
    this._latestDigest = null;
  }

  /**
   * Start the per-minute alert synthesis loop.
   */
  start() {
    if (!this._config) this.initialize();
    if (!this._config.enabled) {
      this._status = 'stopped';
      return;
    }

    this._status = 'running';
    const interval = this._config.schedule?.interval || 60000;

    this._intervalHandle = setInterval(async () => {
      try {
        await this._runCycle();
      } catch (err) {
        this._errorCount++;
        console.error(`[${AGENT_NAME}] Cycle error:`, err.message);
      }
    }, interval);

    // Initial cycle
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
      suppressedCount: this._suppressedCount,
      activeSituations: this._activeSituations,
      latestDigest: this._latestDigest,
      alertHistorySize: this._alertHistory.length,
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
   * Gather recent alerts from all phases via cache and database.
   *
   * Sources:
   *   - User-defined metric alerts (alerts table)
   *   - Energy price alerts (Phase 2 cache)
   *   - Hashprice alerts (Phase 3 cache)
   *   - Curtailment events (Phase 4 cache)
   *   - Pool events (Phase 5 cache)
   *   - Diagnostic events (Phase 5 cache)
   *
   * @returns {Promise<object>}
   */
  async observe() {
    const alerts = [];
    const now = Date.now();

    // 1. User-defined metric alerts
    try {
      const userAlerts = getAlerts() || [];
      for (const a of userAlerts) {
        if (a.last_triggered) {
          alerts.push({
            source: 'metric_alert',
            type: 'threshold',
            metric: a.metric,
            condition: a.condition,
            threshold: a.threshold,
            triggeredAt: a.last_triggered,
            id: `metric-${a.id}`,
          });
        }
      }
    } catch (err) {
      console.warn(`[${AGENT_NAME}] Failed to fetch metric alerts:`, err.message);
    }

    // 2. Energy price alerts from cache
    try {
      const energyCache = getCache('energy-alerts');
      if (energyCache?.data && Array.isArray(energyCache.data)) {
        for (const e of energyCache.data) {
          alerts.push({
            source: 'energy',
            type: 'price_alert',
            detail: e.message || e.detail || 'Energy price alert',
            value: e.price || e.lmp || null,
            triggeredAt: e.timestamp || energyCache.fetchedAt,
            id: `energy-${e.node || 'unknown'}-${e.timestamp || now}`,
          });
        }
      }
    } catch (err) { /* cache may not exist */ }

    // 3. Hashprice alerts
    try {
      const hpCache = getCache('hashprice-alerts');
      if (hpCache?.data && Array.isArray(hpCache.data)) {
        for (const h of hpCache.data) {
          alerts.push({
            source: 'hashprice',
            type: 'hashprice_alert',
            detail: h.message || h.detail || 'Hashprice change',
            value: h.hashprice || null,
            triggeredAt: h.timestamp || hpCache.fetchedAt,
            id: `hp-${h.timestamp || now}`,
          });
        }
      }
    } catch (err) { /* cache may not exist */ }

    // 4. Curtailment events from cache
    try {
      const curtCache = getCache('curtailment-recent-events');
      if (curtCache?.data && Array.isArray(curtCache.data)) {
        for (const c of curtCache.data) {
          alerts.push({
            source: 'curtailment',
            type: 'curtailment_event',
            detail: c.reason || `Curtailment: ${c.trigger_type}`,
            triggerType: c.trigger_type,
            savings: c.estimated_savings || 0,
            triggeredAt: c.start_time || curtCache.fetchedAt,
            id: `curt-${c.id || now}`,
          });
        }
      }
    } catch (err) { /* cache may not exist */ }

    // 5. Pool events from cache
    try {
      const poolCache = getCache('pool-events');
      if (poolCache?.data && Array.isArray(poolCache.data)) {
        for (const p of poolCache.data) {
          alerts.push({
            source: 'pool',
            type: 'pool_event',
            detail: p.message || p.detail || 'Pool event',
            pool: p.pool || p.poolId || null,
            triggeredAt: p.timestamp || poolCache.fetchedAt,
            id: `pool-${p.pool || 'unknown'}-${p.timestamp || now}`,
          });
        }
      }
    } catch (err) { /* cache may not exist */ }

    // 6. Diagnostic events from cache
    try {
      const diagCache = getCache('diagnostic-alerts');
      if (diagCache?.data && Array.isArray(diagCache.data)) {
        for (const d of diagCache.data) {
          alerts.push({
            source: 'diagnostics',
            type: d.type || 'diagnostic_event',
            severity: d.severity || 'info',
            detail: d.detail || d.message || 'Diagnostic alert',
            triggeredAt: d.timestamp || diagCache.fetchedAt,
            id: `diag-${d.type || 'unknown'}-${d.timestamp || now}`,
          });
        }
      }
    } catch (err) { /* cache may not exist */ }

    return {
      alerts,
      totalRaw: alerts.length,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Analyze ────────────────────────────────────────────────────────────

  /**
   * Correlate, deduplicate, and score the raw alerts.
   *
   * - Correlation: Group alerts that fire within 5 min and are causally related
   *   (e.g., energy spike + curtailment recommendation = one "situation")
   * - Dedup: Suppress identical alert fingerprints within the dedup window
   * - Storm detection: Flag when 5+ alerts fire in 5 minutes
   * - Financial scoring: Rank by estimated dollar impact
   *
   * @param {object} observation
   * @returns {object}
   */
  analyze(observation) {
    const { alerts } = observation;
    const now = Date.now();
    const params = this._config?.parameters || {};
    const dupWindow = params.duplicateWindowMs || DUPLICATE_WINDOW_MS;
    const corrWindow = params.correlationWindowMs || CORRELATION_WINDOW_MS;
    const stormThreshold = params.alertStormThreshold || ALERT_STORM_THRESHOLD;
    const stormWindow = params.alertStormWindowMs || ALERT_STORM_WINDOW_MS;

    // Deduplicate
    const deduplicated = [];
    let suppressedThisCycle = 0;

    for (const alert of alerts) {
      const fingerprint = `${alert.source}:${alert.type}:${alert.metric || alert.detail || ''}`;
      const prev = this._dedupMap.get(fingerprint);

      if (prev && now - new Date(prev.triggeredAt).getTime() < dupWindow) {
        suppressedThisCycle++;
        this._suppressedCount++;
        continue;
      }

      this._dedupMap.set(fingerprint, alert);
      deduplicated.push(alert);
    }

    // Clean stale dedup entries
    for (const [key, val] of this._dedupMap.entries()) {
      if (now - new Date(val.triggeredAt).getTime() > dupWindow * 3) {
        this._dedupMap.delete(key);
      }
    }

    // Append to history
    for (const alert of deduplicated) {
      this._alertHistory.push({ ...alert, receivedAt: now });
    }
    const maxHistory = params.maxHistorySize || MAX_HISTORY_SIZE;
    if (this._alertHistory.length > maxHistory) {
      this._alertHistory = this._alertHistory.slice(-maxHistory);
    }

    // Storm detection: count alerts in last stormWindow
    const recentAlerts = this._alertHistory.filter(
      (a) => now - a.receivedAt < stormWindow
    );
    const isAlertStorm = recentAlerts.length >= stormThreshold;

    // Correlate related alerts into situations
    const situations = this._correlateAlerts(deduplicated, corrWindow);

    // Score by financial impact
    const scored = deduplicated.map((alert) => {
      let financialScore = 0;
      if (alert.savings) financialScore = alert.savings;
      if (alert.value && alert.source === 'energy') financialScore = Math.abs(alert.value) * 0.1;
      if (alert.severity === 'critical') financialScore = Math.max(financialScore, 100);
      return { ...alert, financialScore };
    });
    scored.sort((a, b) => b.financialScore - a.financialScore);

    return {
      totalRaw: alerts.length,
      deduplicated: deduplicated.length,
      suppressedThisCycle,
      totalSuppressed: this._suppressedCount,
      isAlertStorm,
      recentAlertCount: recentAlerts.length,
      situations,
      scoredAlerts: scored,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Group causally related alerts into situation summaries.
   *
   * Known correlations:
   *   - energy price_alert + curtailment_event = "Price-triggered curtailment"
   *   - hashprice_alert + curtailment_event = "Hashprice-driven state change"
   *   - diagnostic_event (critical) + pool_event = "Fleet health issue"
   *
   * @private
   * @param {Array<object>} alerts
   * @param {number} windowMs
   * @returns {Array<object>}
   */
  _correlateAlerts(alerts, windowMs) {
    const situations = [];
    const used = new Set();

    // Pattern 1: Energy spike + curtailment
    const energyAlerts = alerts.filter((a) => a.source === 'energy');
    const curtailAlerts = alerts.filter((a) => a.source === 'curtailment');

    for (const ea of energyAlerts) {
      for (const ca of curtailAlerts) {
        const eTime = new Date(ea.triggeredAt).getTime();
        const cTime = new Date(ca.triggeredAt).getTime();
        if (Math.abs(eTime - cTime) < windowMs && !used.has(ea.id) && !used.has(ca.id)) {
          situations.push({
            type: 'price_triggered_curtailment',
            summary: `Energy price alert correlated with curtailment event: ${ca.detail}`,
            alerts: [ea, ca],
            financialImpact: ca.savings || 0,
            timestamp: new Date(Math.max(eTime, cTime)).toISOString(),
          });
          used.add(ea.id);
          used.add(ca.id);
        }
      }
    }

    // Pattern 2: Hashprice + curtailment
    const hpAlerts = alerts.filter((a) => a.source === 'hashprice');
    for (const ha of hpAlerts) {
      for (const ca of curtailAlerts) {
        const hTime = new Date(ha.triggeredAt).getTime();
        const cTime = new Date(ca.triggeredAt).getTime();
        if (Math.abs(hTime - cTime) < windowMs && !used.has(ha.id) && !used.has(ca.id)) {
          situations.push({
            type: 'hashprice_state_change',
            summary: `Hashprice change correlated with curtailment: ${ca.detail}`,
            alerts: [ha, ca],
            financialImpact: ca.savings || 0,
            timestamp: new Date(Math.max(hTime, cTime)).toISOString(),
          });
          used.add(ha.id);
          used.add(ca.id);
        }
      }
    }

    // Pattern 3: Diagnostic (critical) + pool event
    const diagAlerts = alerts.filter((a) => a.source === 'diagnostics' && a.severity === 'critical');
    const poolAlerts = alerts.filter((a) => a.source === 'pool');
    for (const da of diagAlerts) {
      for (const pa of poolAlerts) {
        const dTime = new Date(da.triggeredAt).getTime();
        const pTime = new Date(pa.triggeredAt).getTime();
        if (Math.abs(dTime - pTime) < windowMs && !used.has(da.id) && !used.has(pa.id)) {
          situations.push({
            type: 'fleet_health_issue',
            summary: `Critical diagnostic event + pool disruption: ${da.detail}`,
            alerts: [da, pa],
            financialImpact: 0,
            timestamp: new Date(Math.max(dTime, pTime)).toISOString(),
          });
          used.add(da.id);
          used.add(pa.id);
        }
      }
    }

    return situations;
  }

  // ─── Decide ─────────────────────────────────────────────────────────────

  /**
   * Determine what summaries to produce: consolidated alerts, storm flags,
   * pattern notifications, and digest data.
   *
   * @param {object} analysis
   * @returns {object}
   */
  decide(analysis) {
    const { deduplicated, isAlertStorm, situations, scoredAlerts, suppressedThisCycle } = analysis;

    if (deduplicated === 0 && situations.length === 0) {
      return { action: 'none', reasoning: 'No new alerts to process.' };
    }

    const actions = [];

    // Consolidated situation summaries
    if (situations.length > 0) {
      actions.push({
        type: 'consolidated_summary',
        situations,
      });
    }

    // Alert storm warning
    if (isAlertStorm) {
      actions.push({
        type: 'alert_storm',
        count: analysis.recentAlertCount,
        message: `Alert storm detected: ${analysis.recentAlertCount} alerts in last 5 minutes. Review system status.`,
      });
    }

    // Suppression report
    if (suppressedThisCycle > 0) {
      actions.push({
        type: 'suppression_report',
        suppressedThisCycle,
        totalSuppressed: analysis.totalSuppressed,
      });
    }

    // Top priority alerts (financial impact > 0)
    const highPriority = scoredAlerts.filter((a) => a.financialScore > 0).slice(0, 5);
    if (highPriority.length > 0) {
      actions.push({
        type: 'priority_alerts',
        alerts: highPriority,
      });
    }

    return {
      action: 'synthesize',
      actions,
      reasoning: `Processed ${deduplicated} alerts, correlated ${situations.length} situation(s), suppressed ${suppressedThisCycle} duplicate(s).`,
    };
  }

  // ─── Act ────────────────────────────────────────────────────────────────

  /**
   * Log consolidated summaries, update active situations, and generate digest data.
   *
   * @param {object} decision
   * @returns {Promise<object>}
   */
  async act(decision) {
    const now = new Date().toISOString();

    try {
      // Update active situations
      const newSituations = decision.actions
        .filter((a) => a.type === 'consolidated_summary')
        .flatMap((a) => a.situations);

      if (newSituations.length > 0) {
        this._activeSituations = [
          ...newSituations,
          ...this._activeSituations,
        ].slice(0, 20); // Keep last 20 situations
      }

      // Generate digest data for dashboard
      const stormActions = decision.actions.filter((a) => a.type === 'alert_storm');
      const priorityActions = decision.actions.filter((a) => a.type === 'priority_alerts');

      this._latestDigest = {
        timestamp: now,
        situationCount: this._activeSituations.length,
        activeSituations: this._activeSituations.slice(0, 5),
        isAlertStorm: stormActions.length > 0,
        topAlerts: priorityActions.length > 0 ? priorityActions[0].alerts : [],
        suppressedTotal: this._suppressedCount,
        alertHistorySize: this._alertHistory.length,
      };

      // Log storm warnings
      for (const storm of stormActions) {
        console.warn(`[${AGENT_NAME}] ${storm.message}`);
      }

      return {
        success: true,
        action: 'synthesize',
        details: {
          actionsProcessed: decision.actions.length,
          newSituations: newSituations.length,
          activeSituations: this._activeSituations.length,
          suppressedTotal: this._suppressedCount,
          reasoning: decision.reasoning,
          timestamp: now,
        },
      };
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
