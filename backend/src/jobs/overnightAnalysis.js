/**
 * Overnight Autonomous Analysis Job
 *
 * Runs nightly for each tenant. Gathers business context (bids, estimates,
 * jobs, emails, entities) and asks Claude to propose assignments that
 * Coppice can execute when confirmed by the user.
 *
 * Categories: follow_up, estimate, outreach, admin, research
 */

import { randomUUID } from 'crypto';
import {
  getAllTenants, runWithTenant,
  getDacpBidRequests, getDacpEstimates, getDacpJobs, getDacpStats,
  insertAgentAssignment, clearOldAssignments, getAgentAssignments,
  getKeyVaultValue,
} from '../cache/database.js';

let timer = null;

// ─── Context Gathering ───────────────────────────────────────────────────────

function gatherDacpContext(tenantId) {
  const stats = getDacpStats(tenantId);
  const bids = getDacpBidRequests(tenantId);
  const estimates = getDacpEstimates(tenantId);
  const jobs = getDacpJobs(tenantId);

  // Open bids without estimates
  const bidsWithoutEstimates = bids.filter(b =>
    b.status === 'new' && !estimates.some(e => e.bid_request_id === b.id)
  );

  // Estimates in draft — haven't been sent
  const draftEstimates = estimates.filter(e => e.status === 'draft');

  // Bids due within 7 days
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 86400000);
  const urgentBids = bids.filter(b => {
    if (b.status !== 'new' && b.status !== 'estimated') return false;
    const due = new Date(b.due_date);
    return due >= now && due <= nextWeek;
  });

  // Jobs that are pending (awarded but not active)
  const pendingJobs = jobs.filter(j => j.status === 'pending');

  // Active jobs (might need status updates)
  const activeJobs = jobs.filter(j => j.status === 'active');

  // Bids older than 14 days with no follow-up (sent but no response)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
  const staleEstimates = estimates.filter(e => {
    if (e.status !== 'sent') return false;
    const sent = new Date(e.updated_at || e.created_at);
    return sent < twoWeeksAgo;
  });

  // GC names we've worked with (for relationship context)
  const gcNames = [...new Set(bids.map(b => b.gc_name).filter(Boolean))];

  return {
    stats,
    bidsWithoutEstimates: bidsWithoutEstimates.map(b => ({
      id: b.id, project_name: b.project_name, gc_name: b.gc_name,
      due_date: b.due_date, from_email: b.from_email, subject: b.subject,
    })),
    draftEstimates: draftEstimates.map(e => ({
      id: e.id, project_name: e.project_name, gc_name: e.gcName || e.gc_name,
      totalBid: e.totalBid, bid_request_id: e.bid_request_id,
    })),
    urgentBids: urgentBids.map(b => ({
      id: b.id, project_name: b.project_name, gc_name: b.gc_name,
      due_date: b.due_date, status: b.status,
    })),
    pendingJobs: pendingJobs.map(j => ({
      id: j.id, project_name: j.project_name, gc_name: j.gc_name, status: j.status,
    })),
    activeJobs: activeJobs.map(j => ({
      id: j.id, project_name: j.project_name, gc_name: j.gc_name,
    })),
    staleEstimates: staleEstimates.map(e => ({
      id: e.id, project_name: e.project_name, gc_name: e.gcName || e.gc_name,
      totalBid: e.totalBid,
    })),
    gcNames,
  };
}

// ─── Assignment Generation ───────────────────────────────────────────────────

function buildAnalysisPrompt(context) {
  return `You are the overnight autonomous analyst for DACP Construction — a concrete and masonry subcontractor based in DFW (Dallas-Fort Worth), Texas.

DACP BUSINESS CONTEXT:
- Core work: concrete foundations, flatwork, structural concrete, masonry, site work
- Clients: General Contractors (GCs) who send RFQs/ITBs for commercial and residential projects
- Workflow: GC sends RFQ → DACP creates estimate → submits bid → wins/loses → job execution
- Revenue model: bid on projects, win work, execute with crews
- Key metrics: win rate, margins, bid pipeline volume, GC relationships

Review DACP's current business state and propose 3-8 specific assignments for Coppice to execute.

CURRENT BUSINESS STATE:
${JSON.stringify(context, null, 2)}

ASSIGNMENT CATEGORIES:
- follow_up: Email follow-ups on sent estimates or bids awaiting GC response. GCs award to whoever stays top of mind.
- estimate: Finalize draft estimates, review pricing, prepare and send bid packages to GCs
- outreach: Proactive emails to GCs about upcoming projects, relationship building, asking about bid opportunities
- admin: Activate awarded jobs, update job statuses, clean up records, generate weekly summaries

RULES:
1. Every assignment must name the specific project and GC — no generic tasks
2. Prioritize: urgent bid deadlines > pending job activations > stale follow-ups > outreach
3. Follow-ups are HIGH value — a short "checking in on our bid for [project]" email wins jobs
4. For estimates: focus on getting drafts finalized and sent, not research
5. Do NOT suggest "researching market rates" or generic industry research — DACP knows their pricing
6. Do NOT suggest tasks that require information DACP doesn't have
7. Each task must be completable in one agent session (draft an email, update a record, send a bid)
8. Sign all emails as Coppice (the AI agent), not as individual people

Return a JSON array. Each object:
{
  "title": "Short title (5-10 words)",
  "description": "What to do and why (1-2 sentences)",
  "category": "follow_up|estimate|outreach|admin",
  "priority": "high|medium|low",
  "action_prompt": "The exact prompt to give the agent to execute this task",
  "agent_id": "estimating|comms|hivemind"
}

Return ONLY the JSON array, no markdown or explanation.`;
}

