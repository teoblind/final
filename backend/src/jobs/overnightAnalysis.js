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
  insertAgentAssignment, clearOldAssignments, trimProposedAssignments,
  getAgentAssignments, getUsersByTenant,
} from '../cache/database.js';

let timer = null;

// ─── Context Gathering ───────────────────────────────────────────────────────

/** Clean up GC name — replace email addresses or coppice.ai placeholders with from_name or project-derived name */
function cleanGcName(bid) {
  const gc = bid.gc_name || '';
  // If gc_name looks like an email or contains coppice/agent, use from_name or derive from project
  if (gc.includes('@') || gc.includes('coppice') || gc.includes('agent') || gc.includes('localhost')) {
    return bid.from_name || bid.gc_company || extractGcFromSubject(bid.subject) || 'Unknown GC';
  }
  return gc;
}

function extractGcFromSubject(subject) {
  if (!subject) return null;
  // Try to extract company name from common RFQ patterns
  const match = subject.match(/(?:from|by|for)\s+([A-Z][A-Za-z\s&]+?)(?:\s*[-–—]|\s*$)/);
  return match ? match[1].trim() : null;
}

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

  // GC names we've worked with (for relationship context) — cleaned
  const gcNames = [...new Set(bids.map(b => cleanGcName(b)).filter(n => n && n !== 'Unknown GC'))];

  return {
    stats,
    bidsWithoutEstimates: bidsWithoutEstimates.map(b => ({
      id: b.id, project_name: b.project_name, gc_name: cleanGcName(b),
      due_date: b.due_date, subject: b.subject,
    })),
    draftEstimates: draftEstimates.map(e => ({
      id: e.id, project_name: e.project_name,
      gc_name: cleanGcName({ gc_name: e.gcName || e.gc_name, from_name: e.from_name, subject: e.subject }),
      totalBid: e.totalBid, bid_request_id: e.bid_request_id,
    })),
    urgentBids: urgentBids.map(b => ({
      id: b.id, project_name: b.project_name, gc_name: cleanGcName(b),
      due_date: b.due_date, status: b.status,
    })),
    pendingJobs: pendingJobs.map(j => ({
      id: j.id, project_name: j.project_name, gc_name: j.gc_name || 'Unknown GC', status: j.status,
    })),
    activeJobs: activeJobs.map(j => ({
      id: j.id, project_name: j.project_name, gc_name: j.gc_name || 'Unknown GC',
    })),
    staleEstimates: staleEstimates.map(e => ({
      id: e.id, project_name: e.project_name,
      gc_name: cleanGcName({ gc_name: e.gcName || e.gc_name, from_name: e.from_name, subject: e.subject }),
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

You have FULL ACCESS to Coppice's tool suite. Think big — you are not limited to emails. You can build anything.

CURRENT BUSINESS STATE:
${JSON.stringify(context, null, 2)}

YOUR CAPABILITIES (use all of these when proposing tasks):
- Email: draft and send follow-ups, bid submissions, GC outreach, supplier quote requests
- Excel/Spreadsheets: build cost models, bid comparison matrices, cash flow projections, pricing analysis
- Documents/PDFs: generate proposals, scope letters, project reports, compliance summaries
- Research & Analysis: web research on GCs, project pipelines, market conditions, competitor activity
- Financial Analysis: project profitability models, margin analysis, revenue forecasts, bid-to-win ratios
- Presentations: build PowerPoint/slide decks for bid presentations, project summaries, team briefings
- Data & Reporting: weekly/monthly pipeline reports, win rate dashboards, GC relationship scorecards
- Google Drive: organize bid documents, create shared folders for active projects

ASSIGNMENT CATEGORIES:
- follow_up: Email follow-ups on sent estimates or bids awaiting GC response
- estimate: Finalize draft estimates, review pricing, prepare and send bid packages
- outreach: Proactive emails to GCs about upcoming projects, relationship building
- admin: Activate awarded jobs, update statuses, generate summaries
- research: Investigate a GC, project, market trend, or competitor — produce a written report
- analysis: Financial modeling, cash flow projections, bid profitability, margin optimization
- document: Create a deliverable — Excel model, PDF report, PowerPoint deck, proposal letter

THINK LIKE A BUSINESS STRATEGIST, not just a task manager. Ask yourself:
- What intelligence would help DACP win more work?
- What financial analysis would improve their margins?
- What research on a GC or project would give DACP an edge before bidding?
- What reports would help the owner understand where the business stands?
- What proactive outreach would strengthen GC relationships?
- Are there projects in the pipeline that need deeper analysis before bidding?

Propose 3-10 specific assignments. Mix quick wins (emails, status updates) with high-value deliverables (reports, analysis, presentations).

RULES:
1. Every assignment must reference specific projects, GCs, or data from the business state — no generic tasks
2. Prioritize: urgent bid deadlines > financial analysis on active projects > stale follow-ups > research > outreach
3. High-value deliverables (Excel models, research reports, presentations) should be marked high priority when they would directly impact a bid decision or revenue
4. Each task must be completable in one agent session — the action_prompt should be detailed enough for an agent to execute it fully
5. Sign all emails as Coppice (the AI agent) — NEVER reference "David Castillo", "Marcel", or other employee names
6. If a GC name is "Unknown GC" or looks like a placeholder, focus on the PROJECT NAME instead
7. Research tasks should produce a specific deliverable (PDF report, Excel sheet, summary doc) — not just "look into it"
8. For financial analysis, specify what numbers to model and what format to deliver (Excel, PDF, etc.)
9. NEVER propose a task that duplicates an existing active/completed task listed in the business state under "existingTasks". Find different, fresh work to do.
10. PITCH DECKS (category: "pitch_deck") should be RARE — only suggest one when there is an unmistakable signal: a major new client/GC relationship to formalize, a high-value bid that needs a capabilities presentation, or an explicit mention in emails/meetings that a pitch deck is needed. Do NOT suggest pitch decks as routine tasks.

Return a JSON array. Each object:
{
  "title": "Short title (5-10 words)",
  "description": "What to do and why (1-2 sentences). Be specific about the deliverable.",
  "category": "follow_up|estimate|outreach|admin|research|analysis|document|pitch_deck",
  "priority": "high|medium|low",
  "action_prompt": "Detailed prompt for the agent to execute this task. Include what to research, what to build, what format, and where to save it.",
  "agent_id": "estimating|comms|hivemind"
}

Return ONLY the JSON array, no markdown or explanation.`;
}

async function generateAssignments(tenantId, context) {
  const { tunnelPrompt } = await import('../services/cliTunnel.js');
  const prompt = buildAnalysisPrompt(context);

  const response = await tunnelPrompt({
    tenantId,
    agentId: 'estimating',
    prompt,
    maxTurns: 30,
    timeoutMs: 600_000,
    label: 'Overnight Analysis',
  });

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

        // Trim proposed assignments to keep at most 50 (oldest get deleted)
        trimProposedAssignments(tenant.id, 50);

        // Gather context + existing tasks to avoid duplicates
        const context = gatherDacpContext(tenant.id);
        const existingAssignments = getAgentAssignments(tenant.id);
        const existingTitles = existingAssignments
          .filter(a => ['proposed', 'confirmed', 'in_progress', 'completed'].includes(a.status))
          .map(a => a.title);
        if (existingTitles.length > 0) {
          context.existingTasks = existingTitles;
        }

        // Generate assignments
        const assignments = await generateAssignments(tenant.id, context);
        console.log(`[OvernightAnalysis] Generated ${assignments.length} assignments for ${tenant.id}`);

        // Store assignments as shared (user_id = NULL) — visible to all users
        // When a user confirms a task, they claim it (user_id gets set to theirs)
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
            user_id: null,
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


// Nightly auto-run (used by scheduler)
export { runOvernightAnalysis };
