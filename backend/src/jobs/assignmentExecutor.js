/**
 * Assignment Executor Job
 *
 * Polls for confirmed agent_assignments, executes them through the CLI tunnel
 * with knowledge context, and supports pausing for info requests from the user.
 *
 * Flow:
 *   1. tick() runs on interval, scanning all tenants for confirmed assignments
 *   2. executeAssignment() creates a background_job, gathers knowledge context,
 *      builds a prompt, and runs it via tunnelOrChat
 *   3. If the agent needs more info, it emits <!--INFO_REQUEST...-->; the job
 *      pauses and waits for a user response
 *   4. resumeAssignment() picks up paused jobs once the user responds
 */

import {
  getAllTenants,
  runWithTenant,
  getAgentAssignments,
  updateAgentAssignment,
  createBackgroundJob,
  getBackgroundJob,
  updateBackgroundJob,
  addJobMessage,
  getJobMessages,
  respondToJobMessage,
  getTenant,
  getUsersByTenant,
  insertNotification,
} from '../cache/database.js';
import { tunnelOrChat } from '../services/cliTunnel.js';
import { getThreadKnowledge, searchKnowledge } from '../services/knowledgeProcessor.js';
import { generateReport } from '../services/documentService.js';

let pollInterval = null;

// Track in-flight assignments per tenant to cap concurrency
const inFlight = new Map(); // tenantId -> Set<assignmentId>
const MAX_CONCURRENT_PER_TENANT = 2;

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function startAssignmentExecutor(intervalMs = 30000) {
  if (pollInterval) return; // already running
  console.log(`[AssignmentExecutor] Started (polling every ${intervalMs / 1000}s)`);

  // Recover orphaned in_progress tasks (from PM2 restarts killing tunnel calls)
  try {
    const tenants = getAllTenants();
    for (const tenant of tenants) {
      runWithTenant(tenant.id, () => {
        const stuck = getAgentAssignments(tenant.id, 'in_progress');
        for (const a of stuck) {
          console.log(`[AssignmentExecutor] Recovering orphaned task: ${a.title} (${a.id})`);
          updateAgentAssignment(tenant.id, a.id, { status: 'confirmed', job_id: null, result_summary: null });
        }
      });
    }
  } catch (err) {
    console.warn(`[AssignmentExecutor] Orphan recovery failed: ${err.message}`);
  }

  pollInterval = setInterval(() => tick(), intervalMs);
  // Run an initial tick after a short delay to pick up anything waiting
  setTimeout(() => tick(), 5000);
}

export function stopAssignmentExecutor() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[AssignmentExecutor] Stopped');
  }
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

async function tick() {
  let tenants;
  try {
    tenants = getAllTenants();
  } catch (err) {
    console.error('[AssignmentExecutor] Failed to get tenants:', err.message);
    return;
  }

  for (const tenant of tenants) {
    try {
      await runWithTenant(tenant.id, async () => {
        await processTenant(tenant.id);
      });
    } catch (err) {
      console.error(`[AssignmentExecutor] Error processing tenant ${tenant.id}:`, err.message);
    }
  }
}

// ─── Per-Tenant Processing ────────────────────────────────────────────────────

async function processTenant(tenantId) {
  if (!inFlight.has(tenantId)) inFlight.set(tenantId, new Set());
  const running = inFlight.get(tenantId);

  // Clean up finished assignments from the in-flight set
  for (const aId of running) {
    const assignment = getAgentAssignments(tenantId, null, null)
      .find(a => a.id === aId);
    if (!assignment || assignment.status === 'completed' || assignment.status === 'failed' || assignment.status === 'dismissed') {
      running.delete(aId);
    }
  }

  // 1. Find confirmed assignments ready to execute (no job_id yet)
  const confirmed = getAgentAssignments(tenantId, 'confirmed');
  const readyToExecute = confirmed.filter(a => !a.job_id);

  // 2. Find paused assignments with responded info requests (ready to resume)
  const inProgress = getAgentAssignments(tenantId, 'in_progress');
  const readyToResume = [];
  for (const a of inProgress) {
    if (!a.job_id) continue;
    const job = getBackgroundJob(a.job_id);
    if (!job || job.status !== 'paused') continue;
    // Check if there's a responded info request
    const messages = getJobMessages(a.job_id);
    const hasRespondedRequest = messages.some(
      m => m.message_type === 'request' && m.request_type === 'info_needed' && m.response
    );
    if (hasRespondedRequest) {
      readyToResume.push(a);
    }
  }

  // 3. Execute new assignments (respect concurrency cap)
  for (const assignment of readyToExecute) {
    if (running.size >= MAX_CONCURRENT_PER_TENANT) break;
    running.add(assignment.id);
    // Fire and forget — errors handled internally
    executeAssignment(tenantId, assignment).catch(err => {
      console.error(`[AssignmentExecutor] Unhandled error executing ${assignment.id}:`, err.message);
      running.delete(assignment.id);
    });
  }

  // 4. Resume paused assignments
  for (const assignment of readyToResume) {
    if (running.size >= MAX_CONCURRENT_PER_TENANT) break;
    if (running.has(assignment.id)) continue; // already processing
    running.add(assignment.id);
    resumeAssignment(tenantId, assignment).catch(err => {
      console.error(`[AssignmentExecutor] Unhandled error resuming ${assignment.id}:`, err.message);
      running.delete(assignment.id);
    });
  }
}

