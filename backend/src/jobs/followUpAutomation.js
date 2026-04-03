/**
 * Follow-Up Automation for Newsletter-Generated Tasks
 *
 * Runs once daily at 14 UTC (9 AM CT), after the daily newsletter goes out
 * at 6 AM CT. Scans for newsletter-sourced outreach tasks that have been
 * sitting in 'proposed' status for more than 14 days without action.
 *
 * For each stale task (up to 10 per run):
 *  1. Checks if a follow-up email draft already exists in output_artifacts_json
 *  2. If not, uses the CLI tunnel to generate a brief follow-up check-in email
 *  3. Appends the follow-up draft as a new artifact with type "follow_up_email_draft"
 *  4. Updates the task status to "follow_up_pending"
 */

import {
  runWithTenant,
  getAgentAssignments,
  updateAgentAssignment,
} from '../cache/database.js';
import { tunnelPrompt } from '../services/cliTunnel.js';

let timer = null;

const DACP_TENANT_ID = 'dacp-construction-001';
const STALE_DAYS = 14;
const MAX_FOLLOWUPS_PER_RUN = 10;

// ── Core Logic ───────────────────────────────────────────────────────────────

async function runFollowUpAutomation() {
  console.log('[FollowUp] Starting follow-up automation run...');

  try {
    await runWithTenant(DACP_TENANT_ID, async () => {
      // Get all proposed newsletter tasks
      const allTasks = getAgentAssignments(DACP_TENANT_ID, 'proposed');

      // Filter to newsletter-sourced tasks older than STALE_DAYS
      const now = new Date();
      const staleTasks = allTasks.filter(t => {
        try {
          const ctx = t.context_json ? JSON.parse(t.context_json) : {};
          if (ctx.source !== 'newsletter') return false;

          const createdAt = new Date(t.created_at);
          const ageDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
          return ageDays >= STALE_DAYS;
        } catch {
          return false;
        }
      });

      if (staleTasks.length === 0) {
        console.log('[FollowUp] No stale newsletter tasks found. Done.');
        return;
      }

      console.log(`[FollowUp] Found ${staleTasks.length} stale newsletter tasks (>= ${STALE_DAYS} days old)`);

      // Filter out tasks that already have a follow-up draft
      const tasksNeedingFollowUp = staleTasks.filter(t => {
        try {
          const artifacts = t.output_artifacts_json ? JSON.parse(t.output_artifacts_json) : [];
          return !artifacts.some(a => a.type === 'follow_up_email_draft' || a.type === 'follow_up');
        } catch {
          return true;
        }
      });

      if (tasksNeedingFollowUp.length === 0) {
        console.log('[FollowUp] All stale tasks already have follow-up drafts. Done.');
        return;
      }

      console.log(`[FollowUp] ${tasksNeedingFollowUp.length} tasks need follow-up drafts (capping at ${MAX_FOLLOWUPS_PER_RUN})`);

      const batch = tasksNeedingFollowUp.slice(0, MAX_FOLLOWUPS_PER_RUN);
      let generated = 0;

      for (const task of batch) {
        try {
          await generateFollowUp(task);
          generated++;
        } catch (err) {
          console.error(`[FollowUp] Failed to generate follow-up for task ${task.id}: ${err.message}`);
        }
      }

      console.log(`[FollowUp] Generated ${generated}/${batch.length} follow-up drafts. Done.`);
    });
  } catch (err) {
    console.error('[FollowUp] Automation run failed:', err.message);
  }
}

