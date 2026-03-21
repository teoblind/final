/**
 * Meeting Room Service — Multi-agent live meeting rooms
 *
 * Creates Google Meet → Recall.ai bot joins → transcript fans out to multiple agents
 * Each agent processes transcript in real-time and can respond to user queries.
 */

import { EventEmitter } from 'events';
import Anthropic from '@anthropic-ai/sdk';

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

// Active meeting rooms: meetingId -> room state
const meetingRooms = new Map();
// Bot ID -> meeting ID mapping for webhook routing
const botToMeeting = new Map();

let _anthropic;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
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
    agents: agents || [], // [{ id, name, role, systemPrompt }]
    transcript: [],
    agentResponses: [],
    status: 'waiting', // waiting | active | ended
    startedAt: new Date().toISOString(),
    endedAt: null,
  };

  meetingRooms.set(meetingId, room);
  botToMeeting.set(botId, meetingId);
  console.log(`[MeetingRoom] Created room ${meetingId} with ${agents.length} agents, bot ${botId}`);
  return room;
}

/**
 * Get a meeting room by ID.
 */
export function getMeetingRoom(meetingId) {
  return meetingRooms.get(meetingId) || null;
}

/**
 * Get meeting room by bot ID (for webhook routing).
 */
export function getMeetingRoomByBot(botId) {
  const meetingId = botToMeeting.get(botId);
  return meetingId ? meetingRooms.get(meetingId) : null;
}

/**
 * Add a transcript segment to the room and broadcast via SSE.
 */
export function addTranscript(meetingId, segment) {
  const room = meetingRooms.get(meetingId);
  if (!room) return;

  if (room.status === 'waiting') room.status = 'active';

  room.transcript.push(segment);

  // Broadcast to SSE listeners
  emitter.emit(`transcript:${meetingId}`, {
    type: 'transcript',
    speaker: segment.speaker,
    text: segment.text,
    timestamp: segment.timestamp,
  });
}

/**
 * Add an agent response and broadcast.
 */
export function addAgentResponse(meetingId, response) {
  const room = meetingRooms.get(meetingId);
  if (!room) return;

  room.agentResponses.push(response);

  emitter.emit(`transcript:${meetingId}`, {
    type: 'agent_response',
    agentId: response.agentId,
    agentName: response.agentName,
    text: response.text,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Ask all agents in the meeting room a question.
 * Returns array of responses.
 */
export async function askAgents(meetingId, question) {
  const room = meetingRooms.get(meetingId);
  if (!room) throw new Error('Meeting room not found');

  const transcriptText = room.transcript
    .map(s => `[${s.speaker}]: ${s.text}`)
    .join('\n');

  const responses = await Promise.allSettled(
    room.agents.map(async (agent) => {
      const systemPrompt = `${agent.systemPrompt || `You are ${agent.name}, a ${agent.role} agent.`}

You are participating in a live meeting. Here is the transcript so far:

--- TRANSCRIPT ---
${transcriptText || '(No transcript yet)'}
--- END TRANSCRIPT ---

The user is asking you a question during the meeting. Answer concisely and helpfully based on the transcript context and your expertise.`;

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

      // Broadcast response
      addAgentResponse(meetingId, response);
      return response;
    })
  );

  return responses
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

/**
 * End the meeting room.
 */
export function endMeetingRoom(meetingId) {
  const room = meetingRooms.get(meetingId);
  if (!room) return null;

  room.status = 'ended';
  room.endedAt = new Date().toISOString();

  emitter.emit(`transcript:${meetingId}`, { type: 'meeting_ended' });

  // Clean up bot mapping
  botToMeeting.delete(room.botId);

  console.log(`[MeetingRoom] Room ${meetingId} ended, ${room.transcript.length} transcript segments`);
  return room;
}

/**
 * Get the full transcript as formatted text.
 */
export function getFormattedTranscript(meetingId) {
  const room = meetingRooms.get(meetingId);
  if (!room) return '';

  return room.transcript
    .map(s => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
    .join('\n');
}

/**
 * Subscribe to meeting room events (for SSE).
 */
export function subscribe(meetingId, callback) {
  const eventName = `transcript:${meetingId}`;
  emitter.on(eventName, callback);
  return () => emitter.off(eventName, callback);
}

/**
 * List all active meeting rooms.
 */
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
