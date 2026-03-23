/**
 * Agent Management & Control Routes — Phase 6
 *
 * Handles agent lifecycle, approval queue, activity feed,
 * performance metrics, reports, and emergency controls.
 */
import express from 'express';
import {
  getAllAgentRows, getAgentRow,
  getAgentEvents, getAllAgentEvents,
  getPendingApprovals, getApproval,
  getAgentMetrics, getAllAgentMetrics,
  getAgentReports, getAgentReport,
  getAgentMode, updateAgentConfig,
  getAgentRuns, getAgentRun, getAllAgentRuns,
} from '../cache/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// Lazy import runtime to avoid circular deps at module load time
let _runtime = null;
async function getRuntime() {
  if (!_runtime) {
    const mod = await import('../services/agentRuntime.js');
    _runtime = mod.default;
  }
  return _runtime;
}

// ─── Agent Management ─────────────────────────────────────────────────────

/** GET / — List all agents with status */
router.get('/', async (req, res) => {
  try {
    const runtime = await getRuntime();
    const agents = runtime.getAgentList();
    res.json({ agents, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error listing agents:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /system-status — Overall agent system status */
router.get('/system-status', async (req, res) => {
  try {
    const runtime = await getRuntime();
    const status = runtime.getSystemStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /activity — Unified activity feed across all agents */
router.get('/activity', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const agent = req.query.agent || null;
    const type = req.query.type || null;
    const events = getAllAgentEvents(limit, agent, type);
    res.json({ events, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /performance — Performance summary across all agents */
router.get('/performance', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const metrics = getAllAgentMetrics(days);

    // Aggregate by agent
    const byAgent = {};
    let totalValue = 0;
    let totalActions = 0;
    let totalApproved = 0;
    let totalRejected = 0;
    let totalSkipped = 0;
    let totalObservations = 0;

    for (const m of metrics) {
      if (!byAgent[m.agent_id]) {
        byAgent[m.agent_id] = {
          agentId: m.agent_id,
          observations: 0, recommendations: 0,
          actionsExecuted: 0, actionsApproved: 0,
          actionsRejected: 0, actionsSkipped: 0,
          valueGenerated: 0,
        };
      }
      const a = byAgent[m.agent_id];
      a.observations += m.observations;
      a.recommendations += m.recommendations;
      a.actionsExecuted += m.actions_executed;
      a.actionsApproved += m.actions_approved;
      a.actionsRejected += m.actions_rejected;
      a.actionsSkipped += m.actions_skipped;
      a.valueGenerated += m.value_generated;

      totalValue += m.value_generated;
      totalActions += m.actions_executed;
      totalApproved += m.actions_approved;
      totalRejected += m.actions_rejected;
      totalSkipped += m.actions_skipped;
      totalObservations += m.observations;
    }

    res.json({
      totalValueGenerated: totalValue,
      totalActionsExecuted: totalActions + totalApproved,
      totalActionsApproved: totalApproved,
      totalActionsRejected: totalRejected,
      totalActionsSkipped: totalSkipped,
      totalObservations,
      byAgent: Object.values(byAgent),
      days,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /reports — List generated reports */
router.get('/reports', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const reports = getAgentReports(limit);
    res.json({ reports, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /reports/:id — Get specific report content */
router.get('/reports/:id', (req, res) => {
  try {
    const report = getAgentReport(parseInt(req.params.id));
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /reports/generate — Force generate a report */
router.post('/reports/generate', async (req, res) => {
  try {
    const runtime = await getRuntime();
    const agent = runtime.agents.get('reporting-engine');
    if (!agent) return res.status(404).json({ error: 'Reporting agent not found' });

    const reportType = req.body.type || 'daily';
    const observation = await agent.observe();
    const analysis = await agent.analyze({ ...observation, forceReport: reportType });
    const decision = await agent.decide(analysis);
    if (decision.action !== 'none') {
      const result = await agent.act(decision);
      res.json({ success: true, ...result });
    } else {
      res.json({ success: false, message: 'No report needed' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Approval Queue ───────────────────────────────────────────────────────

/** GET /approvals — All pending approvals */
router.get('/approvals', (req, res) => {
  try {
    const approvals = getPendingApprovals();
    res.json({
      approvals: approvals.map(a => ({
        ...a,
        decision: a.decision_json ? JSON.parse(a.decision_json) : null,
      })),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /approvals/:id — Approval detail */
router.get('/approvals/:id', (req, res) => {
  try {
    const approval = getApproval(parseInt(req.params.id));
    if (!approval) return res.status(404).json({ error: 'Approval not found' });
    res.json({
      ...approval,
      decision: approval.decision_json ? JSON.parse(approval.decision_json) : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /approvals/:id/approve — Approve action */
router.post('/approvals/:id/approve', async (req, res) => {
  try {
    const runtime = await getRuntime();
    const result = await runtime.approveAction(parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /approvals/:id/reject — Reject action */
router.post('/approvals/:id/reject', async (req, res) => {
  try {
    const runtime = await getRuntime();
    await runtime.rejectAction(parseInt(req.params.id), req.body.reason);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Global Controls ──────────────────────────────────────────────────────

/** POST /pause-all — Emergency pause all agents */
router.post('/pause-all', async (req, res) => {
  try {
    const runtime = await getRuntime();
    await runtime.pauseAll();
    res.json({ success: true, paused: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /resume-all — Resume all agents */
router.post('/resume-all', async (req, res) => {
  try {
    const runtime = await getRuntime();
    await runtime.resumeAll();
    res.json({ success: true, paused: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Per-Agent Endpoints ──────────────────────────────────────────────────

/** GET /:id — Agent detail */
router.get('/:id', async (req, res) => {
  try {
    const runtime = await getRuntime();
    const agent = runtime.agents.get(req.params.id);
    const row = getAgentRow(req.params.id);
    const status = runtime.statuses.get(req.params.id);
    const config = runtime.configs.get(req.params.id);

    if (!row && !agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({
      id: req.params.id,
      name: agent?.name || row?.name,
      description: agent?.description,
      category: agent?.category || row?.category,
      version: agent?.version,
      status: status || { state: row?.status || 'stopped' },
      config: config || (row?.config_json ? JSON.parse(row.config_json) : null),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:id/mode — Get agent operational mode */
router.get('/:id/mode', (req, res) => {
  const mode = getAgentMode(req.params.id);
  res.json({ agentId: req.params.id, mode });
});

/** PUT /:id/mode — Set agent mode (autonomous/copilot/off) */
router.put('/:id/mode', (req, res) => {
  const { mode } = req.body;
  if (!['autonomous', 'copilot', 'off'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be autonomous, copilot, or off' });
  }
  const row = getAgentRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Agent not found' });

  const existing = row.config_json ? JSON.parse(row.config_json) : {};
  existing.mode = mode;
  updateAgentConfig(req.params.id, existing);
  res.json({ success: true, agentId: req.params.id, mode });
});

/** PUT /:id/config — Update agent config */
router.put('/:id/config', async (req, res) => {
  try {
    const runtime = await getRuntime();
    await runtime.updateConfig(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /:id/start — Start agent */
router.post('/:id/start', async (req, res) => {
  try {
    const runtime = await getRuntime();
    await runtime.startAgent(req.params.id);
    res.json({ success: true, status: runtime.statuses.get(req.params.id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /:id/stop — Stop agent */
router.post('/:id/stop', async (req, res) => {
  try {
    const runtime = await getRuntime();
    await runtime.stopAgent(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /:id/restart — Restart agent */
router.post('/:id/restart', async (req, res) => {
  try {
    const runtime = await getRuntime();
    await runtime.stopAgent(req.params.id);
    await runtime.startAgent(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:id/status — Agent status */
router.get('/:id/status', async (req, res) => {
  try {
    const runtime = await getRuntime();
    const status = runtime.statuses.get(req.params.id);
    if (!status) return res.status(404).json({ error: 'Agent not found' });
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:id/history — Agent event history */
router.get('/:id/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const events = getAgentEvents(req.params.id, limit);
    res.json({ events, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:id/metrics — Agent performance metrics */
router.get('/:id/metrics', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const metrics = getAgentMetrics(req.params.id, days);

    // Aggregate
    const totals = metrics.reduce((acc, m) => ({
      observations: acc.observations + m.observations,
      recommendations: acc.recommendations + m.recommendations,
      actionsExecuted: acc.actionsExecuted + m.actions_executed,
      actionsApproved: acc.actionsApproved + m.actions_approved,
      actionsRejected: acc.actionsRejected + m.actions_rejected,
      actionsSkipped: acc.actionsSkipped + m.actions_skipped,
      valueGenerated: acc.valueGenerated + m.value_generated,
    }), {
      observations: 0, recommendations: 0,
      actionsExecuted: 0, actionsApproved: 0,
      actionsRejected: 0, actionsSkipped: 0,
      valueGenerated: 0,
    });

    const totalActions = totals.actionsExecuted + totals.actionsApproved + totals.actionsRejected + totals.actionsSkipped;
    const accuracyRate = totalActions > 0
      ? ((totals.actionsExecuted + totals.actionsApproved) / totalActions * 100)
      : 100;

    res.json({
      ...totals,
      accuracyRate,
      days,
      daily: metrics,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Run History (eval / regression tracking) ──────────────────────────────

/** GET /runs — All runs across agents for this tenant */
router.get('/runs', (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const runs = getAllAgentRuns(tenantId, { limit, offset });
    res.json({ runs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:id/runs — Paginated run history for a specific agent */
router.get('/:id/runs', (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const agentId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const runs = getAgentRuns(tenantId, agentId, { limit, offset });
    res.json({ runs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /runs/:runId — Single run detail */
router.get('/runs/:runId', (req, res) => {
  try {
    const run = getAgentRun(req.params.runId);
    if (!run || run.tenant_id !== req.user.tenantId) {
      return res.status(404).json({ error: 'Run not found' });
    }
    // Parse tools_used JSON
    if (run.tools_used) {
      try { run.tools_used = JSON.parse(run.tools_used); } catch (e) { /* leave as string */ }
    }
    res.json({ run });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /runs/diff — Compare two run outputs */
router.get('/runs/diff', (req, res) => {
  try {
    const { a, b } = req.query;
    if (!a || !b) return res.status(400).json({ error: 'Query params a and b (run IDs) are required' });

    const runA = getAgentRun(a);
    const runB = getAgentRun(b);
    const tenantId = req.user.tenantId;

    if (!runA || runA.tenant_id !== tenantId) return res.status(404).json({ error: `Run ${a} not found` });
    if (!runB || runB.tenant_id !== tenantId) return res.status(404).json({ error: `Run ${b} not found` });

    // Compute simple line-by-line diff
    const linesA = (runA.output || '').split('\n');
    const linesB = (runB.output || '').split('\n');
    const diff = [];
    const maxLen = Math.max(linesA.length, linesB.length);

    for (let i = 0; i < maxLen; i++) {
      const lineA = linesA[i];
      const lineB = linesB[i];
      if (lineA === lineB) {
        diff.push({ type: 'equal', line: lineA });
      } else {
        if (lineA !== undefined) diff.push({ type: 'removed', line: lineA });
        if (lineB !== undefined) diff.push({ type: 'added', line: lineB });
      }
    }

    res.json({
      runA: { run_id: runA.run_id, agent_id: runA.agent_id, created_at: runA.created_at, model: runA.model, input: runA.input },
      runB: { run_id: runB.run_id, agent_id: runB.agent_id, created_at: runB.created_at, model: runB.model, input: runB.input },
      diff,
      stats: {
        added: diff.filter(d => d.type === 'added').length,
        removed: diff.filter(d => d.type === 'removed').length,
        equal: diff.filter(d => d.type === 'equal').length,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