async function generateFollowUp(task) {
  const ctx = task.context_json ? JSON.parse(task.context_json) : {};
  const existingArtifacts = task.output_artifacts_json ? JSON.parse(task.output_artifacts_json) : [];

  // Find the original email draft if one exists
  const originalDraft = existingArtifacts.find(a => a.type === 'email_draft');

  // Build the prompt for Claude
  let prompt = `You are a business development assistant for DACP Construction, a concrete and masonry subcontractor in Texas.

A newsletter-generated outreach task has been sitting untouched for more than 14 days. Write a brief follow-up check-in email for this opportunity.

TASK TITLE: ${task.title}

TASK DESCRIPTION: ${task.description || 'No description available.'}

NEWSLETTER DATE: ${ctx.date || 'Unknown'}`;

  if (originalDraft) {
    prompt += `

ORIGINAL EMAIL DRAFT (was never sent):
To: ${originalDraft.to || 'Unknown'}
Subject: ${originalDraft.subject || 'No subject'}
Body:
${originalDraft.body || 'No body'}`;
  }

  prompt += `

Write a short, professional follow-up email. Guidelines:
- Reference the specific project or opportunity from the original task
- Ask if they are still looking for concrete/masonry subcontractors
- Keep it under 100 words - brief and direct
- Friendly but professional tone
- Do NOT use em dashes - use regular hyphens only
- Do NOT use emojis
- Sign off as "DACP Construction Team"

Return your response as valid JSON with these exact fields:
{
  "to": "<email address from original draft, or 'TBD' if unknown>",
  "subject": "<follow-up subject line>",
  "body": "<email body text>"
}

Return ONLY the JSON object, no commentary or markdown fences.`;

  console.log(`[FollowUp] Generating follow-up for task: ${task.title} (${task.id})`);

  const raw = await tunnelPrompt({
    tenantId: DACP_TENANT_ID,
    agentId: 'marketing',
    prompt,
    maxTurns: 5,
    timeoutMs: 60_000,
    label: `Follow-up: ${task.title.slice(0, 40)}`,
  });

  // Parse the response
  let followUpData;
  try {
    const cleaned = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      followUpData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON object found in response');
    }
  } catch (parseErr) {
    console.error(`[FollowUp] Failed to parse Claude response for task ${task.id}: ${parseErr.message}`);
    // Still create a draft with the raw text
    followUpData = {
      to: originalDraft?.to || 'TBD',
      subject: `Follow-up: ${task.title}`,
      body: raw.trim(),
    };
  }

  // Build the follow-up artifact
  const followUpArtifact = {
    type: 'follow_up_email_draft',
    status: 'pending_approval',
    to: followUpData.to || originalDraft?.to || 'TBD',
    subject: followUpData.subject || `Follow-up: ${task.title}`,
    body: followUpData.body || raw.trim(),
    generated_at: new Date().toISOString(),
    original_task_age_days: Math.floor((new Date() - new Date(task.created_at)) / (1000 * 60 * 60 * 24)),
  };

  // Append to existing artifacts
  const updatedArtifacts = [...existingArtifacts, followUpArtifact];

  // Update the task
  updateAgentAssignment(DACP_TENANT_ID, task.id, {
    output_artifacts_json: JSON.stringify(updatedArtifacts),
    status: 'follow_up_pending',
  });

  console.log(`[FollowUp] Created follow-up draft for task ${task.id} -> ${followUpArtifact.to}`);
}

// ── Scheduler ────────────────────────────────────────────────────────────────

export function startFollowUpAutomation({ runAtHour = 14, intervalHours = 24 } = {}) {
  if (timer) {
    console.log('[FollowUp] Already running');
    return;
  }

  const intervalMs = intervalHours * 3600000;

  // Calculate delay until next run
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setUTCHours(runAtHour, 0, 0, 0);
  if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
  const delay = nextRun - now;

  console.log(`[FollowUp] Scheduled - next run at ${nextRun.toISOString()} (in ${Math.round(delay / 60000)}m)`);

  setTimeout(() => {
    runFollowUpAutomation().catch(err => console.error('[FollowUp] Error:', err.message));

    timer = setInterval(() => {
      runFollowUpAutomation().catch(err => console.error('[FollowUp] Error:', err.message));
    }, intervalMs);
  }, delay);
}

export function stopFollowUpAutomation() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[FollowUp] Stopped');
  }
}

export { runFollowUpAutomation };
