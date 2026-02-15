import React, { useState } from 'react';
import Panel from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';

const AGENT_ICONS = {
  'curtailment-optimizer': '\u26A1',
  'pool-optimizer': '\u26CF',
  'alert-synthesizer': '\uD83D\uDD14',
  'reporting-engine': '\uD83D\uDCCA',
};

function getTimeAgo(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getExpiresIn(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function ApprovalQueuePanel() {
  const { data, loading, error, lastFetched, refetch } = useApi('/agents/approvals', { refreshInterval: 10000 });
  const [processingId, setProcessingId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const approvals = data?.approvals || [];

  const handleApprove = async (id) => {
    setProcessingId(id);
    try {
      await postApi(`/agents/approvals/${id}/approve`);
      refetch();
    } catch (err) {
      console.error('Failed to approve:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id) => {
    setProcessingId(id);
    try {
      await postApi(`/agents/approvals/${id}/reject`, { reason: rejectReason || undefined });
      setRejecting(null);
      setRejectReason('');
      refetch();
    } catch (err) {
      console.error('Failed to reject:', err);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <Panel
      title="Pending Approvals"
      source="agents/approvals"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        approvals.length > 0 && (
          <span className="px-2 py-0.5 text-xs bg-terminal-amber/20 text-terminal-amber rounded-full font-medium">
            {approvals.length} pending
          </span>
        )
      }
    >
      <div className="space-y-3">
        {approvals.length === 0 && !loading && (
          <div className="text-center py-8">
            <p className="text-sm text-terminal-muted">No pending approvals</p>
            <p className="text-xs text-terminal-muted mt-1">
              Actions from agents in "approve" mode will appear here
            </p>
          </div>
        )}

        {approvals.map((approval) => {
          const decision = approval.decision || {};
          const icon = AGENT_ICONS[approval.agent_id] || '\uD83E\uDD16';
          const expiresIn = getExpiresIn(approval.expires_at);
          const isExpired = expiresIn === 'Expired';

          return (
            <div
              key={approval.id}
              className={`bg-terminal-bg border rounded p-4 space-y-3 ${
                isExpired ? 'border-terminal-muted/30 opacity-60' : 'border-terminal-border'
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>{icon}</span>
                  <span className="text-sm font-medium text-terminal-text">{approval.agent_name}</span>
                </div>
                <div className="flex items-center gap-3">
                  {expiresIn && !isExpired && (
                    <span className="text-[10px] text-terminal-amber">
                      Expires: {expiresIn}
                    </span>
                  )}
                  {isExpired && (
                    <span className="text-[10px] text-terminal-red">Expired</span>
                  )}
                  <span className="text-[10px] text-terminal-muted">{getTimeAgo(approval.created_at)}</span>
                </div>
              </div>

              {/* Action Description */}
              <div className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-terminal-muted uppercase w-16 shrink-0 pt-0.5">Action</span>
                  <p className="text-sm text-terminal-text">
                    {decision.action === 'curtail' && `Curtail ${decision.params?.machineClasses || 'fleet'} (${decision.params?.machines || '?'} machines)`}
                    {decision.action === 'resume' && `Resume ${decision.params?.machineClasses || 'fleet'} (${decision.params?.machines || '?'} machines)`}
                    {decision.action === 'reallocate' && `Reallocate ${decision.params?.percentage || '?'}% hashrate ${decision.params?.from || '?'} \u2192 ${decision.params?.to || '?'}`}
                    {decision.action === 'regenerate_schedule' && 'Regenerate 24-hour curtailment schedule'}
                    {!['curtail', 'resume', 'reallocate', 'regenerate_schedule'].includes(decision.action) && (decision.summary || decision.action || 'Unknown action')}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-terminal-muted uppercase w-16 shrink-0 pt-0.5">Reason</span>
                  <p className="text-xs text-terminal-muted">{approval.reasoning}</p>
                </div>
                {approval.estimated_impact != null && (
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] text-terminal-muted uppercase w-16 shrink-0 pt-0.5">Impact</span>
                    <p className={`text-xs font-medium ${approval.estimated_impact >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                      {approval.estimated_impact >= 0 ? '+' : ''}${Math.abs(approval.estimated_impact).toFixed(2)}/hr
                    </p>
                  </div>
                )}
              </div>

              {/* Actions */}
              {!isExpired && (
                <div className="flex items-center gap-2 pt-1">
                  {rejecting === approval.id ? (
                    <div className="flex items-center gap-2 w-full">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Reason (optional)"
                        className="flex-1 bg-terminal-panel border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text"
                        autoFocus
                      />
                      <button
                        onClick={() => handleReject(approval.id)}
                        disabled={processingId === approval.id}
                        className="px-3 py-1 text-xs bg-terminal-red/20 text-terminal-red border border-terminal-red/30 rounded hover:bg-terminal-red/30 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => { setRejecting(null); setRejectReason(''); }}
                        className="text-xs text-terminal-muted hover:text-terminal-text"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => handleApprove(approval.id)}
                        disabled={processingId === approval.id}
                        className="px-4 py-1.5 text-xs bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors disabled:opacity-50 font-medium"
                      >
                        {processingId === approval.id ? '...' : '\u2713 Approve'}
                      </button>
                      <button
                        onClick={() => setRejecting(approval.id)}
                        disabled={processingId === approval.id}
                        className="px-4 py-1.5 text-xs bg-terminal-red/10 text-terminal-red border border-terminal-red/30 rounded hover:bg-terminal-red/20 transition-colors disabled:opacity-50 font-medium"
                      >
                        \u2715 Reject
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
