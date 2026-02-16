import React, { useState } from 'react';
import {
  ClipboardList, Search, ChevronDown, ChevronUp, RefreshCw,
  Send, AlertTriangle, CheckCircle, Clock, XCircle, Users, Zap
} from 'lucide-react';
import Panel from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';
import { formatNumber, formatCurrency, formatDate, formatDateTime } from '../../../utils/formatters';

const STATUS_CONFIG = {
  submitted: { label: 'Submitted', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20', border: 'border-terminal-amber/30' },
  under_review: { label: 'Under Review', color: 'text-terminal-cyan', bg: 'bg-terminal-cyan/20', border: 'border-terminal-cyan/30' },
  quote_issued: { label: 'Quote Issued', color: 'text-terminal-green', bg: 'bg-terminal-green/20', border: 'border-terminal-green/30' },
  accepted: { label: 'Accepted', color: 'text-terminal-green', bg: 'bg-terminal-green/20', border: 'border-terminal-green/30' },
  declined: { label: 'Declined', color: 'text-terminal-red', bg: 'bg-terminal-red/20', border: 'border-terminal-red/30' },
  expired: { label: 'Expired', color: 'text-terminal-muted', bg: 'bg-terminal-muted/20', border: 'border-terminal-muted/30' },
};

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'accepted', label: 'Accepted' },
];

/**
 * Panel 9e: Underwriting Queue (Sangha Admin)
 * Table of quote requests across all tenants with review, assessment,
 * and quote issuance capabilities.
 */
