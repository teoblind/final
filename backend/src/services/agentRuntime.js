/**
 * Agent Runtime — Phase 6: Clawbot Agent Framework
 *
 * Core runtime that registers, manages, and orchestrates autonomous agents.
 * Each agent follows the OODA loop (Observe-Orient/Analyze-Decide-Act) and
 * operates in one of four modes: observe, recommend, approve, autonomous.
 *
 * Key design principles:
 *   - Pluggable: agents register via registerAgent() with a standard interface
 *   - Guarded: financial impact checks, cooldown periods, approval queues
 *   - Observable: full event bus, every action logged to DB
 *   - Fail-safe: automatic downgrade on repeated rejections, error-rate stops
 *   - Emergency controls: PAUSE ALL / RESUME ALL at any time
 */

import {
  upsertAgent, updateAgentStatus, updateAgentConfig, getAgentRow, getAllAgentRows,
  insertAgentEvent, getAgentEvents, getAllAgentEvents,
  insertAgentApproval, getPendingApprovals, getApproval, resolveApproval, expireOldApprovals,
  upsertAgentMetrics, getAgentMetrics, getAllAgentMetrics,
  insertNotification,
} from '../cache/database.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAFETY_REJECTION_WINDOW_MS = 60 * 60 * 1000;  // 1 hour
const SAFETY_REJECTION_THRESHOLD = 3;                // rejections before downgrade
const SAFETY_ERROR_WINDOW_MS = 60 * 60 * 1000;      // 1 hour
const SAFETY_ERROR_THRESHOLD = 5;                    // errors before auto-stop
const APPROVAL_EXPIRY_CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds
const DEFAULT_APPROVAL_TTL_MS = 30 * 60 * 1000;      // 30 minutes

// ---------------------------------------------------------------------------
// AgentRuntime
// ---------------------------------------------------------------------------

class AgentRuntime {
  constructor() {
    /** @type {Map<string, object>} agentId -> agent instance */
    this.agents = new Map();

    /** @type {Map<string, object>} agentId -> AgentConfig */
    this.configs = new Map();

    /** @type {Map<string, string>} agentId -> current status label */
    this.statuses = new Map();

    /** @type {Map<string, *>} agentId -> interval/timeout ref */
    this.timers = new Map();

    /** @type {Map<string, Set<Function>>} eventName -> handlers */
    this.listeners = new Map();

    /** @type {boolean} Global pause flag */
    this.paused = false;

    /** @type {Date|null} When the runtime was started */
    this.startedAt = null;

    // Safety tracking
    /** @type {Map<string, Array<{timestamp: number}>>} */
    this.recentRejections = new Map();

    /** @type {Map<string, Array<{timestamp: number}>>} */
    this.recentErrors = new Map();

    /** @type {Map<string, number>} agentId -> last action timestamp (ms) for cooldown */
    this.lastActionTime = new Map();

    /** @type {*} Interval ref for approval expiry sweeps */
    this._expiryInterval = null;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Boot the runtime. Call once at server start.
   * Starts the periodic approval-expiry sweep and marks the start time.
   */
  start() {
    this.startedAt = new Date();

    // Periodic sweep: expire stale approvals
    this._expiryInterval = setInterval(() => {
      try {
        const expired = expireOldApprovals();
        if (expired > 0) {
          this.emit('system:approvals_expired', { count: expired });
        }
      } catch (err) {
        console.error('[AgentRuntime] Approval expiry sweep failed:', err.message);
      }
    }, APPROVAL_EXPIRY_CHECK_INTERVAL_MS);

    console.log('[AgentRuntime] Runtime started');
  }

  /**
   * Gracefully shut down: stop all agents and clear intervals.
   */
  async shutdown() {
    for (const agentId of this.agents.keys()) {
      try {
        await this.stopAgent(agentId);
      } catch (err) {
        console.error(`[AgentRuntime] Error stopping agent ${agentId} during shutdown:`, err.message);
      }
    }

    if (this._expiryInterval) {
      clearInterval(this._expiryInterval);
      this._expiryInterval = null;
    }

    console.log('[AgentRuntime] Runtime shut down');
  }

  // =========================================================================
  // Agent Registration
  // =========================================================================

  /**
   * Register a new agent with the runtime.
   * Persists its metadata to the DB and initialises it with saved or default config.
   *
   * @param {object} agent - Must implement the agent interface (id, name, observe, analyze, decide, act, etc.)
   * @returns {Promise<void>}
   */
  async registerAgent(agent) {
    if (!agent || !agent.id) {
      throw new Error('Agent must have an id');
    }

    if (this.agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered`);
    }

    // Determine config: use saved DB config if present, otherwise default
    const existingRow = getAgentRow(agent.id);
    let config;

    if (existingRow && existingRow.config_json) {
      try {
        config = JSON.parse(existingRow.config_json);
      } catch (_) {
        config = agent.getDefaultConfig();
      }
    } else {
      config = agent.getDefaultConfig();
    }

    // Persist agent metadata
    upsertAgent(agent.id, agent.name, agent.category, config, 'stopped');

    // Initialise agent with its config
    await agent.initialize(config);

    // Store in memory
    this.agents.set(agent.id, agent);
    this.configs.set(agent.id, config);
    this.statuses.set(agent.id, 'stopped');

    insertAgentEvent(agent.id, 'lifecycle', 'registered', `Agent "${agent.name}" registered`);
    this.emit('agent:registered', { agentId: agent.id, name: agent.name });

    console.log(`[AgentRuntime] Registered agent: ${agent.name} (${agent.id})`);
  }

  /**
   * Unregister an agent. Stops it first if running.
   *
   * @param {string} agentId
   * @returns {Promise<void>}
   */
  async unregisterAgent(agentId) {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" is not registered`);
    }

    // Stop if running
    const status = this.statuses.get(agentId);
    if (status && status !== 'stopped') {
      await this.stopAgent(agentId);
    }

    this.agents.delete(agentId);
    this.configs.delete(agentId);
    this.statuses.delete(agentId);
    this.recentRejections.delete(agentId);
    this.recentErrors.delete(agentId);
    this.lastActionTime.delete(agentId);

    insertAgentEvent(agentId, 'lifecycle', 'unregistered', `Agent "${agentId}" unregistered`);
    this.emit('agent:unregistered', { agentId });
  }

