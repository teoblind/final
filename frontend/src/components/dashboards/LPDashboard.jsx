import React, { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, Clock, FileText, DollarSign, CheckCircle, XCircle,
  AlertTriangle, ChevronDown, ChevronUp, RefreshCw, TrendingUp,
  Shield, Send, Eye
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import api from '../../lib/hooks/useApi';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n, decimals = 0) {
  if (n == null) return '--';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n) {
  if (n == null) return '--';
  return `$${fmt(n, 0)}`;
}

function fmtPct(n, decimals = 1) {
  if (n == null) return '--';
  return `${(n * 100).toFixed(decimals)}%`;
}

function StatusBadge({ status }) {
  const config = {
    pending: { label: 'Pending', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20' },
    approved: { label: 'Approved', color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
    rejected: { label: 'Rejected', color: 'text-terminal-red', bg: 'bg-terminal-red/20' },
    modification_requested: { label: 'Modification Req', color: 'text-terminal-cyan', bg: 'bg-terminal-cyan/20' },
    active: { label: 'Active', color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
    paid: { label: 'Paid', color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
    verified: { label: 'Verified', color: 'text-terminal-cyan', bg: 'bg-terminal-cyan/20' },
    pending_verification: { label: 'Pending', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20' },
    settled_by_lp: { label: 'Settled', color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
    disputed_by_lp: { label: 'Disputed', color: 'text-terminal-red', bg: 'bg-terminal-red/20' },
  };
  const c = config[status] || { label: status || 'Unknown', color: 'text-terminal-muted', bg: 'bg-terminal-muted/20' };
  return <span className={`text-[10px] px-2 py-0.5 rounded ${c.bg} ${c.color}`}>{c.label}</span>;
}

// ─── LP-1: Portfolio Overview ────────────────────────────────────────────────

function PortfolioPanel({ data, performance }) {
  if (!data) return null;

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
      <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3 flex items-center gap-2">
        <Briefcase size={14} className="text-terminal-green" />
        Portfolio Overview
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-[10px] text-terminal-muted uppercase">Capital Deployed</p>
          <p className="text-xl font-bold text-terminal-green font-sans">{fmtCurrency(data.capitalDeployed)}</p>
        </div>
        <div>
          <p className="text-[10px] text-terminal-muted uppercase">Active Policies</p>
          <p className="text-xl font-bold text-terminal-text">{data.activePolicies || 0}</p>
        </div>
        <div>
          <p className="text-[10px] text-terminal-muted uppercase">Monthly Premium</p>
          <p className="text-xl font-bold text-terminal-cyan font-sans">{fmtCurrency(data.monthlyPremiumIncome)}</p>
        </div>
        <div>
          <p className="text-[10px] text-terminal-muted uppercase">Covered Hashrate</p>
          <p className="text-xl font-bold text-terminal-text font-sans">
            {fmt((data.totalCoveredHashrate || 0) / 1000, 1)} <span className="text-xs text-terminal-muted">PH/s</span>
          </p>
        </div>
      </div>

      {performance && (
        <div className="border-t border-terminal-border pt-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-[10px] text-terminal-muted uppercase">Annual Premium</p>
              <p className="text-sm font-bold text-terminal-green font-sans">{fmtCurrency(performance.annualPremiumIncome)}</p>
            </div>
            <div>
              <p className="text-[10px] text-terminal-muted uppercase">Claims Paid</p>
              <p className="text-sm font-bold text-terminal-red font-sans">{fmtCurrency(data.totalClaimsPaid)}</p>
            </div>
            <div>
              <p className="text-[10px] text-terminal-muted uppercase">Net Income</p>
              <p className={`text-sm font-bold font-sans ${(performance.netIncomePostFees || 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                {fmtCurrency(performance.netIncomePostFees)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-terminal-muted uppercase">Return on Capital</p>
              <p className={`text-sm font-bold font-sans ${(performance.returnOnDeployedCapital || 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                {fmtPct(performance.returnOnDeployedCapital)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LP-2: Pending Allocations ───────────────────────────────────────────────

function AllocationCard({ alloc, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const [actionNotes, setActionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const terms = alloc.structuredTerms || {};

  const handleAction = async (action) => {
    setSubmitting(true);
    try {
      const body = action === 'reject'
        ? { reason: actionNotes }
        : action === 'modify'
          ? { modification: actionNotes }
          : { notes: actionNotes };
      await api.post(`/v1/lp/allocations/${alloc.id}/${action}`, body);
      onAction?.();
    } catch (err) {
      console.error(`${action} failed:`, err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-terminal-bg/50 border border-terminal-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-terminal-amber" />
          <span className="text-xs text-terminal-text font-medium">Allocation #{alloc.id?.substring(0, 8)}</span>
        </div>
        <StatusBadge status={alloc.status} />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
        <div>
          <span className="text-terminal-muted">Floor: </span>
          <span className="text-terminal-cyan font-sans">${fmt(terms.floorPrice, 2)}</span>
        </div>
        <div>
          <span className="text-terminal-muted">Premium: </span>
          <span className="text-terminal-green font-sans">{fmtCurrency(terms.monthlyPremium)}/mo</span>
        </div>
        <div>
          <span className="text-terminal-muted">Term: </span>
          <span className="text-terminal-text">{terms.termMonths || '--'}mo</span>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] text-terminal-cyan hover:underline mb-2 flex items-center gap-1"
      >
        {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        {expanded ? 'Hide details' : 'View details & actions'}
      </button>

      {expanded && (
        <div className="space-y-3 pt-2 border-t border-terminal-border/30">
          {/* Fee decomposition */}
          <div className="bg-terminal-panel/50 rounded p-2 space-y-1 text-[11px]">
            <p className="text-terminal-muted font-semibold">Fee Structure</p>
            <div className="flex justify-between">
              <span className="text-terminal-muted">LP Premium Share</span>
              <span className="text-terminal-green font-sans">{fmtCurrency(terms.lpPremiumShare)}/mo</span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-muted">Sangha Structuring Fee</span>
              <span className="text-terminal-text font-sans">{fmtCurrency(terms.structuringFee)}/mo</span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-muted">Sangha Management Fee</span>
              <span className="text-terminal-text font-sans">{fmtCurrency(terms.managementFee)}/mo</span>
            </div>
            <div className="flex justify-between border-t border-terminal-border/30 pt-1">
              <span className="text-terminal-muted font-semibold">Total Miner Premium</span>
              <span className="text-terminal-cyan font-sans font-semibold">{fmtCurrency(terms.monthlyPremium)}/mo</span>
            </div>
          </div>

          {/* Risk Summary */}
          {alloc.riskSummary && (
            <div className="bg-terminal-panel/50 rounded p-2 text-[11px]">
              <p className="text-terminal-muted font-semibold mb-1">Risk Summary</p>
              <p className="text-terminal-text leading-relaxed">{
                typeof alloc.riskSummary === 'string' ? alloc.riskSummary : JSON.stringify(alloc.riskSummary)
              }</p>
            </div>
          )}

          {alloc.status === 'pending' && (
            <>
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Notes / reason (optional for approve, required for reject/modify)"
                rows={2}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:border-terminal-cyan"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction('approve')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors disabled:opacity-50"
                >
                  <CheckCircle size={12} /> Approve
                </button>
                <button
                  onClick={() => handleAction('modify')}
                  disabled={submitting || !actionNotes}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/30 transition-colors disabled:opacity-50"
                >
                  <Send size={12} /> Modify
                </button>
                <button
                  onClick={() => handleAction('reject')}
                  disabled={submitting || !actionNotes}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-terminal-red/20 text-terminal-red border border-terminal-red/30 rounded hover:bg-terminal-red/30 transition-colors disabled:opacity-50"
                >
                  <XCircle size={12} /> Reject
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PendingAllocationsPanel({ allocations, onRefresh }) {
  const pending = (allocations || []).filter(a => a.status === 'pending');
  const other = (allocations || []).filter(a => a.status !== 'pending');

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs text-terminal-muted uppercase tracking-wider flex items-center gap-2">
          <Clock size={14} className="text-terminal-amber" />
          Pending Allocations ({pending.length})
        </h3>
        <button onClick={onRefresh} className="p-1 hover:bg-terminal-border rounded">
          <RefreshCw size={12} className="text-terminal-muted" />
        </button>
      </div>

      {pending.length === 0 && other.length === 0 ? (
        <p className="text-xs text-terminal-muted text-center py-6">No allocations found.</p>
      ) : (
        <div className="space-y-2">
          {pending.map(a => <AllocationCard key={a.id} alloc={a} onAction={onRefresh} />)}
          {other.length > 0 && (
            <details className="mt-2">
              <summary className="text-[10px] text-terminal-muted cursor-pointer hover:text-terminal-text">
                Resolved allocations ({other.length})
              </summary>
              <div className="space-y-2 mt-2">
                {other.map(a => <AllocationCard key={a.id} alloc={a} onAction={onRefresh} />)}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ─── LP-3: Active Policies ───────────────────────────────────────────────────

function ActivePoliciesPanel({ policies }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
      <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3 flex items-center gap-2">
        <FileText size={14} className="text-terminal-cyan" />
        Active Policies ({(policies || []).length})
      </h3>

      {(!policies || policies.length === 0) ? (
        <p className="text-xs text-terminal-muted text-center py-6">No active policies.</p>
      ) : (
        <div className="space-y-2">
          {policies.map(p => (
            <div key={p.id} className="bg-terminal-bg/50 border border-terminal-border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-terminal-text font-medium">Policy {p.policyNumber || '#' + p.id?.substring(0, 8)}</span>
                <StatusBadge status={p.status} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-terminal-muted">Instrument: </span>
                  <span className="text-terminal-cyan">{p.instrumentType || 'Standard'}</span>
                </div>
                <div>
                  <span className="text-terminal-muted">Floor: </span>
                  <span className="text-terminal-text font-sans">${fmt(p.floorPrice, 2)}</span>
                </div>
                <div>
                  <span className="text-terminal-muted">Premium: </span>
                  <span className="text-terminal-green font-sans">{fmtCurrency(p.monthlyPremium)}/mo</span>
                </div>
                <div>
                  <span className="text-terminal-muted">Hashrate: </span>
                  <span className="text-terminal-text font-sans">{fmt(p.coveredHashrate, 0)} TH/s</span>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-terminal-muted">
                <span>Start: {p.startDate?.substring(0, 10) || '--'}</span>
                <span>End: {p.endDate?.substring(0, 10) || '--'}</span>
                <span>{p.termMonths}mo term</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LP-4: Claims & Settlements ──────────────────────────────────────────────

function ClaimsSettlementsPanel({ claims, settlements, onRefresh }) {
  const [settleId, setSettleId] = useState(null);
  const [disputeId, setDisputeId] = useState(null);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSettle = async (claimId) => {
    setSubmitting(true);
    try {
      await api.post(`/v1/lp/claims/${claimId}/settle`, { settlementReference: reference });
      setSettleId(null);
      setReference('');
      onRefresh?.();
    } catch (err) {
      console.error('Settle failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDispute = async (claimId) => {
    setSubmitting(true);
    try {
      await api.post(`/v1/lp/claims/${claimId}/dispute`, { reason });
      setDisputeId(null);
      setReason('');
      onRefresh?.();
    } catch (err) {
      console.error('Dispute failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
      <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3 flex items-center gap-2">
        <DollarSign size={14} className="text-terminal-amber" />
        Claims & Settlements
      </h3>

      {/* Active Claims */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-terminal-text mb-2">Open Claims ({(claims || []).length})</p>
        {(!claims || claims.length === 0) ? (
          <p className="text-xs text-terminal-muted py-2">No open claims.</p>
        ) : (
          <div className="space-y-2">
            {claims.map(c => (
              <div key={c.id} className="bg-terminal-bg/50 border border-terminal-border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-terminal-text">Policy {c.policyNumber} &mdash; {c.claimMonth}</span>
                  <StatusBadge status={c.settlementStatus || c.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                  <div>
                    <span className="text-terminal-muted">Gross: </span>
                    <span className="text-terminal-amber font-sans">{fmtCurrency(c.grossClaimAmount)}</span>
                  </div>
                  <div>
                    <span className="text-terminal-muted">Recommended: </span>
                    <span className="text-terminal-green font-sans">{fmtCurrency(c.recommendedPayout)}</span>
                  </div>
                  <div>
                    <span className="text-terminal-muted">Paid: </span>
                    <span className="text-terminal-text font-sans">{fmtCurrency(c.paidAmount)}</span>
                  </div>
                </div>

                {/* Settle / Dispute actions */}
                {!c.settlementStatus && c.status !== 'paid' && (
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => { setSettleId(c.id); setDisputeId(null); }}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-terminal-green/20 text-terminal-green rounded hover:bg-terminal-green/30"
                    >
                      <CheckCircle size={10} /> Settle
                    </button>
                    <button
                      onClick={() => { setDisputeId(c.id); setSettleId(null); }}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-terminal-red/20 text-terminal-red rounded hover:bg-terminal-red/30"
                    >
                      <AlertTriangle size={10} /> Dispute
                    </button>
                    <button
                      onClick={() => window.open(`#/lp/claims/${c.id}/verification`, '_blank')}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-terminal-cyan/20 text-terminal-cyan rounded hover:bg-terminal-cyan/30"
                    >
                      <Eye size={10} /> Verify
                    </button>
                  </div>
                )}

                {settleId === c.id && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={reference}
                      onChange={e => setReference(e.target.value)}
                      placeholder="Settlement reference (optional)"
                      className="flex-1 bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:outline-none focus:border-terminal-green"
                    />
                    <button
                      onClick={() => handleSettle(c.id)}
                      disabled={submitting}
                      className="px-3 py-1 text-xs bg-terminal-green text-terminal-bg rounded font-semibold disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  </div>
                )}

                {disputeId === c.id && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Dispute reason (required)"
                      className="flex-1 bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text focus:outline-none focus:border-terminal-red"
                    />
                    <button
                      onClick={() => handleDispute(c.id)}
                      disabled={submitting || !reason}
                      className="px-3 py-1 text-xs bg-terminal-red text-white rounded font-semibold disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settlement History */}
      {settlements && settlements.length > 0 && (
        <div className="border-t border-terminal-border pt-3">
          <p className="text-xs font-semibold text-terminal-text mb-2">Settlement History ({settlements.length})</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border text-terminal-muted text-[10px] uppercase">
                  <th className="text-left py-1">Policy</th>
                  <th className="text-left py-1">Month</th>
                  <th className="text-right py-1">Amount</th>
                  <th className="text-left py-1">Settled</th>
                  <th className="text-left py-1">Reference</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s, i) => (
                  <tr key={i} className="border-b border-terminal-border/30">
                    <td className="py-1.5 text-terminal-text">{s.policyNumber}</td>
                    <td className="py-1.5 text-terminal-muted">{s.claimMonth}</td>
                    <td className="py-1.5 text-right font-sans text-terminal-green">{fmtCurrency(s.amount)}</td>
                    <td className="py-1.5 text-terminal-muted">{s.settledAt?.substring(0, 10) || '--'}</td>
                    <td className="py-1.5 text-terminal-muted truncate max-w-[100px]">{s.reference || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main LP Dashboard ───────────────────────────────────────────────────────

export default function LPDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [claims, setClaims] = useState([]);
  const [settlements, setSettlements] = useState([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [portfolioRes, perfRes, allocRes, policyRes, claimRes, settleRes] = await Promise.all([
        api.get('/v1/lp/portfolio'),
        api.get('/v1/lp/performance'),
        api.get('/v1/lp/allocations'),
        api.get('/v1/lp/policies'),
        api.get('/v1/lp/claims'),
        api.get('/v1/lp/settlements'),
      ]);
      setPortfolio(portfolioRes.data);
      setPerformance(perfRes.data);
      setAllocations(allocRes.data?.allocations || []);
      setPolicies(policyRes.data?.policies || []);
      setClaims(claimRes.data?.claims || []);
      setSettlements(settleRes.data?.settlements || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load LP data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center py-24">
        <div className="spinner w-10 h-10" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="flex flex-col items-center justify-center py-24 text-terminal-red">
          <p className="text-lg font-semibold mb-2">Error Loading LP Dashboard</p>
          <p className="text-sm text-terminal-muted">{error}</p>
          <button onClick={fetchAll} className="mt-4 px-4 py-2 bg-terminal-panel border border-terminal-border rounded text-sm hover:border-terminal-green">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const partnerName = portfolio?.partner?.name || 'Balance Sheet Partner';

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-terminal-green flex items-center gap-2">
          <Shield size={20} />
          LP Portal &mdash; {partnerName}
        </h2>
        <p className="text-xs text-terminal-muted mt-1">
          Institutional capital partner dashboard &mdash; portfolio, allocations, policies, and settlements.
        </p>
      </div>

      {/* Panels */}
      <div className="space-y-4">
        <PortfolioPanel data={portfolio} performance={performance} />
        <PendingAllocationsPanel allocations={allocations} onRefresh={fetchAll} />
        <ActivePoliciesPanel policies={policies} />
        <ClaimsSettlementsPanel claims={claims} settlements={settlements} onRefresh={fetchAll} />
      </div>
    </div>
  );
}
