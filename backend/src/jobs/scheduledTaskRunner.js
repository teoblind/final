/**
 * Scheduled Task Runner Job
 *
 * Every minute, iterates all tenants and executes any scheduled tasks whose
 * next_run_at has passed. Uses cron-parser to compute the next run time.
 * Calls chat() from chatService to execute the task prompt.
 */

import { CronExpressionParser } from 'cron-parser';
import { getAllTenants, runWithTenant, getDueScheduledTasks, updateScheduledTask } from '../cache/database.js';
import { tunnelOrChat } from '../services/cliTunnel.js';

let pollInterval = null;

/**
 * Compute the next run time from a cron expression + timezone.
 * Returns an ISO string or null on error.
 */
export function computeNextRun(cronExpression, timezone = 'America/Chicago') {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      tz: timezone,
      currentDate: new Date(),
    });
    return interval.next().toISOString();
  } catch (err) {
    console.error(`[Scheduler] Failed to parse cron "${cronExpression}":`, err.message);
    return null;
  }
}

/**
 * Validate a cron expression. Returns true if valid.
 */
export function isValidCron(cronExpression) {
  try {
    CronExpressionParser.parse(cronExpression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run all due scheduled tasks across all tenants.
 */
async function tick() {
  let tenants;
  try {
    tenants = getAllTenants();
  } catch (err) {
    console.error('[Scheduler] Failed to get tenants:', err.message);
    return;
  }

  for (const tenant of tenants) {
    try {
      await runWithTenant(tenant.id, async () => {
        const dueTasks = getDueScheduledTasks();
        if (dueTasks.length === 0) return;

        for (const task of dueTasks) {
          try {
            console.log(`[Scheduler] Running task "${task.title}" for tenant ${tenant.id}`);

            // Execute the task prompt via CLI tunnel (falls back to chatService)
            await tunnelOrChat({
              tenantId: tenant.id,
              agentId: task.agent_id,
              userId: task.user_id,
              prompt: task.prompt,
              threadId: task.thread_id || null,
              maxTurns: 15,
              timeoutMs: 180_000,
              label: `Scheduled: ${task.title}`,
            });

            // Compute next run
            const nextRun = computeNextRun(task.cron_expression, task.timezone);
            const newRunCount = (task.run_count || 0) + 1;

            // Check if max_runs reached
            const shouldDisable = task.max_runs && newRunCount >= task.max_runs;

            updateScheduledTask(task.id, {
              last_run_at: new Date().toISOString(),
              next_run_at: shouldDisable ? null : nextRun,
              run_count: newRunCount,
              enabled: shouldDisable ? 0 : 1,
            });

            if (shouldDisable) {
              console.log(`[Scheduler] Task "${task.title}" reached max_runs (${task.max_runs}), disabled.`);
            }
          } catch (err) {
            console.error(`[Scheduler] Error running task "${task.title}" (${task.id}):`, err.message);
            // Still update next_run_at so we don't retry the same minute
            try {
              const nextRun = computeNextRun(task.cron_expression, task.timezone);
              updateScheduledTask(task.id, {
                next_run_at: nextRun,
              });
            } catch (e) {
              // ignore
            }
          }
        }
      });
    } catch (err) {
      console.error(`[Scheduler] Error processing tenant ${tenant.id}:`, err.message);
    }
  }
}

/**
 * Start the scheduled task runner. Polls every intervalMs (default 60s).
 */
export function startScheduledTaskRunner(intervalMs = 60000) {
  if (pollInterval) {
    console.log('[Scheduler] Runner already started');
    return;
  }

  console.log(`[Scheduler] Task runner started (interval: ${Math.round(intervalMs / 1000)}s)`);

  // Initial tick after 10s
  setTimeout(() => {
    tick().catch(err => console.error('[Scheduler] Initial tick error:', err.message));
  }, 10000);

  pollInterval = setInterval(() => {
    tick().catch(err => console.error('[Scheduler] Tick error:', err.message));
  }, intervalMs);
}

/**
 * Stop the scheduled task runner.
 */
export function stopScheduledTaskRunner() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[Scheduler] Task runner stopped');
  }
}