  // =========================================================================
  // Agent Start / Stop / Restart
  // =========================================================================

  /**
   * Start an agent's run loop based on its schedule config.
   *
   * @param {string} agentId
   * @returns {Promise<void>}
   */
  async startAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" is not registered`);

    const config = this.configs.get(agentId);
    if (!config || !config.enabled) {
      throw new Error(`Agent "${agentId}" is disabled in config`);
    }

    // Call agent's own start hook
    await agent.start();

    this._setStatus(agentId, 'observing');
    updateAgentStatus(agentId, 'running');
    insertAgentEvent(agentId, 'lifecycle', 'started', `Agent "${agent.name}" started`);
    this.emit('agent:started', { agentId, name: agent.name });

    // Set up run loop based on schedule type
    this._scheduleLoop(agentId, config);

    console.log(`[AgentRuntime] Started agent: ${agent.name} (${agentId})`);
  }

  /**
   * Stop an agent, clear its timer, and call its stop hook.
   *
   * @param {string} agentId
   * @returns {Promise<void>}
   */
  async stopAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" is not registered`);

    // Clear any scheduled timer
    this._clearTimer(agentId);

    // Call agent's own stop hook
    try {
      await agent.stop();
    } catch (err) {
      console.error(`[AgentRuntime] Error in agent.stop() for ${agentId}:`, err.message);
    }

    this._setStatus(agentId, 'stopped');
    updateAgentStatus(agentId, 'stopped');
    insertAgentEvent(agentId, 'lifecycle', 'stopped', `Agent "${agent.name}" stopped`);
    this.emit('agent:stopped', { agentId, name: agent.name });

    console.log(`[AgentRuntime] Stopped agent: ${agent.name} (${agentId})`);
  }

  /**
   * Restart an agent (stop then start).
   *
   * @param {string} agentId
   * @returns {Promise<void>}
   */
  async restartAgent(agentId) {
    await this.stopAgent(agentId);
    await this.startAgent(agentId);
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Update an agent's config at runtime. Persists to DB.
   * If the agent is running, it is restarted with the new config.
   *
   * @param {string} agentId
   * @param {object} newConfig - Partial or full config object (merged with existing)
   * @returns {Promise<void>}
   */
  async updateConfig(agentId, newConfig) {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" is not registered`);
    }

    const existing = this.configs.get(agentId) || {};
    const merged = {
      ...existing,
      ...newConfig,
      parameters: { ...existing.parameters, ...newConfig.parameters },
      permissions: { ...existing.permissions, ...newConfig.permissions },
      schedule: { ...existing.schedule, ...newConfig.schedule },
    };

    this.configs.set(agentId, merged);
    updateAgentConfig(agentId, merged);

    insertAgentEvent(agentId, 'config', 'config_updated', 'Agent configuration updated', newConfig);
    this.emit('agent:config_updated', { agentId, config: merged });

    // Re-initialise the agent with the updated config
    const agent = this.agents.get(agentId);
    await agent.initialize(merged);

    // Restart if currently running
    const status = this.statuses.get(agentId);
    if (status && status !== 'stopped') {
      await this.restartAgent(agentId);
    }
  }

  // =========================================================================
  // Core OODA Loop
  // =========================================================================

  /**
   * Execute one full OODA cycle for an agent.
   * Called by the scheduled loop or can be invoked manually.
   *
   * @param {string} agentId
   * @returns {Promise<void>}
   */
  async runAgentCycle(agentId) {
    // Guard: global pause
    if (this.paused) return;

    const agent = this.agents.get(agentId);
    const config = this.configs.get(agentId);
    const status = this.statuses.get(agentId);

    if (!agent || !config) return;
    if (status === 'stopped') return;

    const today = new Date().toISOString().split('T')[0];
    const cycleStart = Date.now();
    let observation = null;
    let analysis = null;
    let decision = null;

    try {
      // --- OBSERVE ---
      this._setStatus(agentId, 'observing');
      observation = await agent.observe();

      // --- ANALYZE ---
      this._setStatus(agentId, 'analyzing');
      analysis = await agent.analyze(observation);

      // --- DECIDE ---
      this._setStatus(agentId, 'deciding');
      decision = await agent.decide(analysis);

      const cycleDurationMs = Date.now() - cycleStart;

      // No action needed
      if (!decision || decision.action === 'none') {
        insertAgentEvent(
          agentId, 'observe', 'observation',
          'Observation complete — no action needed',
          { observation: this._summarize(observation), analysis: this._summarize(analysis) },
          0, decision?.reasoning || null
        );

        upsertAgentMetrics(agentId, today, {
          observations: 1,
          avg_response_ms: cycleDurationMs,
        });

        this._setStatus(agentId, 'observing');
        return;
      }

      // --- MODE-BASED DISPATCH ---
      const mode = config.mode || 'observe';

      if (mode === 'observe') {
        // Log observation only — never recommend or act
        insertAgentEvent(
          agentId, 'observe', 'observation',
          `Observed: ${decision.action}`,
          { observation: this._summarize(observation), decision: this._summarize(decision) },
          decision.estimatedImpact || 0,
          decision.reasoning || null
        );

        upsertAgentMetrics(agentId, today, {
          observations: 1,
          actions_skipped: 1,
          avg_response_ms: cycleDurationMs,
        });

      } else if (mode === 'recommend') {
        // Log recommendation + notify, but do not act
        insertAgentEvent(
          agentId, 'decide', 'recommendation',
          `Recommendation: ${decision.action} — ${decision.reasoning || ''}`,
          { decision: this._summarize(decision), analysis: this._summarize(analysis) },
          decision.estimatedImpact || 0,
          decision.reasoning || null
        );

        insertNotification(
          agent.id, 'recommendation',
          `${agent.name}: Recommendation`,
          `${decision.action} — ${decision.reasoning || 'No details'}`,
          null
        );

        upsertAgentMetrics(agentId, today, {
          observations: 1,
          recommendations: 1,
          avg_response_ms: cycleDurationMs,
        });

        this.emit('agent:recommendation', {
          agentId, name: agent.name, decision,
        });

      } else if (mode === 'approve') {
        // Queue for human approval
        const expiresAt = new Date(Date.now() + DEFAULT_APPROVAL_TTL_MS).toISOString();

        const approvalId = insertAgentApproval(
          agentId,
          decision,
          decision.reasoning || '',
          decision.estimatedImpact || 0,
          expiresAt
        );

        insertAgentEvent(
          agentId, 'decide', 'approval_requested',
          `Approval requested: ${decision.action}`,
          { decision: this._summarize(decision), approvalId },
          decision.estimatedImpact || 0,
          decision.reasoning || null
        );

        insertNotification(
          agent.id, 'action_required',
          `${agent.name}: Approval Required`,
          `Action "${decision.action}" requires approval. Est. impact: $${(decision.estimatedImpact || 0).toFixed(2)}/hr`,
          `/agents/approvals/${approvalId}`
        );

        upsertAgentMetrics(agentId, today, {
          observations: 1,
          recommendations: 1,
          avg_response_ms: cycleDurationMs,
        });

        this._setStatus(agentId, 'waiting_approval');
        this.emit('agent:approval_requested', {
          agentId, name: agent.name, approvalId, decision,
        });

      } else if (mode === 'autonomous') {
        // --- Guardrail checks ---
        const permissions = config.permissions || {};

        // Financial impact check
        const impact = decision.estimatedImpact || 0;
        const maxImpact = permissions.maxFinancialImpact ?? Infinity;
        const approvalThreshold = permissions.requireApprovalAbove ?? Infinity;

        if (Math.abs(impact) > approvalThreshold) {
          // Impact exceeds auto-approval threshold — escalate to approval queue
          const expiresAt = new Date(Date.now() + DEFAULT_APPROVAL_TTL_MS).toISOString();

          const approvalId = insertAgentApproval(
            agentId, decision, decision.reasoning || '',
            impact, expiresAt
          );

          insertAgentEvent(
            agentId, 'decide', 'approval_escalated',
            `Impact $${impact.toFixed(2)}/hr exceeds auto-approval threshold — escalated`,
            { decision: this._summarize(decision), approvalId },
            impact, decision.reasoning || null
          );

          insertNotification(
            agent.id, 'action_required',
            `${agent.name}: High-Impact Action Escalated`,
            `Action "${decision.action}" has impact $${impact.toFixed(2)}/hr (threshold: $${approvalThreshold.toFixed(2)}/hr). Requires manual approval.`,
            `/agents/approvals/${approvalId}`
          );

          this._setStatus(agentId, 'waiting_approval');
          this.emit('agent:approval_requested', {
            agentId, name: agent.name, approvalId, decision, escalated: true,
          });

          upsertAgentMetrics(agentId, today, {
            observations: 1,
            recommendations: 1,
            avg_response_ms: cycleDurationMs,
          });

          return;
        }

        if (Math.abs(impact) > maxImpact) {
          // Exceeds maximum allowed financial impact — skip
          insertAgentEvent(
            agentId, 'decide', 'action_blocked',
            `Action blocked: impact $${impact.toFixed(2)}/hr exceeds max $${maxImpact.toFixed(2)}/hr`,
            { decision: this._summarize(decision) },
            impact, decision.reasoning || null
          );

          upsertAgentMetrics(agentId, today, {
            observations: 1,
            actions_skipped: 1,
            avg_response_ms: cycleDurationMs,
          });

          return;
        }

        // Cooldown check
        const cooldownSec = permissions.cooldownPeriod || 0;
        if (cooldownSec > 0) {
          const lastAction = this.lastActionTime.get(agentId) || 0;
          const elapsed = (Date.now() - lastAction) / 1000;
          if (elapsed < cooldownSec) {
            insertAgentEvent(
              agentId, 'decide', 'action_cooldown',
              `Action deferred: ${Math.ceil(cooldownSec - elapsed)}s remaining in cooldown`,
              { decision: this._summarize(decision) },
              0, null
            );

            upsertAgentMetrics(agentId, today, {
              observations: 1,
              actions_skipped: 1,
              avg_response_ms: cycleDurationMs,
            });

            return;
          }
        }

        // Execution check
        if (permissions.canExecute === false) {
          insertAgentEvent(
            agentId, 'decide', 'action_blocked',
            'Action blocked: agent does not have execute permission',
            { decision: this._summarize(decision) },
            impact, decision.reasoning || null
          );

          upsertAgentMetrics(agentId, today, {
            observations: 1,
            actions_skipped: 1,
            avg_response_ms: cycleDurationMs,
          });

          return;
        }

        // --- ACT ---
        this._setStatus(agentId, 'acting');
        const actionResult = await agent.act(decision);
        this.lastActionTime.set(agentId, Date.now());

        insertAgentEvent(
          agentId, 'act', 'action_executed',
          `Executed: ${decision.action} — ${actionResult?.summary || 'done'}`,
          { decision: this._summarize(decision), result: this._summarize(actionResult) },
          decision.estimatedImpact || 0,
          decision.reasoning || null
        );

        upsertAgentMetrics(agentId, today, {
          observations: 1,
          actions_executed: 1,
          value_generated: decision.estimatedImpact || 0,
          avg_response_ms: cycleDurationMs,
        });

        this.emit('agent:action', {
          agentId, name: agent.name, decision, result: actionResult,
        });
      }

      // Return to observing
      if (this.statuses.get(agentId) !== 'waiting_approval') {
        this._setStatus(agentId, 'observing');
      }

    } catch (err) {
      console.error(`[AgentRuntime] Error in cycle for agent ${agentId}:`, err.message);

      this._setStatus(agentId, 'error');
      updateAgentStatus(agentId, 'error');

      insertAgentEvent(
        agentId, 'error', 'cycle_error',
        `Error: ${err.message}`,
        { stack: err.stack },
        0, null
      );

      this.emit('agent:error', { agentId, error: err.message });

      // Track for safety trigger
      this._trackError(agentId);
      this._checkErrorSafety(agentId);
    }
  }

  // =========================================================================
  // Approval Queue
  // =========================================================================

  /**
   * Approve a pending action. Executes the stored decision via agent.act().
   *
   * @param {number} approvalId
   * @returns {Promise<object>} The action result
   */
  async approveAction(approvalId) {
    const approval = getApproval(approvalId);
    if (!approval) throw new Error(`Approval ${approvalId} not found`);
    if (approval.status !== 'pending') throw new Error(`Approval ${approvalId} is already ${approval.status}`);

    const agent = this.agents.get(approval.agent_id);
    if (!agent) throw new Error(`Agent "${approval.agent_id}" is not registered`);

    // Parse the stored decision
    let decision;
    try {
      decision = JSON.parse(approval.decision_json);
    } catch (_) {
      throw new Error('Could not parse stored decision');
    }

    // Resolve approval
    resolveApproval(approvalId, 'approved', 'operator');

    // Execute the action
    const today = new Date().toISOString().split('T')[0];
    let actionResult;

    try {
      this._setStatus(approval.agent_id, 'acting');
      actionResult = await agent.act(decision);
      this.lastActionTime.set(approval.agent_id, Date.now());

      insertAgentEvent(
        approval.agent_id, 'act', 'action_approved_and_executed',
        `Approved & executed: ${decision.action} — ${actionResult?.summary || 'done'}`,
        { decision: this._summarize(decision), result: this._summarize(actionResult), approvalId },
        decision.estimatedImpact || 0,
        decision.reasoning || null
      );

      upsertAgentMetrics(approval.agent_id, today, {
        actions_executed: 1,
        actions_approved: 1,
        value_generated: decision.estimatedImpact || 0,
      });

      this.emit('agent:action', {
        agentId: approval.agent_id, name: agent.name,
        decision, result: actionResult, approvedBy: 'operator',
      });

      this._setStatus(approval.agent_id, 'observing');

    } catch (err) {
      insertAgentEvent(
        approval.agent_id, 'error', 'approved_action_failed',
        `Approved action failed: ${err.message}`,
        { decision: this._summarize(decision), error: err.message, approvalId },
        0, null
      );
      this._setStatus(approval.agent_id, 'error');
      throw err;
    }

    return actionResult;
  }

  /**
   * Reject a pending action.
   *
   * @param {number} approvalId
   * @param {string} [reason] - Human-supplied rejection reason
   */
  rejectAction(approvalId, reason = '') {
    const approval = getApproval(approvalId);
    if (!approval) throw new Error(`Approval ${approvalId} not found`);
    if (approval.status !== 'pending') throw new Error(`Approval ${approvalId} is already ${approval.status}`);

    resolveApproval(approvalId, 'rejected', 'operator', reason);

    const today = new Date().toISOString().split('T')[0];

    insertAgentEvent(
      approval.agent_id, 'decide', 'action_rejected',
      `Action rejected: ${reason || 'no reason given'}`,
      { approvalId, reason },
      0, null
    );

    upsertAgentMetrics(approval.agent_id, today, {
      actions_rejected: 1,
    });

    this.emit('agent:rejected', {
      agentId: approval.agent_id, approvalId, reason,
    });

    // Track for safety trigger
    this._trackRejection(approval.agent_id);
    this._checkRejectionSafety(approval.agent_id);

    // Resume observing if agent was waiting
    if (this.statuses.get(approval.agent_id) === 'waiting_approval') {
      this._setStatus(approval.agent_id, 'observing');
    }
  }

  /**
   * Get all pending approvals across agents.
   *
   * @returns {Array<object>}
   */
  getPendingApprovals() {
    return getPendingApprovals();
  }

  // =========================================================================
  // Emergency Controls
  // =========================================================================

  /**
   * Pause ALL agents. Running loops will skip cycles until resumed.
   */
  pauseAll() {
    this.paused = true;

    insertAgentEvent(
      'system', 'lifecycle', 'system_paused',
      'All agents paused (emergency control)'
    );

    insertNotification(
      'system', 'warning',
      'System Paused',
      'All agent operations have been paused via emergency control.',
      '/agents'
    );

    this.emit('system:paused', { timestamp: new Date().toISOString() });
    console.log('[AgentRuntime] ALL AGENTS PAUSED');
  }

  /**
   * Resume ALL agents after a global pause.
   */
  resumeAll() {
    this.paused = false;

    insertAgentEvent(
      'system', 'lifecycle', 'system_resumed',
      'All agents resumed'
    );

    insertNotification(
      'system', 'info',
      'System Resumed',
      'Agent operations have been resumed.',
      '/agents'
    );

    this.emit('system:resumed', { timestamp: new Date().toISOString() });
    console.log('[AgentRuntime] ALL AGENTS RESUMED');
  }

  // =========================================================================
  // System Status
  // =========================================================================

  /**
   * Return a snapshot of the entire runtime's state.
   *
   * @returns {object}
   */
  /**
   * Get a list of all registered agents with their status, config, and last event.
   */
  getAgentList() {
    const result = [];
    const today = new Date().toISOString().split('T')[0];

    for (const [id, agent] of this.agents.entries()) {
      const config = this.configs.get(id);
      const status = this.statuses.get(id) || { state: 'stopped' };

      // Get today's metrics for value tracking
      let valueToday = 0;
      try {
        const metrics = getAgentMetrics(id, 1);
        for (const m of metrics) {
          if (m.date === today) valueToday += m.value_generated || 0;
        }
      } catch (_) { /* ok */ }

      // Get last event
      let lastEvent = null;
      try {
        const events = getAgentEvents(id, 1);
        if (events.length > 0) lastEvent = events[0];
      } catch (_) { /* ok */ }

      result.push({
        id,
        name: agent.name,
        description: agent.description,
        version: agent.version,
        category: agent.category,
        config,
        status: typeof status === 'string' ? { state: status } : status,
        metrics: { valueToday },
        lastEvent,
      });
    }
    return result;
  }

  getSystemStatus() {
    const agentStatuses = [];
    for (const [id, agent] of this.agents.entries()) {
      agentStatuses.push({
        id,
        name: agent.name,
        category: agent.category,
        status: this.statuses.get(id) || 'unknown',
        mode: this.configs.get(id)?.mode || 'observe',
        enabled: this.configs.get(id)?.enabled ?? false,
      });
    }

    const activeCount = agentStatuses.filter(
      a => a.status !== 'stopped' && a.status !== 'error'
    ).length;

    let pendingApprovalCount = 0;
    try {
      pendingApprovalCount = getPendingApprovals().length;
    } catch (_) { /* db may not be ready */ }

    // Calculate today's value generated across all agents
    const today = new Date().toISOString().split('T')[0];
    let totalValueToday = 0;
    try {
      const todayMetrics = getAllAgentMetrics(1);
      for (const m of todayMetrics) {
        if (m.date === today) {
          totalValueToday += m.value_generated || 0;
        }
      }
    } catch (_) { /* ok */ }

    const uptimeMs = this.startedAt ? Date.now() - this.startedAt.getTime() : 0;

    return {
      paused: this.paused,
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      uptime: uptimeMs,
      uptimeHuman: this._formatUptime(uptimeMs),
      agentCount: this.agents.size,
      activeCount,
      pendingApprovals: pendingApprovalCount,
      totalValueToday,
      agents: agentStatuses,
    };
  }

  /**
   * Get detailed status for a single agent.
   *
   * @param {string} agentId
   * @returns {object}
   */
  getAgentStatus(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const config = this.configs.get(agentId);
    const status = this.statuses.get(agentId);
    const row = getAgentRow(agentId);

    return {
      id: agentId,
      name: agent.name,
      description: agent.description,
      version: agent.version,
      category: agent.category,
      status,
      config,
      dbRecord: row,
    };
  }

  // =========================================================================
  // Event Bus
  // =========================================================================

  /**
   * Register an event listener.
   *
   * @param {string} eventName
   * @param {Function} handler
   */
  on(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(handler);
  }

  /**
   * Remove an event listener.
   *
   * @param {string} eventName
   * @param {Function} handler
   */
  off(eventName, handler) {
    const handlers = this.listeners.get(eventName);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit an event to all registered listeners.
   *
   * @param {string} eventName
   * @param {*} data
   */
  emit(eventName, data) {
    const handlers = this.listeners.get(eventName);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[AgentRuntime] Event handler error for "${eventName}":`, err.message);
      }
    }
  }

  // =========================================================================
  // Internal — Scheduling
  // =========================================================================

  /**
   * Set up the run-loop timer for an agent based on its schedule config.
   *
   * @param {string} agentId
   * @param {object} config
   * @private
   */
  _scheduleLoop(agentId, config) {
    this._clearTimer(agentId);

    const schedule = config.schedule || { type: 'interval', interval: 60000 };

    switch (schedule.type) {
      case 'continuous': {
        // Run as fast as possible with a small breathing gap (1s)
        const runContinuous = async () => {
          await this.runAgentCycle(agentId);
          // Only re-schedule if still running
          if (this.statuses.get(agentId) !== 'stopped') {
            const timer = setTimeout(runContinuous, 1000);
            this.timers.set(agentId, timer);
          }
        };
        const timer = setTimeout(runContinuous, 1000);
        this.timers.set(agentId, timer);
        break;
      }

      case 'interval': {
        const intervalMs = schedule.interval || 60000;
        // Run immediately, then at intervals
        this.runAgentCycle(agentId).catch(err => {
          console.error(`[AgentRuntime] Initial cycle error for ${agentId}:`, err.message);
        });
        const timer = setInterval(() => {
          this.runAgentCycle(agentId).catch(err => {
            console.error(`[AgentRuntime] Interval cycle error for ${agentId}:`, err.message);
          });
        }, intervalMs);
        this.timers.set(agentId, timer);
        break;
      }

      case 'cron': {
        // Simple cron-like: parse schedule.cron as interval-based approximation
        // For full cron support a library like node-cron would be integrated.
        // Here we approximate common patterns or fall back to the interval field.
        const intervalMs = schedule.interval || 300000; // default 5min
        const timer = setInterval(() => {
          this.runAgentCycle(agentId).catch(err => {
            console.error(`[AgentRuntime] Cron cycle error for ${agentId}:`, err.message);
          });
        }, intervalMs);
        this.timers.set(agentId, timer);
        break;
      }

      case 'event': {
        // Event-driven: the loop is triggered externally via triggerAgent().
        // No timer needed, but we store a sentinel so status tracking works.
        this.timers.set(agentId, 'event-driven');
        break;
      }

      default: {
        // Fallback to 60s interval
        const timer = setInterval(() => {
          this.runAgentCycle(agentId).catch(err => {
            console.error(`[AgentRuntime] Default cycle error for ${agentId}:`, err.message);
          });
        }, 60000);
        this.timers.set(agentId, timer);
      }
    }
  }

  /**
   * Manually trigger a single cycle for an event-driven agent.
   *
   * @param {string} agentId
   * @param {*} [eventData] - Optional context passed via the event
   * @returns {Promise<void>}
   */
  async triggerAgent(agentId, eventData = null) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" is not registered`);

    // Stash event data on the agent so observe() can pick it up
    if (eventData !== null && typeof agent.setEventData === 'function') {
      agent.setEventData(eventData);
    }

    await this.runAgentCycle(agentId);
  }

  /**
   * Clear a scheduled timer for an agent.
   *
   * @param {string} agentId
   * @private
   */
  _clearTimer(agentId) {
    const timer = this.timers.get(agentId);
    if (timer && timer !== 'event-driven') {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.timers.delete(agentId);
  }

  // =========================================================================
  // Internal — Safety Triggers
  // =========================================================================

  /**
   * Track a rejection for safety analysis.
   * @param {string} agentId
   * @private
   */
  _trackRejection(agentId) {
    if (!this.recentRejections.has(agentId)) {
      this.recentRejections.set(agentId, []);
    }
    const list = this.recentRejections.get(agentId);
    list.push({ timestamp: Date.now() });

    // Prune old entries
    const cutoff = Date.now() - SAFETY_REJECTION_WINDOW_MS;
    this.recentRejections.set(agentId, list.filter(r => r.timestamp >= cutoff));
  }

  /**
   * Check if rejection count triggers an automatic mode downgrade.
   * 3+ rejections in 1 hour: autonomous -> approve
   *
   * @param {string} agentId
   * @private
   */
  _checkRejectionSafety(agentId) {
    const list = this.recentRejections.get(agentId) || [];
    const cutoff = Date.now() - SAFETY_REJECTION_WINDOW_MS;
    const recent = list.filter(r => r.timestamp >= cutoff);

    if (recent.length >= SAFETY_REJECTION_THRESHOLD) {
      const config = this.configs.get(agentId);
      if (config && config.mode === 'autonomous') {
        // Downgrade
        config.mode = 'approve';
        this.configs.set(agentId, config);
        updateAgentConfig(agentId, config);

        insertAgentEvent(
          agentId, 'safety', 'mode_downgraded',
          `Safety trigger: ${recent.length} rejections in 1 hour — downgraded from autonomous to approve`,
          { rejectionCount: recent.length }
        );

        insertNotification(
          agentId, 'warning',
          `Agent Downgraded: ${this.agents.get(agentId)?.name || agentId}`,
          `Automatic downgrade from autonomous to approve mode after ${recent.length} rejections in 1 hour.`,
          `/agents/${agentId}`
        );

        this.emit('agent:downgraded', {
          agentId, from: 'autonomous', to: 'approve', reason: 'repeated_rejections',
        });

        console.warn(`[AgentRuntime] SAFETY: Agent ${agentId} downgraded autonomous -> approve (${recent.length} rejections)`);

        // Clear rejection counter after downgrade
        this.recentRejections.set(agentId, []);
      }
    }
  }

  /**
   * Track an error for safety analysis.
   * @param {string} agentId
   * @private
   */
  _trackError(agentId) {
    if (!this.recentErrors.has(agentId)) {
      this.recentErrors.set(agentId, []);
    }
    const list = this.recentErrors.get(agentId);
    list.push({ timestamp: Date.now() });

    // Prune old entries
    const cutoff = Date.now() - SAFETY_ERROR_WINDOW_MS;
    this.recentErrors.set(agentId, list.filter(e => e.timestamp >= cutoff));
  }

  /**
   * If error count exceeds threshold, automatically stop the agent.
   *
   * @param {string} agentId
   * @private
   */
  _checkErrorSafety(agentId) {
    const list = this.recentErrors.get(agentId) || [];
    const cutoff = Date.now() - SAFETY_ERROR_WINDOW_MS;
    const recent = list.filter(e => e.timestamp >= cutoff);

    if (recent.length >= SAFETY_ERROR_THRESHOLD) {
      insertAgentEvent(
        agentId, 'safety', 'auto_stopped',
        `Safety trigger: ${recent.length} errors in 1 hour — agent auto-stopped`,
        { errorCount: recent.length }
      );

      insertNotification(
        agentId, 'error',
        `Agent Stopped: ${this.agents.get(agentId)?.name || agentId}`,
        `Automatically stopped after ${recent.length} errors in 1 hour. Manual restart required.`,
        `/agents/${agentId}`
      );

      this.emit('agent:auto_stopped', {
        agentId, reason: 'excessive_errors', errorCount: recent.length,
      });

      console.error(`[AgentRuntime] SAFETY: Agent ${agentId} auto-stopped (${recent.length} errors in 1h)`);

      // Stop the agent (fire-and-forget since we're already in error handling)
      this.stopAgent(agentId).catch(err => {
        console.error(`[AgentRuntime] Failed to auto-stop agent ${agentId}:`, err.message);
      });

      // Clear error counter
      this.recentErrors.set(agentId, []);
    }
  }

  // =========================================================================
  // Internal — Helpers
  // =========================================================================

  /**
   * Set in-memory status for an agent.
   * @param {string} agentId
   * @param {string} status
   * @private
   */
  _setStatus(agentId, status) {
    this.statuses.set(agentId, status);
  }

  /**
   * Safely summarize an object for DB storage (truncate large payloads).
   * @param {*} obj
   * @returns {object|null}
   * @private
   */
  _summarize(obj) {
    if (!obj) return null;
    try {
      const str = JSON.stringify(obj);
      if (str.length > 10000) {
        // Truncate very large payloads to keep DB manageable
        return { _truncated: true, preview: str.slice(0, 2000) };
      }
      return obj;
    } catch (_) {
      return { _error: 'Could not serialize object' };
    }
  }

  /**
   * Format an uptime duration in human-readable form.
   * @param {number} ms
   * @returns {string}
   * @private
   */
  _formatUptime(ms) {
    if (ms <= 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

const runtime = new AgentRuntime();

export default runtime;
export { AgentRuntime };
