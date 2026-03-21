/**
 * Meeting Room Service — Multi-agent live meeting rooms
 *
 * Creates Google Meet → Recall.ai bot joins → transcript fans out to multiple agents
 * Each agent processes transcript in real-time and can respond to user queries.
 *
 * RULES:
 * - Agents respond SEQUENTIALLY — never in parallel. One speaks at a time.
 * - The Hivemind (chat) agent orchestrates: it speaks first, can ask other agents
 *   questions via tool use, then summarizes.
 * - Other agents only speak when asked by Hivemind or directly by the user.
 */

import { EventEmitter } from 'events';
import Anthropic from '@anthropic-ai/sdk';

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

// Active meeting rooms: meetingId -> room state
const meetingRooms = new Map();
// Bot ID -> meeting ID mapping for webhook routing
const botToMeeting = new Map();
// Speaking lock per meeting — prevents agents from talking over each other
const speakingLock = new Map();

let _anthropic;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

/**
 * Acquire the speaking lock for a meeting room.
 * Returns a release function. Waits if another agent is speaking.
 */
async function acquireSpeakingLock(meetingId) {
  while (speakingLock.get(meetingId)) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  speakingLock.set(meetingId, true);
  return () => speakingLock.set(meetingId, false);
}

/**
 * Create a new meeting room.
 */
export function createMeetingRoom(meetingId, { botId, meetLink, tenantId, agents, title }) {
  const room = {
    id: meetingId,
    botId,
    meetLink,
    tenantId,
    title: title || 'Team Meeting',
    agents: agents || [],
    transcript: [],
    agentResponses: [],
    status: 'waiting',
    startedAt: new Date().toISOString(),
    endedAt: null,
  };

  meetingRooms.set(meetingId, room);
  botToMeeting.set(botId, meetingId);
  speakingLock.set(meetingId, false);
  console.log(`[MeetingRoom] Created room ${meetingId} with ${agents.length} agents, bot ${botId}`);
  return room;
}

export function getMeetingRoom(meetingId) {
  return meetingRooms.get(meetingId) || null;
}

export function getMeetingRoomByBot(botId) {
  const meetingId = botToMeeting.get(botId);
  return meetingId ? meetingRooms.get(meetingId) : null;
}

export function addTranscript(meetingId, segment) {
  const room = meetingRooms.get(meetingId);
  if (!room) return;

  if (room.status === 'waiting') room.status = 'active';

  room.transcript.push(segment);

  emitter.emit(`transcript:${meetingId}`, {
    type: 'transcript',
    speaker: segment.speaker,
    text: segment.text,
    timestamp: segment.timestamp,
  });
}

export function addAgentResponse(meetingId, response) {
  const room = meetingRooms.get(meetingId);
  if (!room) return;

  room.agentResponses.push(response);

  emitter.emit(`transcript:${meetingId}`, {
    type: 'agent_response',
    agentId: response.agentId,
    agentName: response.agentName,
    agentRole: response.agentRole,
    text: response.text,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Ask a single agent a question (internal — used by Hivemind tool use).
 * Acquires speaking lock so only one agent speaks at a time.
 */
async function askSingleAgent(meetingId, agent, question, transcriptText) {
  const release = await acquireSpeakingLock(meetingId);
  try {
    const systemPrompt = `${agent.systemPrompt}

You are in a live meeting. Here is the transcript so far:

--- TRANSCRIPT ---
${transcriptText || '(No transcript yet)'}
--- END TRANSCRIPT ---

Answer concisely based on the transcript and your expertise. Keep responses short and focused — this is a live meeting, not a report.`;

    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: question }],
    });

    const text = msg.content?.[0]?.text || '';
    const response = {
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      text,
      question,
      timestamp: new Date().toISOString(),
    };

    addAgentResponse(meetingId, response);
    return response;
  } finally {
    release();
  }
}

/**
 * Hivemind orchestrates the meeting response.
 *
 * Flow:
 * 1. Hivemind receives the question + transcript
 * 2. Hivemind can use `ask_agent` tool to consult Workflow or Research agents
 * 3. Hivemind synthesizes and gives final answer
 * 4. All responses are sequential — one at a time
 */
