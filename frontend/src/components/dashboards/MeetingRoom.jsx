import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/hooks/useApi';

const ROLE_ICONS = {
  comms: '📨',
  chat: '💬',
  workflow: '📋',
  research: '🔬',
};

const ROLE_COLORS = {
  comms: '#2563eb',
  chat: '#7c3aed',
  workflow: '#1e3a5f',
  research: '#b8860b',
};

export default function MeetingRoom({ meetingId, meetLink, title, agents, onEnd }) {
  const [transcript, setTranscript] = useState([]);
  const [agentResponses, setAgentResponses] = useState([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [ending, setEnding] = useState(false);
  const [connected, setConnected] = useState(false);
  const transcriptEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  // Connect to SSE stream
  useEffect(() => {
    if (!meetingId) return;

    const token = localStorage.getItem('token');
    const url = `/api/v1/meetings/room/${meetingId}/live?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'transcript') {
          setTranscript(prev => [...prev, data]);
        } else if (data.type === 'agent_response') {
          setAgentResponses(prev => [...prev, data]);
        } else if (data.type === 'meeting_ended') {
          setConnected(false);
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [meetingId]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, agentResponses]);

  const handleAsk = useCallback(async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    try {
      await api.post(`/v1/meetings/room/${meetingId}/ask`, { question: question.trim() });
      setQuestion('');
    } catch (err) {
      console.error('Ask error:', err);
    } finally {
      setAsking(false);
    }
  }, [question, asking, meetingId]);

  const handleEnd = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    try {
      await api.post(`/v1/meetings/room/${meetingId}/end`);
      if (onEnd) onEnd();
    } catch (err) {
      console.error('End meeting error:', err);
    } finally {
      setEnding(false);
    }
  }, [ending, meetingId, onEnd]);

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#f0eeea] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">{title || 'Meeting Room'}</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-[11px] font-semibold text-white rounded-lg"
            style={{ backgroundColor: '#1a6b3c' }}
          >
            Join Google Meet
          </a>
          <button
            onClick={handleEnd}
            disabled={ending}
            className="px-3 py-1.5 text-[11px] font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50"
          >
            {ending ? 'Ending...' : 'End Meeting'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px]" style={{ minHeight: '400px' }}>
        {/* Left: Transcript + Chat */}
        <div className="flex flex-col border-r border-[#f0eeea]">
          {/* Transcript feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ maxHeight: '350px' }}>
            {transcript.length === 0 && (
              <div className="text-center text-sm text-terminal-muted py-8">
                Waiting for meeting to start...
                <br />
                <span className="text-[11px]">Join the Google Meet and start talking</span>
              </div>
            )}
            {transcript.map((seg, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[11px] font-bold text-terminal-text shrink-0 w-[80px] truncate" title={seg.speaker}>
                  {seg.speaker}:
                </span>
                <span className="text-[12px] text-terminal-text">{seg.text}</span>
              </div>
            ))}

            {/* Agent responses inline */}
            {agentResponses.map((resp, i) => (
              <div key={`resp-${i}`} className="ml-2 mt-2 p-2.5 rounded-lg border" style={{
                backgroundColor: `${ROLE_COLORS[resp.agentRole] || '#6b7280'}08`,
                borderColor: `${ROLE_COLORS[resp.agentRole] || '#6b7280'}20`,
              }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[13px]">{ROLE_ICONS[resp.agentRole] || '🤖'}</span>
                  <span className="text-[11px] font-bold" style={{ color: ROLE_COLORS[resp.agentRole] || '#6b7280' }}>
                    {resp.agentName}
                  </span>
                </div>
                <p className="text-[12px] text-terminal-text whitespace-pre-wrap">{resp.text}</p>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>

          {/* Ask agents input */}
          <div className="border-t border-[#f0eeea] p-3 flex gap-2">
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAsk()}
              placeholder="Ask all agents a question..."
              className="flex-1 px-3 py-2 text-[12px] border border-[#e0ddd8] rounded-lg bg-white focus:outline-none focus:border-[#1a6b3c]"
            />
            <button
              onClick={handleAsk}
              disabled={asking || !question.trim()}
              className="px-4 py-2 text-[11px] font-semibold text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#1a6b3c' }}
            >
              {asking ? '...' : 'Ask'}
            </button>
          </div>
        </div>

        {/* Right: Participating agents */}
        <div className="p-4">
          <p className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-3">
            Participating Agents
          </p>
          <div className="space-y-3">
            {agents.map(agent => (
              <div key={agent.id} className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[14px]"
                  style={{ backgroundColor: `${ROLE_COLORS[agent.role] || '#6b7280'}15` }}
                >
                  {ROLE_ICONS[agent.role] || '🤖'}
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-terminal-text">{agent.name}</p>
                  <p className="text-[10px] text-terminal-muted capitalize">{agent.role}</p>
                </div>
                <div className="ml-auto w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              </div>
            ))}
          </div>

          <div className="mt-6 p-3 rounded-lg bg-[#f5f4f0]">
            <p className="text-[10px] font-bold text-terminal-muted uppercase mb-1">Stats</p>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-terminal-muted">Transcript</span>
                <span className="font-medium text-terminal-text">{transcript.length} segments</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-terminal-muted">Agent Responses</span>
                <span className="font-medium text-terminal-text">{agentResponses.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
