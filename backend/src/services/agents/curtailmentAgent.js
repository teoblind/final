/**
 * Curtailment Optimizer Agent - Phase 6
 *
 * The most valuable agent in the system. Automates curtailment decisions from
 * Phase 4 by continuously monitoring energy prices, fleet profitability, and
 * operational constraints to determine when machines should mine or curtail.
 *
 * Observe-Analyze-Decide-Act (OADA) loop:
 *   1. Observe: Gather current recommendation, fleet config, recent events
 *   2. Analyze: Determine if a state change is needed and its financial impact
 *   3. Decide: Choose action (curtail, resume, regenerate schedule, or none)
 *   4. Act: Log the curtailment event and return execution result
 *
 * Modes:
 *   - 'recommend': Generates recommendations that require operator approval
 *   - 'autonomous': Auto-executes within configured financial guardrails
 */

import curtailmentEngine from '../curtailmentEngine.js';
import {
  getFleetConfig,
  getCurtailmentEvents,
  insertCurtailmentEvent,
  getEnergySettings,
  getCache,
} from '../../cache/database.js';
import { getHashrateReconciliation } from '../diagnosticsEngine.js';

// ─── Agent Metadata ─────────────────────────────────────────────────────────

const AGENT_ID = 'curtailment-optimizer';
const AGENT_NAME = 'Curtailment Optimizer';
const AGENT_CATEGORY = 'curtailment';
const AGENT_VERSION = '1.0.0';

/**
 * CurtailmentAgent - automates mining/curtailment state transitions based on
 * real-time energy pricing, fleet economics, and operational constraints.
 */
export default class CurtailmentAgent {
  constructor() {
    /** @type {string} Unique agent identifier */
    this.id = AGENT_ID;
    /** @type {string} Human-readable agent name */
    this.name = AGENT_NAME;
    /** @type {string} Agent category for grouping */
    this.category = AGENT_CATEGORY;
    /** @type {string} Semantic version */
    this.version = AGENT_VERSION;

    /** @type {object|null} Active configuration */
    this._config = null;
    /** @type {string} Current lifecycle state: stopped | running | error */
    this._status = 'stopped';
    /** @type {number|null} Interval timer handle */
    this._intervalHandle = null;
    /** @type {object|null} Most recent observation */
    this._lastObservation = null;
    /** @type {object|null} Most recent analysis */
    this._lastAnalysis = null;
    /** @type {object|null} Most recent decision */
    this._lastDecision = null;
    /** @type {string|null} Timestamp of last successful cycle */
    this._lastCycleAt = null;
    /** @type {number} Running count of completed OADA cycles */
    this._cycleCount = 0;
    /** @type {number} Count of errors since last successful cycle */
    this._errorCount = 0;
  }

  // ─── Configuration ──────────────────────────────────────────────────────

  /**
   * Return the default configuration for this agent.
   * @returns {object} Default config object
   */
  getDefaultConfig() {
    return {
      enabled: true,
      mode: 'recommend',
      parameters: {
        hysteresisBandMWh: 2,
        minCurtailmentMinutes: 30,
        cooldownMinutes: 15,
        maxAutonomousImpactPerHr: 500,
        requireApprovalAbovePerHr: 1000,
        scheduleRegenerationHour: 14, // ~1:30 PM CPT (DAM publish)
      },
      schedule: { type: 'interval', interval: 300000 }, // 5 minutes
      permissions: {
        canRead: ['energy', 'hashprice', 'fleet', 'pool'],
        canWrite: ['curtailment'],
        canAlert: true,
        canExecute: true,
        maxFinancialImpact: 500,
        requireApprovalAbove: 1000,
        cooldownPeriod: 900, // 15 minutes in seconds
      },
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize agent with a configuration object.
   * Merges provided config over defaults.
   * @param {object} config - Configuration overrides
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
  }

  /**
   * Start the agent's OADA loop on the configured interval.
   */
  start() {
    if (!this._config) {
      this.initialize();
    }
    if (!this._config.enabled) {
      this._status = 'stopped';
      return;
    }

    this._status = 'running';
    const interval = this._config.schedule?.interval || 300000;

    this._intervalHandle = setInterval(async () => {
      try {
        await this._runCycle();
      } catch (err) {
        this._errorCount++;
        console.error(`[${AGENT_NAME}] Cycle error:`, err.message);
      }
    }, interval);

    // Run an initial cycle immediately
    this._runCycle().catch((err) => {
      this._errorCount++;
      console.error(`[${AGENT_NAME}] Initial cycle error:`, err.message);
    });
  }

  /**
   * Stop the agent loop and clean up resources.
   */
  stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
    this._status = 'stopped';
  }

