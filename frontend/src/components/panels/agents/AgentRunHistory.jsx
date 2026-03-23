import React, { useState, useEffect, useCallback } from 'react';
import api from '../../../lib/hooks/useApi';

const STATUS_STYLES = {
  completed: { bg: '#e8f5ee', text: '#1a6b3c', label: 'OK' },
  failed: { bg: '#fde8e8', text: '#b91c1c', label: 'FAIL' },
  timeout: { bg: '#fdf6e8', text: '#8b6914', label: 'TIMEOUT' },
  running: { bg: '#e8eef5', text: '#1e3a5f', label: 'RUNNING' },
};

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts + 'Z');
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function truncate(s, n = 80) {
  if (!s) return '-';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.completed;
  return (
    <span style={{ background: s.bg, color: s.text, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: 0.3 }}>
      {s.label}
    </span>
  );
}

function DiffView({ diff, stats, runA, runB, onClose }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--t-border, #e5e2dc)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-text, #1a1a18)' }}>Output Diff</div>
          <div style={{ fontSize: 11, color: '#9a9a92', marginTop: 2 }}>
            Run {runA.run_id} vs {runB.run_id} - {stats.added} added, {stats.removed} removed, {stats.equal} unchanged
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9a9a92' }}>x</button>
      </div>
      <div style={{ fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 12, lineHeight: 1.7, maxHeight: 400, overflow: 'auto', border: '1px solid #f0eeea', borderRadius: 8, padding: 12 }}>
        {diff.map((d, i) => (
          <div key={i} style={{
            padding: '1px 6px',
            background: d.type === 'added' ? '#e6ffec' : d.type === 'removed' ? '#ffebe9' : 'transparent',
            color: d.type === 'added' ? '#1a6b3c' : d.type === 'removed' ? '#b91c1c' : '#555',
            borderLeft: d.type === 'added' ? '3px solid #1a6b3c' : d.type === 'removed' ? '3px solid #b91c1c' : '3px solid transparent',
          }}>
            {d.type === 'added' ? '+ ' : d.type === 'removed' ? '- ' : '  '}{d.line}
          </div>
        ))}
        {diff.length === 0 && <div style={{ color: '#9a9a92', textAlign: 'center', padding: 20 }}>Outputs are identical</div>}
      </div>
    </div>
  );
}