// ─── Execute Assignment ───────────────────────────────────────────────────────

async function executeAssignment(tenantId, assignment) {
  let jobId;
  try {
    // 1. Create a background job to track progress
    jobId = createBackgroundJob({
      tenantId,
      userId: 'system',
      agentId: assignment.agent_id || 'coppice',
      title: assignment.title,
      description: assignment.description,
    });

    // 2. Link the assignment to the job
    updateAgentAssignment(tenantId, assignment.id, {
      status: 'in_progress',
      job_id: jobId,
    });

    console.log(`[AssignmentExecutor] Executing "${assignment.title}" (${assignment.id}) as job ${jobId}`);

    // 3. Update job to running
    updateBackgroundJob(jobId, {
      status: 'running',
      progressPct: 10,
      progressMessage: 'Gathering context...',
    });

    // 4. Gather knowledge context
    const contextString = await gatherContext(tenantId, assignment);

    // 5. Update progress
    updateBackgroundJob(jobId, {
      progressPct: 25,
      progressMessage: 'Executing task...',
    });

    // 6. Build and execute prompt
    const prompt = buildExecutionPrompt(assignment, contextString);

    const isResearch = ['research', 'analysis', 'document'].includes(assignment.category);
    const { response } = await tunnelOrChat({
      tenantId,
      agentId: assignment.agent_id || 'coppice',
      userId: 'system',
      prompt,
      maxTurns: isResearch ? 200 : 50,
      timeoutMs: isResearch ? 1_800_000 : 600_000,
      label: `Assignment: ${assignment.title}`,
    });

    // 7. Handle the response
    await handleResponse(tenantId, assignment, jobId, response);

  } catch (err) {
    console.error(`[AssignmentExecutor] Failed to execute assignment ${assignment.id}:`, err.message);
    // Roll back to proposed so it can be retried
    try {
      updateAgentAssignment(tenantId, assignment.id, {
        status: 'proposed',
        result_summary: `Execution failed: ${err.message}`,
      });
    } catch (_) { /* best effort */ }
    if (jobId) {
      try {
        updateBackgroundJob(jobId, {
          status: 'failed',
          errorMessage: err.message,
          progressMessage: 'Failed',
        });
        addJobMessage(jobId, 'system', `Execution failed: ${err.message}`, 'error');
      } catch (_) { /* best effort */ }
    }
  } finally {
    const running = inFlight.get(tenantId);
    if (running) running.delete(assignment.id);
  }
}

// ─── Resume Assignment ────────────────────────────────────────────────────────