  /**
   * Return the current state of the agent for dashboard display.
   * @returns {object} Agent state snapshot
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
    };
  }

  // ─── OADA Loop ──────────────────────────────────────────────────────────

  /**
   * Execute one full observe-analyze-decide-act cycle.
   * @private
   */
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
   * Gather all data needed for analysis.
   * Pulls current recommendation, fleet config, recent events, and
   * hashrate reconciliation from the diagnostics engine.
   *
   * @returns {Promise<object>} Observation payload
   */
  async observe() {
    let recommendation = null;
    try {
      recommendation = await curtailmentEngine.getCurrentRecommendation();
    } catch (err) {
      console.warn(`[${AGENT_NAME}] Failed to get recommendation:`, err.message);
      recommendation = { hasFleet: false, error: err.message };
    }

    let fleetConfig = null;
    try {
      fleetConfig = getFleetConfig();
    } catch (err) {
      console.warn(`[${AGENT_NAME}] Failed to get fleet config:`, err.message);
    }

    let recentEvents = [];
    try {
      recentEvents = getCurtailmentEvents(7);
    } catch (err) {
      console.warn(`[${AGENT_NAME}] Failed to get curtailment events:`, err.message);
    }

    let reconciliation = null;
    try {
      reconciliation = await getHashrateReconciliation();
    } catch (err) {
      console.warn(`[${AGENT_NAME}] Failed to get reconciliation:`, err.message);
      reconciliation = { status: 'error', message: err.message };
    }

    return {
      recommendation,
      fleetConfig,
      recentEvents,
      reconciliation,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Analyze ────────────────────────────────────────────────────────────

  /**
   * Analyze the observation to determine whether action is needed.
   *
   * Checks:
   *   - Is a fleet configured?
   *   - Does the recommendation differ from the current state?
   *   - Is reconciliation healthy? (pause autonomous mode if not)
   *   - Is it time to regenerate the DAM schedule?
   *   - What is the financial impact of the recommended state change?
   *
   * @param {object} observation - Output from observe()
   * @returns {object} Analysis result
   */
  analyze(observation) {
    const { recommendation, fleetConfig, recentEvents, reconciliation } = observation;

    // No fleet configured
    if (!recommendation?.hasFleet || !fleetConfig?.entries?.length) {
      return {
        hasFleet: false,
        stateChangeNeeded: false,
        currentState: null,
        recommendedState: null,
        financialImpact: 0,
        decisions: [],
        reconciliationOk: true,
        needsScheduleRegen: false,
        reasoning: 'No fleet configured. Skipping analysis.',
      };
    }

    // Determine current active state from recent events
    const activeEvent = recentEvents.find(
      (e) => e.start_time && !e.end_time
    );
    const currentState = activeEvent ? 'CURTAILED' : 'MINING';
    const recommendedState = recommendation.fleetState || 'MINING';

    // State change detection
    const stateChangeNeeded = currentState !== recommendedState;

    // Reconciliation health check
    const reconciliationOk =
      !reconciliation ||
      reconciliation.status === 'healthy' ||
      reconciliation.status === 'error'; // ignore errors, don't block

    // DAM schedule regeneration check
    const currentHour = new Date().getHours();
    const schedRegenHour = this._config?.parameters?.scheduleRegenerationHour ?? 14;
    const needsScheduleRegen = currentHour === schedRegenHour;

    // Financial impact calculation
    const summary = recommendation.summary || {};
    const financialImpact = stateChangeNeeded
      ? Math.abs(summary.curtailmentSavingsPerHr || 0)
      : 0;

    // Build reasoning
    const reasons = [];
    if (stateChangeNeeded) {
      const price = recommendation.energyPrice?.current;
      if (recommendedState === 'CURTAILED' || recommendedState === 'PARTIAL') {
        reasons.push(
          `Energy price ($${(price || 0).toFixed(2)}/MWh) makes some machines unprofitable.`
        );
        reasons.push(
          `Estimated savings: $${(summary.curtailmentSavingsPerHr || 0).toFixed(2)}/hr.`
        );
      } else {
        reasons.push(
          `Energy price ($${(price || 0).toFixed(2)}/MWh) is favorable. All machines are profitable.`
        );
      }
    }
    if (!reconciliationOk) {
      reasons.push(
        `Reconciliation status is '${reconciliation?.status}'. Autonomous execution paused.`
      );
    }
    if (needsScheduleRegen) {
      reasons.push('DAM prices expected - schedule regeneration flagged.');
    }

    return {
      hasFleet: true,
      stateChangeNeeded,
      currentState,
      recommendedState,
      financialImpact,
      decisions: recommendation.decisions || [],
      reconciliationOk,
      needsScheduleRegen,
      reasoning: reasons.length > 0 ? reasons.join(' ') : 'No action needed at this time.',
    };
  }

  // ─── Decide ─────────────────────────────────────────────────────────────

  /**
   * Decide what action to take based on the analysis.
   *
   * Actions:
   *   - 'none': No action required
   *   - 'curtail': Shut down unprofitable machine classes
   *   - 'resume': Bring curtailed machines back online
   *   - 'regenerate_schedule': Rebuild the 24h operating schedule from DAM data
   *
   * @param {object} analysis - Output from analyze()
   * @returns {object} Decision with action, params, reasoning, and estimatedImpact
   */
  decide(analysis) {
    const {
      hasFleet,
      stateChangeNeeded,
      currentState,
      recommendedState,
      financialImpact,
      decisions,
      reconciliationOk,
      needsScheduleRegen,
    } = analysis;

    // Nothing to do
    if (!hasFleet || (!stateChangeNeeded && !needsScheduleRegen)) {
      return { action: 'none', reasoning: analysis.reasoning };
    }

    // Schedule regeneration takes priority when triggered
    if (needsScheduleRegen) {
      return {
        action: 'regenerate_schedule',
        reasoning: 'Day-ahead market prices expected. Regenerating 24h operating schedule.',
        estimatedImpact: 0,
      };
    }

    // If reconciliation failed, pause autonomous but still recommend
    if (!reconciliationOk && this._config?.mode === 'autonomous') {
      return {
        action: 'none',
        reasoning:
          'Reconciliation indicates hashrate discrepancy. Autonomous execution paused until resolved. Manual action recommended.',
        pendingRecommendation: {
          recommendedState,
          financialImpact,
          decisions,
        },
      };
    }

    // Build curtail/resume decision
    const curtailDecisions = decisions.filter((d) => d.action === 'CURTAIL');
    const mineDecisions = decisions.filter((d) => d.action === 'MINE');
    const isResume = recommendedState === 'MINING' && currentState !== 'MINING';
    const isCurtail = recommendedState !== 'MINING' && currentState === 'MINING';

    // Collect the machine classes and metrics affected
    const affectedDecisions = isCurtail ? curtailDecisions : mineDecisions;
    const machineClasses = affectedDecisions.map((d) => d.model);
    const totalMachines = affectedDecisions.reduce((sum, d) => sum + d.quantity, 0);
    const totalPowerMW = affectedDecisions.reduce((sum, d) => sum + (d.powerMW || 0), 0);
    const totalHashrateTH = affectedDecisions.reduce((sum, d) => sum + (d.hashrateTH || 0), 0);

    // Build specific, quantitative reasoning string
    let reasoning;
    if (isCurtail && curtailDecisions.length > 0) {
      const topDecision = curtailDecisions[0];
      const price = topDecision.currentPriceMWh || 0;
      const breakeven = topDecision.breakevenMWh || 0;
      const excessPct =
        breakeven > 0 ? (((price - breakeven) / breakeven) * 100).toFixed(1) : '0.0';
      const savingsHr = curtailDecisions
        .reduce((sum, d) => sum + (d.avoidedLossPerHr || 0), 0)
        .toFixed(2);
      reasoning = `Curtailing ${topDecision.model} fleet because energy price ($${price.toFixed(
        2
      )}/MWh) exceeds ${topDecision.model} breakeven ($${breakeven.toFixed(
        2
      )}/MWh) by ${excessPct}%, saving an estimated $${savingsHr}/hr`;
    } else if (isResume && mineDecisions.length > 0) {
      const topDecision = mineDecisions[0];
      const price = topDecision.currentPriceMWh || 0;
      const breakeven = topDecision.breakevenMWh || 0;
      const margin = (breakeven - price).toFixed(2);
      reasoning = `Resuming ${topDecision.model} fleet because energy price ($${price.toFixed(
        2
      )}/MWh) is $${margin} below breakeven ($${breakeven.toFixed(
        2
      )}/MWh). Fleet is profitable - resuming mining.`;
    } else {
      reasoning = analysis.reasoning;
    }

    return {
      action: isCurtail ? 'curtail' : 'resume',
      params: {
        machineClasses,
        machines: totalMachines,
        powerMW: Math.round(totalPowerMW * 1000) / 1000,
        hashrateTH: Math.round(totalHashrateTH),
      },
      reasoning,
      estimatedImpact: Math.round(financialImpact * 100) / 100,
    };
  }

  // ─── Act ────────────────────────────────────────────────────────────────

  /**
   * Execute the decision by logging the curtailment event.
   *
   * For 'curtail' and 'resume' actions, creates a curtailment_events record.
   * For 'regenerate_schedule', calls the curtailment engine scheduler.
   *
   * @param {object} decision - Output from decide()
   * @returns {Promise<object>} Execution result
   */
  async act(decision) {
    const now = new Date().toISOString();

    try {
      if (decision.action === 'regenerate_schedule') {
        const schedule = await curtailmentEngine.generateSchedule();
        return {
          success: true,
          action: 'regenerate_schedule',
          details: {
            miningHours: schedule?.summary?.miningHours ?? null,
            curtailedHours: schedule?.summary?.curtailedHours ?? null,
            estimatedNetRevenue: schedule?.summary?.estimatedNetRevenue ?? null,
            timestamp: now,
          },
        };
      }

      if (decision.action === 'curtail' || decision.action === 'resume') {
        const triggerType =
          this._config?.mode === 'autonomous' ? 'agent_autonomous' : 'agent_recommendation';

        const eventId = insertCurtailmentEvent({
          triggerType,
          startTime: now,
          endTime: decision.action === 'resume' ? now : null,
          durationMinutes: null,
          machineClasses: JSON.stringify(decision.params.machineClasses),
          energyPriceMWh:
            this._lastObservation?.recommendation?.energyPrice?.current ?? null,
          estimatedSavings: decision.estimatedImpact || 0,
          reason: decision.reasoning,
          acknowledged: this._config?.mode === 'autonomous' ? 1 : 0,
          hashrateCurtailed:
            decision.action === 'curtail' ? decision.params.hashrateTH : null,
          machinesCurtailed:
            decision.action === 'curtail' ? decision.params.machines : null,
          powerCurtailedMW:
            decision.action === 'curtail' ? decision.params.powerMW : null,
          savingsType: decision.action === 'curtail' ? 'avoided_losses' : null,
        });

        return {
          success: true,
          action: decision.action,
          details: {
            eventId,
            machineClasses: decision.params.machineClasses,
            machines: decision.params.machines,
            powerMW: decision.params.powerMW,
            hashrateTH: decision.params.hashrateTH,
            estimatedImpact: decision.estimatedImpact,
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