export async function askAgents(meetingId, question) {
  const room = meetingRooms.get(meetingId);
  if (!room) throw new Error('Meeting room not found');

  const transcriptText = room.transcript
    .map(s => `[${s.speaker}]: ${s.text}`)
    .join('\n');

  // Find the Hivemind (chat) agent — it orchestrates
  const hivemind = room.agents.find(a => a.role === 'chat');
  const otherAgents = room.agents.filter(a => a.role !== 'chat');

  if (!hivemind) {
    // No hivemind — just ask agents sequentially
    const responses = [];
    for (const agent of room.agents) {
      const resp = await askSingleAgent(meetingId, agent, question, transcriptText);
      responses.push(resp);
    }
    return responses;
  }

  // Build the ask_agent tool for Hivemind
  const agentToolDef = {
    name: 'ask_agent',
    description: `Ask another agent a question. Available agents: ${otherAgents.map(a => `"${a.role}" (${a.name})`).join(', ')}. Use this when the question requires domain expertise from a specific agent. You can call this multiple times to consult different agents.`,
    input_schema: {
      type: 'object',
      properties: {
        agent_role: {
          type: 'string',
          enum: otherAgents.map(a => a.role),
          description: 'The role of the agent to ask',
        },
        question: {
          type: 'string',
          description: 'The question to ask the agent',
        },
      },
      required: ['agent_role', 'question'],
    },
  };

  const hivemindSystem = `${hivemind.systemPrompt}

You are the lead agent in a live meeting. You ORCHESTRATE responses — you speak first, and you can consult other agents using the ask_agent tool when their expertise is needed.

STRICT RULES:
- NEVER have multiple agents respond to the same question unless each adds unique value.
- Only use ask_agent when the question genuinely requires another agent's domain expertise.
- For general questions, answer yourself without consulting others.
- Keep all responses concise — this is a live meeting.
- After consulting other agents, synthesize their input into your final answer. Don't just repeat what they said.

Available agents you can consult:
${otherAgents.map(a => `- "${a.role}": ${a.systemPrompt.split('.')[0]}.`).join('\n')}

Here is the meeting transcript so far:

--- TRANSCRIPT ---
${transcriptText || '(No transcript yet)'}
--- END TRANSCRIPT ---`;

  const release = await acquireSpeakingLock(meetingId);

  try {
    const anthropic = getAnthropic();
    const messages = [{ role: 'user', content: question }];
    const allResponses = [];

    // Agentic loop — Hivemind may call ask_agent multiple times
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: hivemindSystem,
        tools: [agentToolDef],
        messages,
      });

      // Process response blocks
      const toolUses = [];
      let finalText = '';

      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          finalText += block.text;
        } else if (block.type === 'tool_use') {
          toolUses.push(block);
        }
      }

      // If there's text output, broadcast Hivemind's response
      if (finalText.trim()) {
        const hivemindResponse = {
          agentId: hivemind.id,
          agentName: hivemind.name,
          agentRole: hivemind.role,
          text: finalText.trim(),
          question,
          timestamp: new Date().toISOString(),
        };
        addAgentResponse(meetingId, hivemindResponse);
        allResponses.push(hivemindResponse);
      }

      // If no tool calls, we're done
      if (toolUses.length === 0 || msg.stop_reason === 'end_turn') {
        break;
      }

      // Process tool calls sequentially
      const toolResults = [];
      for (const toolUse of toolUses) {
        if (toolUse.name === 'ask_agent') {
          const { agent_role, question: agentQuestion } = toolUse.input;
          const targetAgent = otherAgents.find(a => a.role === agent_role);

          if (targetAgent) {
            // Release lock temporarily so the sub-agent can speak
            release();

            const subResponse = await askSingleAgent(
              meetingId, targetAgent, agentQuestion, transcriptText
            );
            allResponses.push(subResponse);

            // Re-acquire lock for Hivemind's synthesis
            await acquireSpeakingLock(meetingId);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: subResponse.text,
            });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Agent with role "${agent_role}" not found.`,
              is_error: true,
            });
          }
        }
      }

      // Add assistant message and tool results for next iteration
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: toolResults });
    }

    return allResponses;
  } finally {
    // Ensure lock is released even on error
    speakingLock.set(meetingId, false);
  }
}

export function endMeetingRoom(meetingId) {
  const room = meetingRooms.get(meetingId);
  if (!room) return null;

  room.status = 'ended';
  room.endedAt = new Date().toISOString();

  emitter.emit(`transcript:${meetingId}`, { type: 'meeting_ended' });

  botToMeeting.delete(room.botId);
  speakingLock.delete(meetingId);

  console.log(`[MeetingRoom] Room ${meetingId} ended, ${room.transcript.length} transcript segments`);
  return room;
}

export function getFormattedTranscript(meetingId) {
  const room = meetingRooms.get(meetingId);
  if (!room) return '';

  return room.transcript
    .map(s => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
    .join('\n');
}

export function subscribe(meetingId, callback) {
  const eventName = `transcript:${meetingId}`;
  emitter.on(eventName, callback);
  return () => emitter.off(eventName, callback);
}

export function listMeetingRooms() {
  return Array.from(meetingRooms.values())
    .filter(r => r.status !== 'ended')
    .map(r => ({
      id: r.id,
      title: r.title,
      meetLink: r.meetLink,
      status: r.status,
      agentCount: r.agents.length,
      transcriptLength: r.transcript.length,
      startedAt: r.startedAt,
    }));
}
