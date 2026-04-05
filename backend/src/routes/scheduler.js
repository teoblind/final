/**
 * Scheduled Tasks Routes
 *
 * GET    /api/v1/scheduler        - List tasks for tenant
 * POST   /api/v1/scheduler        - Create task
 * PATCH  /api/v1/scheduler/:id    - Update (enable/disable/modify)
 * DELETE /api/v1/scheduler/:id    - Delete
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { createScheduledTask, getScheduledTasks, getScheduledTask, updateScheduledTask, deleteScheduledTask, getDefaultTenantId } from '../cache/database.js';
import { computeNextRun, isValidCron } from '../jobs/scheduledTaskRunner.js';

const router = express.Router();

// All scheduler routes require authentication
router.use(authenticate);

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || getDefaultTenantId();
  const userId = req.user.id;
  return { tenantId, userId };
}

// ---------------------------------------------------------------------------
// GET / - list scheduled tasks for tenant
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const tasks = getScheduledTasks(tenantId);
    res.json({ count: tasks.length, tasks });
  } catch (error) {
    console.error('Scheduler GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST / - create a new scheduled task
// ---------------------------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    const { title, prompt, cron_expression, timezone, max_runs, agent_id, thread_id } = req.body;

    if (!title || !prompt || !cron_expression) {
      return res.status(400).json({ error: 'title, prompt, and cron_expression are required' });
    }

    if (!isValidCron(cron_expression)) {
      return res.status(400).json({ error: `Invalid cron expression: "${cron_expression}"` });
    }

    const nextRun = computeNextRun(cron_expression, timezone || 'America/Chicago');

    const task = createScheduledTask({
      tenant_id: tenantId,
      user_id: userId,
      agent_id: agent_id || 'hivemind',
      title,
      prompt,
      cron_expression,
      timezone: timezone || 'America/Chicago',
      next_run_at: nextRun,
      max_runs: max_runs || null,
      thread_id: thread_id || null,
    });

    res.status(201).json(task);
  } catch (error) {
    console.error('Scheduler POST error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id - update a scheduled task
// ---------------------------------------------------------------------------
router.patch('/:id', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { id } = req.params;

    const existing = getScheduledTask(id);
    if (!existing || existing.tenant_id !== tenantId) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updates = {};
    const allowedFields = ['title', 'prompt', 'cron_expression', 'timezone', 'enabled', 'max_runs', 'agent_id', 'thread_id'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // Validate cron if updating
    if (updates.cron_expression && !isValidCron(updates.cron_expression)) {
      return res.status(400).json({ error: `Invalid cron expression: "${updates.cron_expression}"` });
    }

    // Recompute next_run_at if cron or timezone changed
    if (updates.cron_expression || updates.timezone) {
      const cron = updates.cron_expression || existing.cron_expression;
      const tz = updates.timezone || existing.timezone;
      updates.next_run_at = computeNextRun(cron, tz);
    }

    // If re-enabling, recompute next_run_at
    if (updates.enabled === 1 || updates.enabled === true) {
      updates.enabled = 1;
      const cron = updates.cron_expression || existing.cron_expression;
      const tz = updates.timezone || existing.timezone;
      updates.next_run_at = computeNextRun(cron, tz);
    }

    const task = updateScheduledTask(id, updates);
    res.json(task);
  } catch (error) {
    console.error('Scheduler PATCH error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id - delete a scheduled task
// ---------------------------------------------------------------------------
router.delete('/:id', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { id } = req.params;

    const existing = getScheduledTask(id);
    if (!existing || existing.tenant_id !== tenantId) {
      return res.status(404).json({ error: 'Task not found' });
    }

    deleteScheduledTask(id, tenantId);
    res.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Scheduler DELETE error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