export default function UnderwritingQueuePanel() {
  const [filter, setFilter] = useState('all');
  const [expandedRow, setExpandedRow] = useState(null);
  const [issueQuoteFor, setIssueQuoteFor] = useState(null);
  const [runningAssessment, setRunningAssessment] = useState(null);

  // Issue Quote form state
  const [quoteForm, setQuoteForm] = useState({
    premium: '',
    upsideSharePct: '',
    floorPrice: '',
    termMonths: '',
    expiryDays: '7',
  });
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/v1/admin/insurance/queue',
    { refreshInterval: 30 * 1000 }
  );

  const requests = data?.requests || [];
  const summaryStats = data?.summary || {};

  // Filter requests
  const filteredRequests = requests.filter(req => {
    if (filter === 'all') return true;
    if (filter === 'pending') return ['submitted', 'under_review'].includes(req.status);
    if (filter === 'quoted') return req.status === 'quote_issued';
    if (filter === 'accepted') return req.status === 'accepted';
    return true;
  });

  const handleRunAssessment = async (requestId) => {
    setRunningAssessment(requestId);
    try {
      await postApi(`/v1/admin/insurance/queue/${requestId}/assess`);
      await refetch();
    } catch (err) {
      console.error('Assessment failed:', err);
    } finally {
      setRunningAssessment(null);
    }
  };

  const handleIssueQuote = async (requestId) => {
    setQuoteSubmitting(true);
    setQuoteError(null);
    try {
      await postApi(`/v1/admin/insurance/queue/${requestId}/quote`, {
        premium: parseFloat(quoteForm.premium),
        upside_share_pct: parseFloat(quoteForm.upsideSharePct),
        floor_price: parseFloat(quoteForm.floorPrice),
        term_months: parseInt(quoteForm.termMonths, 10),
        expiry_days: parseInt(quoteForm.expiryDays, 10),
      });
      setIssueQuoteFor(null);
      setQuoteForm({ premium: '', upsideSharePct: '', floorPrice: '', termMonths: '', expiryDays: '7' });
      await refetch();
    } catch (err) {
      setQuoteError(err.response?.data?.error || err.message || 'Failed to issue quote');
    } finally {
      setQuoteSubmitting(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedRow(expandedRow === id ? null : id);
    setIssueQuoteFor(null);
    setQuoteError(null);
  };

  return (
    <Panel
      title="Underwriting Queue"
      source={data?.source || 'Sangha Admin'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex items-center gap-2">
          <ClipboardList size={14} className="text-terminal-amber" />
          <span className="text-xs text-terminal-muted">Admin</span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-[10px] text-terminal-muted uppercase">Pending</p>
            <p className="text-xl font-bold text-terminal-amber">{summaryStats.totalPending || 0}</p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-[10px] text-terminal-muted uppercase">Avg Risk Score</p>
            <p className="text-xl font-bold text-terminal-text">{formatNumber(summaryStats.avgRiskScore, 0)}</p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-[10px] text-terminal-muted uppercase">Total TH/s Req</p>
            <p className="text-xl font-bold text-terminal-cyan">
              {formatNumber((summaryStats.totalHashrateRequested || 0) / 1000, 1)}
              <span className="text-xs text-terminal-muted"> PH</span>
            </p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 border-b border-terminal-border pb-2">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1 text-xs rounded-t transition-colors ${
                filter === tab.key
                  ? 'bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 border-b-0'
                  : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border'
              }`}
            >
              {tab.label}
              {tab.key === 'pending' && summaryStats.totalPending > 0 && (
                <span className="ml-1 text-[10px] text-terminal-amber">({summaryStats.totalPending})</span>
              )}
            </button>
          ))}
        </div>

        {/* Requests Table */}
        {filteredRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ClipboardList size={32} className="text-terminal-muted mb-2" />
            <p className="text-sm text-terminal-muted">No requests matching filter.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-2 text-[10px] text-terminal-muted uppercase px-3 py-1.5">
              <div className="col-span-2">Tenant</div>
              <div className="col-span-2">Requested</div>
              <div className="col-span-1 text-right">Floor</div>
              <div className="col-span-1 text-right">TH/s</div>
              <div className="col-span-1 text-right">Term</div>
              <div className="col-span-1 text-right">Risk</div>
              <div className="col-span-2 text-center">Status</div>
              <div className="col-span-2 text-center">Action</div>
            </div>

            {/* Table Rows */}
            {filteredRequests.map((req) => {
              const sc = STATUS_CONFIG[req.status] || STATUS_CONFIG.submitted;
              const isExpanded = expandedRow === req.id;
              const isIssuingQuote = issueQuoteFor === req.id;

              return (
                <div key={req.id} className="border border-terminal-border/50 rounded">
                  {/* Main Row */}
                  <div
                    className="grid grid-cols-12 gap-2 items-center px-3 py-2 text-xs cursor-pointer hover:bg-terminal-border/20 transition-colors"
                    onClick={() => toggleExpand(req.id)}
                  >
                    <div className="col-span-2 truncate text-terminal-text flex items-center gap-1.5">
                      <Users size={11} className="text-terminal-muted flex-shrink-0" />
                      {req.tenantName || req.tenantId}
                    </div>
                    <div className="col-span-2 text-terminal-muted">
                      {formatDate(req.requestedAt || req.createdAt)}
                    </div>
                    <div className="col-span-1 text-right font-mono text-terminal-text">
                      ${formatNumber(req.desiredFloor || req.floorPrice, 0)}
                    </div>
                    <div className="col-span-1 text-right font-mono text-terminal-text">
                      {formatNumber(req.hashrateTH, 0)}
                    </div>
                    <div className="col-span-1 text-right text-terminal-muted">
                      {req.termMonths}mo
                    </div>
                    <div className="col-span-1 text-right">
                      <span className={`font-mono ${
                        req.riskScore <= 30 ? 'text-terminal-green' :
                        req.riskScore <= 60 ? 'text-terminal-amber' :
                        req.riskScore > 60 ? 'text-terminal-red' : 'text-terminal-muted'
                      }`}>
                        {req.riskScore != null ? req.riskScore : '--'}
                      </span>
                    </div>
                    <div className="col-span-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded ${sc.bg} ${sc.color}`}>
                        {sc.label}
                      </span>
                    </div>
                    <div className="col-span-2 flex justify-center">
                      {isExpanded ? <ChevronUp size={14} className="text-terminal-muted" /> : <ChevronDown size={14} className="text-terminal-muted" />}
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-terminal-border/30 space-y-3">
                      {/* Assessment details */}
                      {req.assessment && (
                        <div className="bg-terminal-bg/50 rounded p-3">
                          <p className="text-[10px] text-terminal-muted uppercase mb-1.5">Assessment</p>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="text-terminal-muted">Risk Score: </span>
                              <span className="text-terminal-text font-mono">{req.assessment.compositeRiskScore}</span>
                            </div>
                            <div>
                              <span className="text-terminal-muted">Fleet Eff: </span>
                              <span className="text-terminal-text font-mono">P{req.assessment.fleetEfficiencyPercentile}</span>
                            </div>
                            <div>
                              <span className="text-terminal-muted">Energy: </span>
                              <span className="text-terminal-text font-mono">P{req.assessment.energyCostPercentile}</span>
                            </div>
                          </div>
                          {req.assessment.summary && (
                            <p className="text-[11px] text-terminal-muted mt-2 leading-relaxed">{req.assessment.summary}</p>
                          )}
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRunAssessment(req.id); }}
                          disabled={runningAssessment === req.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/30 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw size={12} className={runningAssessment === req.id ? 'animate-spin' : ''} />
                          {runningAssessment === req.id ? 'Running...' : 'Run Assessment'}
                        </button>
                        {['submitted', 'under_review'].includes(req.status) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIssueQuoteFor(isIssuingQuote ? null : req.id);
                              setQuoteError(null);
                              // Pre-fill from request data
                              setQuoteForm(prev => ({
                                ...prev,
                                floorPrice: String(req.desiredFloor || req.floorPrice || ''),
                                termMonths: String(req.termMonths || ''),
                              }));
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors"
                          >
                            <Send size={12} />
                            Issue Quote
                          </button>
                        )}
                      </div>

                      {/* Issue Quote Form */}
                      {isIssuingQuote && (
                        <div className="bg-terminal-bg/50 border border-terminal-green/20 rounded p-3 space-y-3">
                          <p className="text-xs font-semibold text-terminal-green">Issue Quote</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-terminal-muted block mb-1">Premium ($/mo)</label>
                              <input
                                type="number"
                                value={quoteForm.premium}
                                onChange={(e) => setQuoteForm(f => ({ ...f, premium: e.target.value }))}
                                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
                                placeholder="Monthly premium"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-terminal-muted block mb-1">Upside Share %</label>
                              <input
                                type="number"
                                value={quoteForm.upsideSharePct}
                                onChange={(e) => setQuoteForm(f => ({ ...f, upsideSharePct: e.target.value }))}
                                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
                                placeholder="e.g. 15"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-terminal-muted block mb-1">Floor Price</label>
                              <input
                                type="number"
                                value={quoteForm.floorPrice}
                                onChange={(e) => setQuoteForm(f => ({ ...f, floorPrice: e.target.value }))}
                                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
                                placeholder="$/PH/day"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-terminal-muted block mb-1">Term (months)</label>
                              <input
                                type="number"
                                value={quoteForm.termMonths}
                                onChange={(e) => setQuoteForm(f => ({ ...f, termMonths: e.target.value }))}
                                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
                                placeholder="12"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] text-terminal-muted block mb-1">Quote Expiry (days)</label>
                              <input
                                type="number"
                                value={quoteForm.expiryDays}
                                onChange={(e) => setQuoteForm(f => ({ ...f, expiryDays: e.target.value }))}
                                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-green"
                                placeholder="7"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          </div>

                          {quoteError && (
                            <div className="flex items-center gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded px-2 py-1.5">
                              <AlertTriangle size={12} />
                              {quoteError}
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); setIssueQuoteFor(null); setQuoteError(null); }}
                              className="flex-1 px-3 py-1.5 text-xs border border-terminal-border rounded text-terminal-muted hover:bg-terminal-border transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleIssueQuote(req.id); }}
                              disabled={quoteSubmitting || !quoteForm.premium || !quoteForm.floorPrice}
                              className="flex-1 px-3 py-1.5 text-xs bg-terminal-green text-terminal-bg rounded font-semibold hover:bg-terminal-green/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              <CheckCircle size={12} />
                              {quoteSubmitting ? 'Issuing...' : 'Confirm Quote'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}