async function resumeAssignment(tenantId, assignment) {
  const jobId = assignment.job_id;
  try {
    const job = getBackgroundJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const messages = getJobMessages(jobId);

    // Find the most recent info request that has a response
    const respondedRequest = [...messages]
      .reverse()
      .find(m => m.message_type === 'request' && m.request_type === 'info_needed' && m.response);

    if (!respondedRequest) {
      console.warn(`[AssignmentExecutor] No responded request found for assignment ${assignment.id}`);
      return;
    }

    console.log(`[AssignmentExecutor] Resuming "${assignment.title}" (${assignment.id}) with user response`);

    // Update job back to running
    updateBackgroundJob(jobId, {
      status: 'running',
      progressPct: 55,
      progressMessage: 'Resuming with additional information...',
    });

    // Build continuation prompt
    const contextString = await gatherContext(tenantId, assignment);
    const continuationPrompt = buildContinuationPrompt(assignment, respondedRequest, contextString);

    const isResearchResume = ['research', 'analysis', 'document'].includes(assignment.category);
    const { response } = await tunnelOrChat({
      tenantId,
      agentId: assignment.agent_id || 'coppice',
      userId: 'system',
      prompt: continuationPrompt,
      maxTurns: isResearchResume ? 200 : 50,
      timeoutMs: isResearchResume ? 1_800_000 : 600_000,
      label: `Assignment (resumed): ${assignment.title}`,
    });

    // Decrement info_requests_pending
    const currentPending = assignment.info_requests_pending || 0;
    updateAgentAssignment(tenantId, assignment.id, {
      info_requests_pending: Math.max(0, currentPending - 1),
    });

    // Handle the response (may pause again or complete)
    await handleResponse(tenantId, assignment, jobId, response);

  } catch (err) {
    console.error(`[AssignmentExecutor] Failed to resume assignment ${assignment.id}:`, err.message);
    try {
      updateAgentAssignment(tenantId, assignment.id, {
        status: 'proposed',
        result_summary: `Resume failed: ${err.message}`,
      });
    } catch (_) { /* best effort */ }
    if (jobId) {
      try {
        updateBackgroundJob(jobId, {
          status: 'failed',
          errorMessage: err.message,
          progressMessage: 'Failed during resume',
        });
        addJobMessage(jobId, 'system', `Resume failed: ${err.message}`, 'error');
      } catch (_) { /* best effort */ }
    }
  } finally {
    const running = inFlight.get(tenantId);
    if (running) running.delete(assignment.id);
  }
}

// ─── Context Gathering ────────────────────────────────────────────────────────