async function generateAssignments(tenantId, context) {
  const { chat } = await import('../services/chatService.js');

  const result = await chat(tenantId, 'estimating', 'system',
    buildAnalysisPrompt(context), null, { helpMode: false }
  );

  const response = result.response || '';

  // Parse JSON from response (handle markdown code blocks)
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn('[OvernightAnalysis] No JSON array in response');
    return [];
  }

  try {
    const assignments = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(assignments)) return [];
    return assignments.filter(a => a.title && a.description);
  } catch (err) {
    console.error('[OvernightAnalysis] JSON parse error:', err.message);
    return [];
  }
}

// ─── Main Job ────────────────────────────────────────────────────────────────

async function runOvernightAnalysis() {
  const tenants = getAllTenants();

  for (const tenant of tenants) {
    try {
      await runWithTenant(tenant.id, async () => {
        console.log(`[OvernightAnalysis] Running for tenant: ${tenant.id}`);

        // Skip tenants without DACP data
        const stats = getDacpStats(tenant.id);
        if (!stats || (stats.totalBidRequests === 0 && stats.totalJobs === 0)) {
          console.log(`[OvernightAnalysis] Skipping ${tenant.id} — no DACP data`);
          return;
        }

        // Clean old completed/dismissed assignments
        clearOldAssignments(tenant.id, 7);

        // Check if we already ran today
        const existing = getAgentAssignments(tenant.id, 'proposed');
        const today = new Date().toISOString().slice(0, 10);
        const alreadyRanToday = existing.some(a => a.created_at?.startsWith(today));
        if (alreadyRanToday) {
          console.log(`[OvernightAnalysis] Already ran today for ${tenant.id}`);
          return;
        }

        // Gather context
        const context = gatherDacpContext(tenant.id);

        // Generate assignments
        const assignments = await generateAssignments(tenant.id, context);
        console.log(`[OvernightAnalysis] Generated ${assignments.length} assignments for ${tenant.id}`);

        // Store assignments
        for (const a of assignments) {
          insertAgentAssignment({
            id: `assign-${randomUUID().slice(0, 8)}`,
            tenant_id: tenant.id,
            agent_id: a.agent_id || 'estimating',
            title: a.title,
            description: a.description,
            category: a.category || 'general',
            priority: a.priority || 'medium',
            action_prompt: a.action_prompt || null,
            context_json: JSON.stringify(context.stats),
          });
        }
      });
    } catch (err) {
      console.error(`[OvernightAnalysis] Error for ${tenant.id}:`, err.message);
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export function startOvernightAnalysisJob({ runAtHour = 3, intervalHours = 24 } = {}) {
  if (timer) {
    console.log('[OvernightAnalysis] Already running');
    return;
  }

  const intervalMs = intervalHours * 3600000;

  // Calculate delay until next run
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(runAtHour, 0, 0, 0);
  if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
  const delay = nextRun - now;

  console.log(`[OvernightAnalysis] Scheduled — next run at ${nextRun.toISOString()} (in ${Math.round(delay / 60000)}m)`);

  // First run at scheduled time
  setTimeout(() => {
    runOvernightAnalysis().catch(err => console.error('[OvernightAnalysis] Error:', err.message));

    // Then repeat every intervalHours
    timer = setInterval(() => {
      runOvernightAnalysis().catch(err => console.error('[OvernightAnalysis] Error:', err.message));
    }, intervalMs);
  }, delay);
}

export function stopOvernightAnalysisJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[OvernightAnalysis] Stopped');
  }
}

// Manual trigger for testing
export { runOvernightAnalysis };
