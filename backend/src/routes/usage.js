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
  getServiceQuotas,
  getServiceUsageSummary,
  initServiceQuotas,
  updateServiceQuota,
  getServiceUsageLog,
} from '../cache/database.js';
import { syncMercuryData } from '../services/usageSyncService.js';

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

    const modelBreakdown = byModel.map(row => {
      const pricing = getModelPricing(row.model);
      const inputCost = ((row.input_tokens || 0) / 1_000_000) * pricing.input;
      const outputCost = ((row.output_tokens || 0) / 1_000_000) * pricing.output;
      return {
        model: row.model,
        requests: row.requests,
        input_tokens: row.input_tokens || 0,
        output_tokens: row.output_tokens || 0,
        cost_cents: Math.round((inputCost + outputCost) * 100),
      };
    }).sort((a, b) => b.cost_cents - a.cost_cents);

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
      by_model: modelBreakdown,
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

/** GET /usage/quotas - Service quotas for this tenant */
router.get('/quotas', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });

    // Ensure quotas are seeded
    initServiceQuotas(tenantId);

    const quotas = getServiceQuotas(tenantId);
    const usageSummary = getServiceUsageSummary(tenantId);
    const usageMap = {};
    for (const u of usageSummary) { usageMap[u.service] = u; }

    const enriched = quotas.map(q => ({
      ...q,
      pct_used: q.monthly_allotment > 0 ? Math.round((q.used_this_month / q.monthly_allotment) * 100) : 0,
      overage: q.used_this_month > q.monthly_allotment,
      overage_units: Math.max(0, q.used_this_month - q.monthly_allotment),
      overage_cost_cents: Math.max(0, q.used_this_month - q.monthly_allotment) * q.overage_rate_cents,
      events_this_month: usageMap[q.service]?.event_count || 0,
    }));

    const totalOverageCents = enriched.reduce((s, q) => s + q.overage_cost_cents, 0);

    res.json({ quotas: enriched, total_overage_cents: totalOverageCents });
  } catch (error) {
    console.error('[Usage] Quotas error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** PUT /usage/quotas/:service - Update a service quota (admin only) */
router.put('/quotas/:service', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    if (req.user?.role && !['admin', 'owner'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { service } = req.params;
    updateServiceQuota(tenantId, service, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /usage/quotas/:service/log - Usage log for a specific service */
router.get('/quotas/:service/log', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'No tenant' });
    const { service } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const log = getServiceUsageLog(tenantId, service, limit);
    res.json({ log });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /usage/mercury - Mercury bank account balances and transactions */
router.get('/mercury', async (req, res) => {
  try {
    const data = await syncMercuryData();
    if (!data) return res.json({ error: 'Mercury API not configured', accounts: [], transactions: [] });
    res.json(data);
  } catch (error) {
    console.error('[Usage] Mercury error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