export default function AgentRunHistory({ agentId = null }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [selectedForDiff, setSelectedForDiff] = useState([]);
  const [diffData, setDiffData] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [filterAgent, setFilterAgent] = useState(agentId || '');

  const fetchRuns = useCallback(async () => {
    try {
      setLoading(true);
      const endpoint = filterAgent
        ? `/v1/agents/${filterAgent}/runs?limit=100`
        : '/v1/agents/runs?limit=100';
      const res = await api.get(endpoint);
      setRuns(res.data.runs || []);
    } catch (e) {
      console.error('Failed to fetch runs:', e);
    } finally {
      setLoading(false);
    }
  }, [filterAgent]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const toggleDiffSelect = (runId) => {
    setSelectedForDiff(prev => {
      if (prev.includes(runId)) return prev.filter(id => id !== runId);
      if (prev.length >= 2) return [prev[1], runId];
      return [...prev, runId];
    });
    setDiffData(null);
  };

  const loadDiff = async () => {
    if (selectedForDiff.length !== 2) return;
    setDiffLoading(true);
    try {
      const res = await api.get(`/v1/agents/runs/diff?a=${selectedForDiff[0]}&b=${selectedForDiff[1]}`);
      setDiffData(res.data);
    } catch (e) {
      console.error('Failed to load diff:', e);
    } finally {
      setDiffLoading(false);
    }
  };

  const agents = [...new Set(runs.map(r => r.agent_id))].sort();

  return (
    <div style={{ background: 'var(--t-panel, #fff)', border: '1px solid var(--t-border, #e5e2dc)', borderRadius: 14, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t-text, #1a1a18)' }}>Agent Run History</div>
          <div style={{ fontSize: 12, color: '#9a9a92', marginTop: 2 }}>
            {runs.length} run{runs.length !== 1 ? 's' : ''} recorded - select two to compare outputs
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!agentId && (
            <select
              value={filterAgent}
              onChange={e => { setFilterAgent(e.target.value); setSelectedForDiff([]); setDiffData(null); }}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #e5e2dc', background: '#fafaf8', color: '#555' }}
            >
              <option value="">All agents</option>
              {agents.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {selectedForDiff.length === 2 && (
            <button
              onClick={loadDiff}
              disabled={diffLoading}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6, border: 'none', background: '#1a1a18', color: '#fff', cursor: 'pointer', opacity: diffLoading ? 0.6 : 1 }}
            >
              {diffLoading ? 'Loading...' : 'Compare'}
            </button>
          )}
          <button
            onClick={fetchRuns}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #e5e2dc', background: '#fafaf8', cursor: 'pointer', color: '#555' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {diffData && (
        <DiffView
          diff={diffData.diff}
          stats={diffData.stats}
          runA={diffData.runA}
          runB={diffData.runB}
          onClose={() => { setDiffData(null); setSelectedForDiff([]); }}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9a9a92', fontSize: 13 }}>Loading runs...</div>
      ) : runs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9a9a92', fontSize: 13 }}>
          No runs recorded yet. Runs are captured automatically when agents respond to messages.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f0eeea' }}>
                <th style={{ width: 32, padding: '8px 6px', textAlign: 'center' }}></th>
                <th style={thStyle}>Time</th>
                {!agentId && <th style={thStyle}>Agent</th>}
                <th style={thStyle}>Input</th>
                <th style={thStyle}>Output</th>
                <th style={thStyle}>Model</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Tokens</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Duration</th>
                <th style={thStyle}>Tools</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => {
                const isExpanded = expandedId === run.run_id;
                const isSelected = selectedForDiff.includes(run.run_id);
                let tools = [];
                try { tools = run.tools_used ? JSON.parse(run.tools_used) : []; } catch { tools = []; }

                return (
                  <React.Fragment key={run.run_id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : run.run_id)}
                      style={{
                        borderBottom: '1px solid #f8f7f4',
                        cursor: 'pointer',
                        background: isSelected ? '#f0eef8' : isExpanded ? '#fafaf8' : 'transparent',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (!isSelected && !isExpanded) e.currentTarget.style.background = '#fafaf8'; }}
                      onMouseLeave={e => { if (!isSelected && !isExpanded) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => { e.stopPropagation(); toggleDiffSelect(run.run_id); }}
                          style={{ accentColor: '#1e3a5f', cursor: 'pointer' }}
                        />
                      </td>
                      <td style={tdStyle}>{formatTime(run.created_at)}</td>
                      {!agentId && <td style={{ ...tdStyle, fontWeight: 500 }}>{run.agent_id}</td>}
                      <td style={{ ...tdStyle, maxWidth: 200 }}>{truncate(run.input, 60)}</td>
                      <td style={{ ...tdStyle, maxWidth: 250, color: '#555' }}>{truncate(run.output, 80)}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{run.model?.replace('claude-', '') || '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                        {(run.input_tokens || 0) + (run.output_tokens || 0) > 0
                          ? `${((run.input_tokens + run.output_tokens) / 1000).toFixed(1)}k`
                          : '-'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                        {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '-'}
                      </td>
                      <td style={tdStyle}>
                        {tools.length > 0 ? (
                          <span style={{ fontSize: 10, background: '#f0eeea', padding: '2px 6px', borderRadius: 4, color: '#555' }}>
                            {tools.length} tool{tools.length !== 1 ? 's' : ''}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={tdStyle}><StatusBadge status={run.status} /></td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={agentId ? 9 : 10} style={{ padding: 0 }}>
                          <div style={{ background: '#fafaf8', borderTop: '1px solid #f0eeea', padding: 16 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: '#9a9a92', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Input</div>
                                <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, background: '#fff', padding: 12, borderRadius: 8, border: '1px solid #f0eeea', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {run.input || '-'}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: '#9a9a92', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Output</div>
                                <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, background: '#fff', padding: 12, borderRadius: 8, border: '1px solid #f0eeea', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {run.output || '-'}
                                </div>
                              </div>
                            </div>
                            {tools.length > 0 && (
                              <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: '#9a9a92', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tools Used</div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  {tools.map((t, i) => (
                                    <span key={i} style={{ fontSize: 11, background: '#e8eef5', color: '#1e3a5f', padding: '3px 8px', borderRadius: 4, fontFamily: 'monospace' }}>{t}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {run.error_message && (
                              <div style={{ marginTop: 12, background: '#fde8e8', padding: 10, borderRadius: 8, fontSize: 12, color: '#b91c1c', fontFamily: 'monospace' }}>
                                {run.error_message}
                              </div>
                            )}
                            <div style={{ marginTop: 10, fontSize: 10, color: '#b5b3ae' }}>
                              Run ID: {run.run_id} | Route: {run.route} | Model: {run.model || '-'} | In: {run.input_tokens || 0} | Out: {run.output_tokens || 0}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 600,
  color: '#9a9a92',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const tdStyle = {
  padding: '10px 10px',
  color: 'var(--t-text, #1a1a18)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
