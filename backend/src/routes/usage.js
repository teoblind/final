/**
 * Usage Metering Routes - Tenant-scoped usage visibility
 *
 * Makes AI usage visible per tenant so account sharing becomes self-punishing
 * (more users = higher bill). Provides monthly summaries, per-user breakdowns,
 * budget controls, and active session tracking.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getMonthlyUsageSummary,
  getUsageBudget,
  upsertUsageBudget,
  getActiveSessions,
} from '../cache/database.js';

const router = Router();

// All usage routes require authentication
router.use(authenticate);

// Model pricing (per million tokens) - mirrors admin.js
const MODEL_PRICING = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-20250414': { input: 0.80, output: 4 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
};

function getModelPricing(model) {
  if (!model) return { input: 3, output: 15 };
  const m = (model || '').toLowerCase();
  if (m.includes('haiku')) return MODEL_PRICING['claude-haiku-4-20250414'];
  if (m.includes('opus')) return MODEL_PRICING['claude-opus-4-20250514'];
  return MODEL_PRICING['claude-sonnet-4-20250514'];
}

/** GET /usage/summary - Current month usage for this tenant */
router.get('/summary', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });

    const { byModel, byUser, byDay, taskCosts } = getMonthlyUsageSummary(tenantId);

    // Total cost from model breakdown
    let totalCostCents = 0;
    for (const row of byModel) {
      const pricing = getModelPricing(row.model);
      const cost = ((row.input_tokens || 0) / 1_000_000) * pricing.input
                 + ((row.output_tokens || 0) / 1_000_000) * pricing.output;
      totalCostCents += Math.round(cost * 100);
    }

    const totalRequests = byModel.reduce((s, r) => s + r.requests, 0);
    const totalInputTokens = byModel.reduce((s, r) => s + (r.input_tokens || 0), 0);
    const totalOutputTokens = byModel.reduce((s, r) => s + (r.output_tokens || 0), 0);

    // Per-user cost breakdown
    const users = {};
    for (const row of byUser) {
      const uid = row.user_id || 'system';
      if (!users[uid]) users[uid] = { user_id: uid, requests: 0, input_tokens: 0, output_tokens: 0, cost_cents: 0 };
      users[uid].requests += row.requests;
      users[uid].input_tokens += (row.input_tokens || 0);
      users[uid].output_tokens += (row.output_tokens || 0);
      const pricing = getModelPricing(row.model);
      users[uid].cost_cents += Math.round(
        (((row.input_tokens || 0) / 1_000_000) * pricing.input + ((row.output_tokens || 0) / 1_000_000) * pricing.output) * 100
      );
    }

    // Daily cost breakdown
    const daily = byDay.map(d => {
      // Use weighted cost per day (approximate with sonnet pricing)
      const pricing = getModelPricing(null); // default sonnet
      const costCents = Math.round(
        (((d.input_tokens || 0) / 1_000_000) * pricing.input + ((d.output_tokens || 0) / 1_000_000) * pricing.output) * 100
      );
      return {
        day: d.day,
        requests: d.requests,
        cost_cents: costCents,
      };
    });

    const budget = getUsageBudget(tenantId);

    res.json({
      period: 'current_month',
      month: new Date().toISOString().slice(0, 7),
      summary: {
        total_cost_cents: totalCostCents,
        total_requests: totalRequests,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        tasks_run: taskCosts?.tasks_run || 0,
        task_cost_cents: taskCosts?.total_task_cost_cents || 0,
      },
      by_user: Object.values(users).sort((a, b) => b.cost_cents - a.cost_cents),
      by_day: daily,
      budget: budget ? {
        monthly_limit_cents: budget.monthly_limit_cents,
        alert_threshold_pct: budget.alert_threshold_pct,
        enforce_limit: !!budget.enforce_limit,
        pct_used: budget.monthly_limit_cents > 0 ? Math.round((totalCostCents / budget.monthly_limit_cents) * 100) : 0,
      } : null,
    });
  } catch (error) {
    console.error('[Usage] Summary error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** GET /usage/sessions - Active sessions for this tenant */
router.get('/sessions', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const sessions = getActiveSessions(tenantId);
    res.json({ sessions, count: sessions.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** PUT /usage/budget - Set monthly budget (admin only) */
router.put('/budget', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    // Only admin/owner can set budgets
    if (req.user?.role && !['admin', 'owner'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { monthlyLimitCents, alertThresholdPct, enforceLimit } = req.body;
    upsertUsageBudget(tenantId, { monthlyLimitCents, alertThresholdPct, enforceLimit });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /usage/budget - Get current budget */
router.get('/budget', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const budget = getUsageBudget(tenantId);
    res.json(budget || { monthly_limit_cents: 0, alert_threshold_pct: 80, enforce_limit: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