async function gatherContext(tenantId, assignment) {
  const contextParts = [];

  // Thread knowledge (if the assignment was born from an email thread, etc.)
  if (assignment.source_thread_id) {
    try {
      const threadEntries = getThreadKnowledge(tenantId, assignment.source_thread_id);
      if (threadEntries.length > 0) {
        contextParts.push('--- Source Thread ---');
        for (const entry of threadEntries) {
          contextParts.push(`[${entry.created_at}] ${entry.title}\n${entry.summary || entry.content || ''}`);
        }
      }
    } catch (err) {
      console.warn(`[AssignmentExecutor] Failed to get thread knowledge: ${err.message}`);
    }
  }

  // Specific knowledge entries referenced by the assignment
  if (assignment.knowledge_entry_ids_json) {
    try {
      const entryIds = JSON.parse(assignment.knowledge_entry_ids_json);
      if (Array.isArray(entryIds) && entryIds.length > 0) {
        // Search for each entry by ID — searchKnowledge doesn't take IDs,
        // so we search broadly and filter
        const allKnowledge = searchKnowledge(tenantId, '', { limit: 200 });
        const matched = allKnowledge.filter(k => entryIds.includes(k.id));
        if (matched.length > 0) {
          contextParts.push('--- Referenced Knowledge ---');
          for (const entry of matched) {
            contextParts.push(`[${entry.type}] ${entry.title}\n${entry.summary || ''}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[AssignmentExecutor] Failed to parse knowledge_entry_ids: ${err.message}`);
    }
  }

  // General knowledge search based on the assignment title
  try {
    const related = searchKnowledge(tenantId, assignment.title, { limit: 10 });
    if (related.length > 0) {
      contextParts.push('--- Related Knowledge ---');
      for (const entry of related) {
        contextParts.push(`[${entry.type}] ${entry.title}: ${entry.summary || ''}`);
      }
    }
  } catch (err) {
    console.warn(`[AssignmentExecutor] Failed to search knowledge: ${err.message}`);
  }

  return contextParts.join('\n\n') || '(No additional context available)';
}

// ─── Prompt Building ──────────────────────────────────────────────────────────

function formatInputValues(assignment) {
  try {
    const fields = JSON.parse(assignment.input_fields_json || '[]');
    const values = JSON.parse(assignment.input_values_json || '{}');
    if (!fields.length || !Object.keys(values).length) return '';
    const lines = fields
      .filter(f => values[f.name] !== undefined && values[f.name] !== '' && f.type !== 'password')
      .map(f => `- ${f.label || f.name}: ${values[f.name]}`);
    // Include password fields as redacted references so agent knows they exist
    const passwordFields = fields.filter(f => f.type === 'password' && values[f.name]);
    for (const pf of passwordFields) {
      lines.push(`- ${pf.label || pf.name}: [PROVIDED — available in context]`);
    }
    if (!lines.length) return '';
    return `\n--- USER-PROVIDED INPUTS ---\nThe user provided the following inputs for this task:\n${lines.join('\n')}\n`;
  } catch {
    return '';
  }
}

function buildExecutionPrompt(assignment, contextString) {
  const taskBlock = assignment.action_prompt
    || `Execute this task: ${assignment.title}\n\n${assignment.description}`;

  const inputBlock = formatInputValues(assignment);

  return `${taskBlock}
${inputBlock}
--- CONTEXT FROM KNOWLEDGE BASE ---
${contextString}

CRITICAL - HOW TO DELIVER YOUR WORK:
Your response text IS the deliverable. The system converts your response into a professional PDF and Word document automatically. There is no other mechanism.

DO NOT create Google Docs or Google Sheets as your primary output. Do NOT use workspace_create_doc for the report. Do NOT link to external documents. Write EVERYTHING directly in your response.

CONTENT REQUIREMENTS:
- Write the COMPLETE report/analysis RIGHT HERE in your response text. Every section, every finding, every table.
- A research report should be 3-10 pages of real content: detailed findings, specific data points, analysis, recommendations.
- A scope analysis should cover every line item, risk, exclusion, and contract term in detail.
- Use markdown headers (##), bullet points, tables, and bold text for structure. This formatting translates directly to the PDF.
- Include specific numbers, dollar figures, dates, and references — not vague statements.
- Do NOT write "here's a summary" or "the document covers..." — write the actual content itself.
- Do NOT write a brief overview and link to a Google Doc. That defeats the purpose. The full content must be in your response.

At the END of your response, include a JSON block: <!--ARTIFACTS[...]ARTIFACTS-->

IMPORTANT - EMAIL POLICY:
Do NOT send any emails directly. Do NOT call send_email. Instead, if you want to notify the user or send outreach emails, draft the email and output it EXACTLY like this:
<!--EMAIL_DRAFT{"to":"recipient@example.com","subject":"Subject line","body":"Full email body in HTML"}EMAIL_DRAFT-->
The user will review and approve the email before it is sent. You may include multiple EMAIL_DRAFT tags if multiple emails need to be sent.

IMPORTANT - TOOL FAILURES:
If a tool fails (Google Drive upload, sheet creation, etc.), DO NOT spend your session debugging the tool. Focus on producing the written deliverable in your response text. The system will automatically generate PDF/DOC from your written output. Your primary job is to produce high-quality content, not to troubleshoot infrastructure.

IMPORTANT - IF YOU NEED MORE INFORMATION:
If you cannot complete this task because you are missing critical information (e.g., meeting notes, a document, specific data), output EXACTLY this tag:
<!--INFO_REQUEST{"description":"What you need","detail":"Why you need it and what to paste/upload"}INFO_REQUEST-->
Do NOT guess or fabricate. Request the information and stop.`;
}

function buildContinuationPrompt(assignment, respondedRequest, contextString) {
  const taskBlock = assignment.action_prompt
    || `Execute this task: ${assignment.title}\n\n${assignment.description}`;

  const inputBlock = formatInputValues(assignment);

  return `${taskBlock}
${inputBlock}
--- CONTEXT FROM KNOWLEDGE BASE ---
${contextString}

--- PREVIOUS INFO REQUEST ---
You previously asked: ${respondedRequest.content}
The user responded: ${respondedRequest.response}

Continue executing the task with this additional information.

CRITICAL - HOW TO DELIVER YOUR WORK:
Your response text IS the deliverable. The system converts it into PDF and Word automatically. Do NOT create Google Docs. Write EVERYTHING here.
- Write the COMPLETE report — every section, every finding, every table. 3-10 pages of real content.
- Use markdown headers (##), bullet points, tables, and bold text.
- Do NOT summarize or link to external docs. Write the actual content in full.
At the END of your response, include a JSON block: <!--ARTIFACTS[...]ARTIFACTS-->

IMPORTANT - EMAIL POLICY:
Do NOT send any emails directly. Do NOT call send_email. Instead, draft emails as:
<!--EMAIL_DRAFT{"to":"recipient@example.com","subject":"Subject line","body":"Full email body in HTML"}EMAIL_DRAFT-->

IMPORTANT - IF YOU NEED MORE INFORMATION:
If you still cannot complete this task, output EXACTLY this tag:
<!--INFO_REQUEST{"description":"What you need","detail":"Why you need it and what to paste/upload"}INFO_REQUEST-->
Do NOT guess or fabricate. Request the information and stop.`;
}

// ─── Response Handling ────────────────────────────────────────────────────────

async function handleResponse(tenantId, assignment, jobId, response) {
  // Check for info request
  const infoMatch = response.match(/<!--INFO_REQUEST(\{[\s\S]*?\})INFO_REQUEST-->/);
  if (infoMatch) {
    try {
      const infoRequest = JSON.parse(infoMatch[1]);
      const description = infoRequest.description || 'Additional information needed';
      const detail = infoRequest.detail || '';

      addJobMessage(jobId, 'agent', `${description}\n\n${detail}`, 'request', 'info_needed');
      updateBackgroundJob(jobId, {
        status: 'paused',
        progressPct: 50,
        progressMessage: 'Waiting for information...',
      });

      const currentPending = assignment.info_requests_pending || 0;
      updateAgentAssignment(tenantId, assignment.id, {
        info_requests_pending: currentPending + 1,
      });

      console.log(`[AssignmentExecutor] Assignment ${assignment.id} paused — awaiting info: ${description}`);
      return; // Don't complete
    } catch (parseErr) {
      console.warn(`[AssignmentExecutor] Failed to parse INFO_REQUEST: ${parseErr.message}`);
      // Fall through and treat as completed
    }
  }

  // Extract artifacts if present
  let artifacts = null;
  const artifactsMatch = response.match(/<!--ARTIFACTS(\[[\s\S]*?\])ARTIFACTS-->/);
  if (artifactsMatch) {
    try {
      artifacts = JSON.parse(artifactsMatch[1]);
    } catch (parseErr) {
      console.warn(`[AssignmentExecutor] Failed to parse ARTIFACTS: ${parseErr.message}`);
    }
  }

  // Extract email drafts before cleaning
  const emailDrafts = [];
  const emailDraftRegex = /<!--EMAIL_DRAFT(\{[\s\S]*?\})EMAIL_DRAFT-->/g;
  let emailMatch;
  while ((emailMatch = emailDraftRegex.exec(response)) !== null) {
    try {
      const draft = JSON.parse(emailMatch[1]);
      if (draft.to && draft.subject && draft.body) {
        emailDrafts.push(draft);
      }
    } catch (parseErr) {
      console.warn(`[AssignmentExecutor] Failed to parse EMAIL_DRAFT: ${parseErr.message}`);
    }
  }
  if (emailDrafts.length > 0) {
    console.log(`[AssignmentExecutor] Captured ${emailDrafts.length} email draft(s) for user approval`);
  }

  // Clean response — strip special tags and conversational preamble
  const cleanResponse = response
    .replace(/<!--INFO_REQUEST\{[\s\S]*?\}INFO_REQUEST-->/g, '')
    .replace(/<!--ARTIFACTS\[[\s\S]*?\]ARTIFACTS-->/g, '')
    .replace(/<!--EMAIL_DRAFT\{[\s\S]*?\}EMAIL_DRAFT-->/g, '')
    // Strip conversational preamble that agents add before the actual content
    .replace(/^(Done\.?|Complete\.?|Finished\.?|Here['']s|I['']ve|The document|The report|The analysis)[^\n]*\n+/i, '')
    .replace(/^(Created|Generated|Produced|Uploaded)[^\n]*\n+/i, '')
    .trim();

  // Generate formatted documents for research/analysis/document tasks
  // Skip doc generation if the response looks like debug/error output rather than actual content
  const docCategories = ['research', 'analysis', 'document'];
  const looksLikeContent = cleanResponse.length > 500
    && !cleanResponse.startsWith('Memory updated')
    && !/^(Error|Failed|Could not|Unable to|I was unable|I couldn't)/i.test(cleanResponse.trim())
    && (cleanResponse.includes('#') || cleanResponse.includes('**') || cleanResponse.length > 1000);
  if (docCategories.includes(assignment.category) && looksLikeContent) {
    try {
      updateBackgroundJob(jobId, { progressPct: 85, progressMessage: 'Generating documents...' });

      const tenant = getTenant(tenantId);
      const users = getUsersByTenant(tenantId);
      const assignedUser = assignment.user_id ? users.find(u => u.id === assignment.user_id) : null;
      const userEmail = assignedUser?.email && !assignedUser.email.includes('localhost') ? assignedUser.email : null;

      // Determine agent display name — use DACP Agent unless it's specifically the estimating agent on an estimating task
      const agentId = assignment.agent_id || 'coppice';
      const isEstimatingTask = agentId === 'estimating' && ['estimate', 'outreach'].includes(assignment.category);
      const agentLabel = isEstimatingTask
        ? `${tenant?.name || 'DACP'} Estimating Agent`
        : `${tenant?.name || 'DACP'} Agent`;

      const report = await generateReport({
        title: assignment.title,
        content: cleanResponse,
        tenantName: tenant?.name || tenantId,
        agentName: agentLabel,
        agentLabel,
        userEmail,
        assignmentId: assignment.id,
        tenantId,
      });

      // Merge generated artifacts with any agent-emitted artifacts
      // Deduplicate: skip agent artifacts that overlap with generated ones (e.g. agent emitted a "document" type pointing to same Google Doc URL)
      const generatedUrls = new Set(report.artifacts.filter(a => a.url).map(a => a.url));
      const generatedTypes = new Set(report.artifacts.map(a => a.type));
      const dedupedAgentArtifacts = (artifacts || []).filter(a => {
        if (a.url && generatedUrls.has(a.url)) return false;
        // Skip agent pdf/docx if we generated our own (but keep gdoc — agent may have created one when documentService couldn't upload)
        if (['pdf', 'docx'].includes(a.type) && generatedTypes.has(a.type)) return false;
        // Only skip agent gdoc/document if we actually generated a gdoc
        if (a.type === 'gdoc' && generatedTypes.has('gdoc')) return false;
        if (a.type === 'document' && a.url && a.url.includes('docs.google.com') && generatedTypes.has('gdoc')) return false;
        // Normalize "document" type with Google Docs URL to "gdoc" so frontend renders it correctly
        if (a.type === 'document' && a.url && (a.url.includes('docs.google.com') || a.url.includes('drive.google.com'))) {
          a.type = 'gdoc';
          a.label = 'Google Docs';
        }
        return true;
      });
      artifacts = [...dedupedAgentArtifacts, ...report.artifacts];

      console.log(`[AssignmentExecutor] Generated documents for ${assignment.id}: DOCX=${!!report.docxPath} PDF=${!!report.pdfPath} GDoc=${!!report.gdocUrl}`);
    } catch (docErr) {
      console.error(`[AssignmentExecutor] Document generation failed for ${assignment.id}: ${docErr.message}`);
      // Continue — don't fail the task over doc generation
    }
  }

  // Add email drafts as pending artifacts
  for (let i = 0; i < emailDrafts.length; i++) {
    const draft = emailDrafts[i];
    if (!artifacts) artifacts = [];
    artifacts.push({
      type: 'email_draft',
      status: 'pending_approval',
      label: `Email to ${draft.to}: ${draft.subject}`,
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      index: i,
    });
  }

  // Complete the assignment — save full response for document regeneration
  updateAgentAssignment(tenantId, assignment.id, {
    status: 'completed',
    result_summary: cleanResponse.slice(0, 4000),
    full_response: cleanResponse,
    completed_at: new Date().toISOString(),
    output_artifacts_json: artifacts ? JSON.stringify(artifacts) : null,
  });

  updateBackgroundJob(jobId, {
    status: 'completed',
    progressPct: 100,
    progressMessage: 'Complete',
  });

  addJobMessage(jobId, 'agent', 'Task completed successfully.', 'info');

  // Send notification
  try {
    const hasArtifacts = artifacts && artifacts.length > 0;
    const docArtifact = hasArtifacts ? artifacts.find(a => a.type === 'gdoc' || a.type === 'pdf' || a.type === 'docx') : null;
    insertNotification(
      assignment.agent_id || 'coppice',
      'task_complete',
      `Report ready: ${assignment.title}`,
      cleanResponse.slice(0, 200),
      docArtifact?.url || docArtifact?.path || null,
    );
  } catch (notifErr) {
    console.warn(`[AssignmentExecutor] Notification failed: ${notifErr.message}`);
  }

  console.log(`[AssignmentExecutor] Assignment ${assignment.id} completed`);
}
