/**
 * Meeting Processor — Post-meeting action item extraction + instruction execution
 *
 * After MeetingBot transcribes a meeting, this service:
 * 1. Queries past meeting context (recent action items, past meetings)
 * 2. Calls Claude to extract per-person tasks from the transcript
 * 3. Inserts action items into the DB so they appear on the dashboard
 * 4. Extracts agent-directed instructions from the transcript and executes
 *    them via the tenant's agent (email, Drive, docs, etc.)
 */

import Anthropic from '@anthropic-ai/sdk';
import { tunnelPrompt, tunnelOrChat } from './cliTunnel.js';
import { sendEmail } from './emailService.js';
import { insertActivity, getCurrentTenantId, getTenantDb, getTenantEmailConfig, getAgentMode } from '../cache/database.js';

// Lazy DB accessor — resolves to the current tenant's DB via AsyncLocalStorage context
const db = new Proxy({}, {
  get(target, prop) {
    const tenantId = getCurrentTenantId() || 'default';
    const realDb = getTenantDb(tenantId);
    const val = realDb[prop];
    if (typeof val === 'function') return val.bind(realDb);
    return val;
  },
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Get recent meeting summaries + open action items for context.
 */
function getPastContext(tenantId) {
  const recentMeetings = db.prepare(`
    SELECT title, summary, recorded_at
    FROM knowledge_entries
    WHERE tenant_id = ? AND type = 'meeting' AND processed = 1
    ORDER BY recorded_at DESC
    LIMIT 5
  `).all(tenantId);

  const openItems = db.prepare(`
    SELECT ai.title, ai.assignee, ai.due_date, ai.status, ke.title as source_title
    FROM action_items ai
    LEFT JOIN knowledge_entries ke ON ai.entry_id = ke.id
    WHERE ai.tenant_id = ? AND ai.status = 'open'
    ORDER BY ai.created_at DESC
    LIMIT 30
  `).all(tenantId);

  return { recentMeetings, openItems };
}

/**
 * Use Claude to extract per-person action items from a meeting transcript,
 * considering past meeting context.
 */
async function extractPersonTasks({ transcript, summary, meetingTitle, attendees, pastContext }) {
  const pastMeetingSummaries = pastContext.recentMeetings
    .map(m => `- ${m.title} (${m.recorded_at}): ${m.summary || 'No summary'}`)
    .join('\n') || 'None';

  const openActionItems = pastContext.openItems
    .map(i => `- [${i.assignee || 'Unassigned'}] ${i.title} (from: ${i.source_title || 'unknown'})`)
    .join('\n') || 'None';

  const attendeeList = attendees.join(', ');

  const prompt = `You are a meeting analyst for Sangha Systems. Analyze this meeting transcript and extract action items for each attendee.

MEETING: ${meetingTitle}
ATTENDEES: ${attendeeList}

RECENT PAST MEETINGS:
${pastMeetingSummaries}

CURRENTLY OPEN ACTION ITEMS (from past meetings):
${openActionItems}

MEETING SUMMARY:
${summary}

FULL TRANSCRIPT:
${transcript}

Extract action items for each attendee. Consider:
- New tasks explicitly assigned during this meeting
- Follow-ups on past action items discussed
- Commitments each person made
- Deadlines mentioned

Output JSON only:
{
  "meeting_summary": "2-3 sentence summary of the meeting",
  "attendee_tasks": {
    "email@example.com": {
      "name": "First Last",
      "tasks": [
        { "task": "Description of task", "due_date": "YYYY-MM-DD or null", "priority": "high|medium|low" }
      ]
    }
  }
}

Rules:
- Use the email addresses provided in ATTENDEES as keys
- If you can identify a person's name from the transcript, include it
- If an attendee has no tasks, include them with an empty tasks array
- Be specific — "Follow up with vendor" is too vague, "Send updated pricing proposal to Riot Platforms by Friday" is good
- Only include actionable tasks, not observations`;

  const text = await tunnelPrompt({
    tenantId: getCurrentTenantId() || 'default',
    agentId: 'knowledge',
    prompt,
    maxTurns: 3,
    timeoutMs: 120_000,
    label: 'Meeting Task Extraction',
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse Claude response as JSON');
  return JSON.parse(jsonMatch[0]);
}

/**
 * Send personalized post-meeting emails to each attendee.
 */
async function sendMeetingEmails({ meetingTitle, result, attendees, tenantId }) {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // Build skip list: all known agent/coppice emails + this tenant's agent email
  const skipEmails = new Set([
    'agent@zhan.coppice.ai',
    'coppice@zhan.capital',
    'claude@zhan.capital',
  ]);
  try {
    const tenantConfig = getTenantEmailConfig(tenantId);
    if (tenantConfig?.senderEmail) skipEmails.add(tenantConfig.senderEmail.toLowerCase());
  } catch {}

  const sent = [];
  const failed = [];

  for (const email of attendees) {
    // Skip agent's own email addresses
    if (skipEmails.has(email.toLowerCase())) continue;
    if (email.toLowerCase().match(/^agent@.*\.coppice\.ai$/)) continue;

    const personData = result.attendee_tasks?.[email];
    const name = personData?.name || email.split('@')[0];
    const tasks = personData?.tasks || [];

    let taskSection;
    if (tasks.length === 0) {
      taskSection = 'No specific action items were assigned to you from this meeting.';
    } else {
      taskSection = tasks.map((t, i) => {
        let line = `${i + 1}. ${t.task}`;
        if (t.due_date) line += ` (due: ${t.due_date})`;
        if (t.priority === 'high') line += ' [HIGH PRIORITY]';
        return line;
      }).join('\n');
    }

    const body = `Hey ${name.split(' ')[0]},

Here's a summary of today's meeting and your action items.

Meeting: ${meetingTitle}
Date: ${dateStr}

Summary:
${result.meeting_summary}

Your Action Items:
${taskSection}

These tasks have been added to your Coppice dashboard. Let me know if anything needs adjusting.

— Coppice`;

    try {
      await sendEmail({
        to: email,
        subject: `Meeting Summary: ${meetingTitle} — Your Action Items`,
        body,
        tenantId,
      });
      sent.push(email);
    } catch (err) {
      console.error(`Failed to send meeting email to ${email}:`, err.message);
      failed.push({ email, error: err.message });
    }
  }

  return { sent, failed };
}

/**
 * Insert extracted action items into the database.
 */
function insertActionItems({ tenantId, entryId, result }) {
  const insertStmt = db.prepare(
    'INSERT INTO action_items (id, tenant_id, entry_id, title, assignee, due_date) VALUES (?, ?, ?, ?, ?, ?)'
  );

  let count = 0;
  for (const [email, personData] of Object.entries(result.attendee_tasks || {})) {
    const name = personData.name || email;
    for (const task of personData.tasks || []) {
      insertStmt.run(
        `AI-${uid()}`, tenantId, entryId,
        task.task, name, task.due_date || null,
      );
      count++;
    }
  }
  return count;
}

/**
 * Full post-meeting pipeline:
 * 1. Get past context
 * 2. Extract per-person tasks via Claude
 * 3. Insert action items into DB
 * 4. Send personalized emails
 */
export async function processMeetingComplete({
  tenantId,
  entryId,
  meetingTitle,
  transcript,
  summary,
  attendees,
}) {
  console.log(`[MeetingProcessor] Processing meeting: ${meetingTitle}`);
  console.log(`[MeetingProcessor] Attendees: ${attendees.join(', ')}`);

  // 1. Get past context
  const pastContext = getPastContext(tenantId);
  console.log(`[MeetingProcessor] Past context: ${pastContext.recentMeetings.length} meetings, ${pastContext.openItems.length} open items`);

  // 2. Extract per-person tasks
  const result = await extractPersonTasks({
    transcript,
    summary,
    meetingTitle,
    attendees,
    pastContext,
  });
  console.log(`[MeetingProcessor] Extracted tasks for ${Object.keys(result.attendee_tasks || {}).length} attendees`);

  // 3. Insert action items into DB
  const itemCount = insertActionItems({ tenantId, entryId, result });
  console.log(`[MeetingProcessor] Inserted ${itemCount} action items`);

  // 4. Extract and execute agent-directed instructions from the transcript
  let instructionsExecuted = 0;
  try {
    instructionsExecuted = await executeAgentInstructions({
      tenantId,
      meetingTitle,
      transcript,
      summary: result.meeting_summary || summary,
      attendees,
    });
  } catch (err) {
    console.error(`[MeetingProcessor] Instruction execution failed:`, err.message);
  }

  insertActivity({
    tenantId, type: 'meet',
    title: `Transcribed: ${meetingTitle}`,
    subtitle: `${attendees.length} attendees — ${itemCount} action items — ${instructionsExecuted} instructions executed`,
    detailJson: JSON.stringify({
      summary: result.meeting_summary,
      actionItems: Object.values(result.attendee_tasks || {}).flatMap(p => (p.tasks || []).map(t => t.task)),
      attendees,
      instructionsExecuted,
    }),
    sourceType: 'meeting', sourceId: entryId, agentId: 'knowledge',
  });

  return {
    meetingSummary: result.meeting_summary,
    attendeeTasks: result.attendee_tasks,
    actionItemsInserted: itemCount,
    instructionsExecuted,
  };
}

// ─── Agent-Directed Instruction Execution ────────────────────────────────────

// Map tenant IDs to the agent that should handle instructions
const TENANT_AGENT_MAP = {
  'default': 'sangha',
  'dacp-construction-001': 'hivemind',
  'zhan-capital': 'zhan',
};

/**
 * Extract agent-directed instructions from the meeting transcript
 * and execute them via the tenant's chat agent (which has all tools).
 *
 * Examples of instructions:
 * - "Agent, send Spencer the updated pipeline report"
 * - "Coppice, update the shared folder with these notes"
 * - "Can you email the estimate to the client?"
 * - "Put together a summary doc and share it with the team"
 */
async function executeAgentInstructions({ tenantId, meetingTitle, transcript, summary, attendees }) {
  // 1. Ask Claude to extract agent-directed instructions
  const instructions = await extractInstructions({ meetingTitle, transcript, summary, attendees });

  if (!instructions || instructions.length === 0) {
    console.log(`[MeetingProcessor] No agent instructions found in transcript`);
    return 0;
  }

  console.log(`[MeetingProcessor] Found ${instructions.length} agent instruction(s) to execute`);

  // 2. Check agent mode — copilot creates approval items, autonomous executes directly
  const agentId = TENANT_AGENT_MAP[tenantId] || 'sangha';
  const agentMode = getAgentMode(agentId);

  if (agentMode === 'off') {
    console.log(`[MeetingProcessor] Agent "${agentId}" is off — skipping instruction execution`);
    return 0;
  }

  if (agentMode === 'copilot') {
    // Create approval items for each instruction instead of executing
    for (const instruction of instructions) {
      db.prepare(`
        INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
        VALUES (?, ?, ?, ?, 'meeting_instruction', ?, 'pending')
      `).run(
        tenantId, agentId,
        `Meeting instruction: ${instruction.task.slice(0, 80)}`,
        `From "${meetingTitle}" — requested by ${instruction.requestedBy || 'participant'}. Approve to execute.`,
        JSON.stringify({
          instruction, meetingTitle, summary, attendees,
          tenantId, agentId, userId: 'meeting-bot',
        }),
      );
    }
    console.log(`[MeetingProcessor] Copilot mode — created ${instructions.length} approval item(s)`);
    insertActivity({
      tenantId, type: 'alert',
      title: `${instructions.length} meeting instruction(s) awaiting approval`,
      subtitle: `From "${meetingTitle}" — review in Approvals queue`,
      detailJson: JSON.stringify({ instructions, meetingTitle }),
      sourceType: 'meeting', agentId: 'meetings',
    });
    return instructions.length;
  }

  // Autonomous mode — execute directly via CLI tunnel (with chat() fallback for tool use)
  let executed = 0;

  for (const instruction of instructions) {
    try {
      console.log(`[MeetingProcessor] Executing: "${instruction.task}"`);

      // Build a prompt that gives the agent context + the specific instruction
      const prompt = `You are processing a post-meeting instruction. During the meeting "${meetingTitle}", someone directed you to do the following:

INSTRUCTION: ${instruction.task}
CONTEXT: ${instruction.context || ''}
REQUESTED BY: ${instruction.requestedBy || 'a meeting participant'}
MEETING ATTENDEES: ${attendees.join(', ')}

MEETING SUMMARY:
${summary}

Execute this instruction now. If it involves sending an email, creating a document, updating a file, or any other action — do it using your available tools. Be concise and professional. If you cannot complete the instruction (missing information, ambiguous request), log what you attempted and what's needed.`;

      const result = await tunnelOrChat({
        tenantId, agentId, userId: 'meeting-bot', prompt,
        maxTurns: 10, timeoutMs: 180_000,
        label: `Meeting Instruction: ${instruction.task.slice(0, 40)}`,
      });

      insertActivity({
        tenantId,
        type: 'out',
        title: `Meeting instruction executed: ${instruction.task.slice(0, 80)}`,
        subtitle: `From "${meetingTitle}" — requested by ${instruction.requestedBy || 'participant'}`,
        detailJson: JSON.stringify({
          instruction,
          agentResponse: result.response?.slice(0, 2000),
          meetingTitle,
        }),
        sourceType: 'meeting',
        agentId: 'meetings',
      });

      executed++;
      console.log(`[MeetingProcessor] ✓ Instruction executed: "${instruction.task.slice(0, 60)}"`);
    } catch (err) {
      console.error(`[MeetingProcessor] Instruction failed: "${instruction.task}" — ${err.message}`);
      insertActivity({
        tenantId,
        type: 'alert',
        title: `Meeting instruction failed: ${instruction.task.slice(0, 80)}`,
        subtitle: err.message,
        detailJson: JSON.stringify({ instruction, error: err.message, meetingTitle }),
        sourceType: 'meeting',
        agentId: 'meetings',
      });
    }
  }

  return executed;
}

/**
 * Use Claude to identify instructions directed at the agent from the transcript.
 * Returns an array of { task, context, requestedBy }.
 */
async function extractInstructions({ meetingTitle, transcript, summary, attendees }) {
  const prompt = `Analyze this meeting transcript and identify any instructions or requests directed at the AI agent/bot (referred to as "agent", "Coppice", "Sangha Agent", "bot", or similar).

MEETING: ${meetingTitle}
ATTENDEES: ${attendees.join(', ')}

SUMMARY:
${summary}

TRANSCRIPT:
${transcript.slice(0, 15000)}

Extract ONLY explicit instructions where someone asked the agent to DO something. Examples:
- "Agent, send the report to Spencer"
- "Coppice, can you draft an email to the client?"
- "Update the shared folder with the meeting notes"
- "Put together a proposal and share it"
- "Send everyone a follow-up with the action items"

Do NOT include:
- General discussion or opinions
- Human-to-human task assignments (those are action items, not agent instructions)
- Vague mentions like "the AI could help with..."

Output JSON only. If no agent instructions found, return empty array:
{
  "instructions": [
    {
      "task": "Clear description of what the agent should do",
      "context": "Brief context from the conversation around this instruction",
      "requestedBy": "Name or email of person who gave the instruction"
    }
  ]
}`;

  const text = await tunnelPrompt({
    tenantId: getCurrentTenantId() || 'default',
    agentId: 'knowledge',
    prompt,
    maxTurns: 3,
    timeoutMs: 60_000,
    label: 'Meeting Instruction Extraction',
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.instructions || [];
  } catch {
    return [];
  }
}
