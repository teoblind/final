/**
 * Meeting Processor — Post-meeting action item extraction + personalized emails
 *
 * After MeetingBot transcribes a meeting, this service:
 * 1. Queries past meeting context (recent action items, past meetings)
 * 2. Calls Claude to extract per-person tasks from the transcript
 * 3. Sends each attendee a personalized email with summary + their tasks
 * 4. Inserts action items into the DB so they appear on the dashboard
 */

import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sendEmail } from './emailService.js';
import { insertActivity } from '../cache/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = new Database(join(__dirname, '../../data/cache.db'));

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

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `You are a meeting analyst for Sangha Systems. Analyze this meeting transcript and extract action items for each attendee.

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
- Only include actionable tasks, not observations`
    }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse Claude response as JSON');
  return JSON.parse(jsonMatch[0]);
}

/**
 * Send personalized post-meeting emails to each attendee.
 */
async function sendMeetingEmails({ meetingTitle, result, attendees }) {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const sent = [];
  const failed = [];

  for (const email of attendees) {
    // Skip coppice's own email
    if (email === 'coppice@zhan.capital' || email === 'claude@zhan.capital') continue;

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

  // 4. Send personalized emails
  const emailResult = await sendMeetingEmails({
    meetingTitle,
    result,
    attendees,
  });
  console.log(`[MeetingProcessor] Emails sent: ${emailResult.sent.length}, failed: ${emailResult.failed.length}`);

  insertActivity({
    tenantId, type: 'meet',
    title: `Transcribed: ${meetingTitle}`,
    subtitle: `${Math.round((Date.now() - new Date(entryId.split('-')[1]).getTime()) / 60000) || '?'} min — ${attendees.length} attendees — ${itemCount} action items extracted`,
    detailJson: JSON.stringify({
      summary: result.meeting_summary,
      actionItems: Object.values(result.attendee_tasks || {}).flatMap(p => (p.tasks || []).map(t => t.task)),
      attendees,
    }),
    sourceType: 'meeting', sourceId: entryId, agentId: 'knowledge',
  });

  return {
    meetingSummary: result.meeting_summary,
    attendeeTasks: result.attendee_tasks,
    actionItemsInserted: itemCount,
    emailsSent: emailResult.sent,
    emailsFailed: emailResult.failed,
  };
}
