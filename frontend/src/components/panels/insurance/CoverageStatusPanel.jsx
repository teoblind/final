import React, { useState } from 'react';
import {
  Shield, FileText, CheckCircle, Clock, AlertTriangle, XCircle,
  DollarSign, Calendar, ExternalLink, ChevronDown, ChevronUp
} from 'lucide-react';
import Panel from '../../Panel';
import GlossaryTerm from '../../GlossaryTerm';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatCurrency, formatDate, formatDateTime } from '../../../utils/formatters';

const STATUS_BADGES = {
  active: { label: 'Active', color: 'text-terminal-green', bg: 'bg-terminal-green/20', border: 'border-terminal-green/30', icon: CheckCircle },
  pending: { label: 'Pending', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20', border: 'border-terminal-amber/30', icon: Clock },
  expired: { label: 'Expired', color: 'text-terminal-muted', bg: 'bg-terminal-muted/20', border: 'border-terminal-muted/30', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'text-terminal-red', bg: 'bg-terminal-red/20', border: 'border-terminal-red/30', icon: XCircle },
};

const CLAIM_STATUSES = {
  accruing: { label: 'Accruing', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20' },
  paid: { label: 'Paid', color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
  verified: { label: 'Verified', color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
  pending_verification: { label: 'Pending Verification', color: 'text-terminal-cyan', bg: 'bg-terminal-cyan/20' },
  no_claim: { label: 'No Claim', color: 'text-terminal-muted', bg: 'bg-terminal-muted/20' },
  denied: { label: 'Denied', color: 'text-terminal-red', bg: 'bg-terminal-red/20' },
};

const QUOTE_STATUSES = {
  submitted: { label: 'Submitted', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20' },
  under_review: { label: 'Under Review', color: 'text-terminal-cyan', bg: 'bg-terminal-cyan/20' },
  pending_lp_approval: { label: 'Structuring', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20' },
  lp_revision_requested: { label: 'Structuring', color: 'text-terminal-cyan', bg: 'bg-terminal-cyan/20' },
  lp_rejected: { label: 'Under Review', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20' },
  quote_issued: { label: 'Quote Issued', color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
  accepted: { label: 'Accepted', color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
  declined: { label: 'Declined', color: 'text-terminal-red', bg: 'bg-terminal-red/20' },
  expired: { label: 'Expired', color: 'text-terminal-muted', bg: 'bg-terminal-muted/20' },
};

/**
 * Panel 9d: Insurance Activity & Coverage Status
 * Active policy card, current month claim tracking, claim history,
 * cumulative net value, policy management, and quote requests list.
 */
export default function CoverageStatusPanel() {
  const [showClaimHistory, setShowClaimHistory] = useState(false);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/v1/insurance/coverage-status',
    { refreshInterval: 60 * 1000 }
  );

  const policy = data?.activePolicy;
  const currentClaim = data?.currentMonthClaim;
  const claimHistory = data?.claimHistory || [];
  const cumulativeStats = data?.cumulativeStats;
  const quoteRequests = data?.quoteRequests || [];

  const policyStatus = policy ? STATUS_BADGES[policy.status] || STATUS_BADGES.active : null;

  const netValue = cumulativeStats
    ? (cumulativeStats.totalClaimsReceived || 0) - (cumulativeStats.totalPremiumsPaid || 0)
    : null;

  return (
    <Panel
      title="Coverage Status"
      source={data?.source || 'Insurance Engine'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-terminal-green" />
        </div>
      }
    >
      {!policy && !loading ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Shield size={40} className="text-terminal-muted mb-3" />
            <p className="text-sm text-terminal-muted mb-1">No active coverage</p>
            <p className="text-xs text-terminal-muted mb-4">
              Explore coverage options backed by institutional capital partners to protect your mining revenue.
            </p>
            <button
              onClick={() => alert('Coverage Explorer — explore institutional capital partner options for mining revenue protection.')}
              className="flex items-center gap-2 px-4 py-2 bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/30 transition-colors text-xs"
            >
              <ExternalLink size={12} />
              Open Coverage Explorer
            </button>
          </div>

          {/* Quote Requests */}
          {quoteRequests.length > 0 && (
            <div className="border-t border-terminal-border pt-3">
              <p className="text-xs font-semibold text-terminal-text mb-2">Quote Requests</p>
              <div className="space-y-2">
                {quoteRequests.map((req, i) => {
                  const qs = QUOTE_STATUSES[req.status] || QUOTE_STATUSES.submitted;
                  return (
                    <div key={i} className="bg-terminal-bg/50 border border-terminal-border rounded p-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-terminal-text">
                          ${formatNumber(req.floorPrice, 2)}/PH/day | {req.termMonths}mo | {formatNumber(req.hashrateTH, 0)} TH/s
                        </p>
                        <p className="text-[10px] text-terminal-muted mt-0.5">
                          Submitted {formatDate(req.createdAt)}
                        </p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${qs.bg} ${qs.color}`}>
                        {qs.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : policy ? (
        <div className="space-y-4">
          {/* Active Policy Card */}
          <div className="bg-terminal-bg/50 border border-terminal-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText size={14} className="text-terminal-cyan" />
                <span className="text-xs font-semibold text-terminal-text">Policy {policy.policyNumber || '--'}</span>
              </div>
              {policyStatus && (
                <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded ${policyStatus.bg} ${policyStatus.color} border ${policyStatus.border}`}>
                  <policyStatus.icon size={10} />
                  {policyStatus.label}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-terminal-muted uppercase"><GlossaryTerm id="revenue_floor">Floor Price</GlossaryTerm></p>
                <p className="text-sm font-bold text-terminal-cyan font-sans">
                  ${formatNumber(policy.floorPrice, 2)}<span className="text-[10px] text-terminal-muted">/PH/day</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] text-terminal-muted uppercase">Monthly Premium</p>
                <p className="text-sm font-bold text-terminal-text font-sans">
                  {formatCurrency(policy.monthlyPremium, 'USD', 0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-terminal-muted uppercase">Covered Hashrate</p>
                <p className="text-sm font-bold text-terminal-text font-sans">
                  {formatNumber(policy.coveredHashrateTH, 0)} <span className="text-[10px] text-terminal-muted">TH/s</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] text-terminal-muted uppercase">Term</p>
                <p className="text-sm font-bold text-terminal-text">
                  {policy.termMonths || '--'} months
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-terminal-border text-[10px] text-terminal-muted">
              <span className="flex items-center gap-1">
                <Calendar size={10} />
                Start: {formatDate(policy.startDate)}
              </span>
              <span className="flex items-center gap-1">
                <Calendar size={10} />
                End: {formatDate(policy.endDate)}
              </span>
            </div>

            <button className="w-full mt-3 px-3 py-1.5 text-xs border border-terminal-border rounded text-terminal-muted hover:bg-terminal-border/50 hover:text-terminal-text transition-colors flex items-center justify-center gap-1.5">
              <FileText size={12} />
              View Terms & Conditions
            </button>
          </div>

          {/* Current Month Claim Status */}
          <div className="border-t border-terminal-border pt-3">
            <p className="text-xs font-semibold text-terminal-text mb-2 flex items-center gap-1.5">
              <DollarSign size={12} className="text-terminal-amber" />
              Current Month
            </p>
            {currentClaim ? (
              <div className="bg-terminal-bg/50 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-terminal-muted">{currentClaim.month || 'This Month'}</span>
                  {(() => {
                    const cs = CLAIM_STATUSES[currentClaim.status] || CLAIM_STATUSES.no_claim;
                    return (
                      <span className={`text-[10px] px-2 py-0.5 rounded ${cs.bg} ${cs.color}`}>
                        {cs.label}
                      </span>
                    );
                  })()}
                </div>
                {currentClaim.shortfallAmount != null && currentClaim.shortfallAmount > 0 ? (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-terminal-muted">Shortfall Amount</span>
                      <span className="text-terminal-amber font-sans">{formatCurrency(currentClaim.shortfallAmount, 'USD', 0)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-terminal-muted">Accrued Claim</span>
                      <span className="text-terminal-green font-sans">{formatCurrency(currentClaim.accruedAmount, 'USD', 0)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-terminal-muted">Days Accrued</span>
                      <span className="text-terminal-text font-sans">{currentClaim.daysAccrued || 0}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-terminal-green">
                    No shortfall detected this period. <GlossaryTerm id="hashprice">Hashprice</GlossaryTerm> above <GlossaryTerm id="revenue_floor">floor</GlossaryTerm>.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-terminal-muted">No claim data for current month.</p>
            )}
          </div>

          {/* Cumulative Net Value */}
          {cumulativeStats && (
            <div className="bg-terminal-bg/50 border border-terminal-border rounded p-3">
              <p className="text-xs font-semibold text-terminal-text mb-2">Cumulative Net Value</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-terminal-muted uppercase">Premiums Paid</p>
                  <p className="text-sm font-bold text-terminal-red font-sans">
                    {formatCurrency(cumulativeStats.totalPremiumsPaid, 'USD', 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-terminal-muted uppercase">Claims Received</p>
                  <p className="text-sm font-bold text-terminal-green font-sans">
                    {formatCurrency(cumulativeStats.totalClaimsReceived, 'USD', 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-terminal-muted uppercase">Net</p>
                  <p className={`text-sm font-bold font-sans ${netValue >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                    {netValue >= 0 ? '+' : ''}{formatCurrency(netValue, 'USD', 0)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Claim History */}
          <div className="border-t border-terminal-border pt-3">
            <button
              onClick={() => setShowClaimHistory(!showClaimHistory)}
              className="flex items-center justify-between w-full text-xs font-semibold text-terminal-text mb-2"
            >
              <span>Claim History ({claimHistory.length})</span>
              {showClaimHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showClaimHistory && claimHistory.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-terminal-border">
                      <th className="text-left py-1.5 text-terminal-muted font-normal">Month</th>
                      <th className="text-left py-1.5 text-terminal-muted font-normal">Status</th>
                      <th className="text-right py-1.5 text-terminal-muted font-normal">Gross</th>
                      <th className="text-right py-1.5 text-terminal-muted font-normal">Paid</th>
                      <th className="text-center py-1.5 text-terminal-muted font-normal">Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claimHistory.map((claim, i) => {
                      const cs = CLAIM_STATUSES[claim.status] || CLAIM_STATUSES.no_claim;
                      return (
                        <tr key={i} className="border-b border-terminal-border/30">
                          <td className="py-1.5 text-terminal-text">{claim.month}</td>
                          <td className="py-1.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${cs.bg} ${cs.color}`}>
                              {cs.label}
                            </span>
                          </td>
                          <td className="text-right py-1.5 font-sans text-terminal-text">
                            {formatCurrency(claim.grossClaim, 'USD', 0)}
                          </td>
                          <td className="text-right py-1.5 font-sans text-terminal-green">
                            {formatCurrency(claim.paidAmount, 'USD', 0)}
                          </td>
                          <td className="text-center py-1.5">
                            {claim.verified ? (
                              <CheckCircle size={12} className="text-terminal-green inline" />
                            ) : (
                              <Clock size={12} className="text-terminal-muted inline" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {showClaimHistory && claimHistory.length === 0 && (
              <p className="text-xs text-terminal-muted">No claims history yet.</p>
            )}
          </div>

          {/* Quote Requests */}
          {quoteRequests.length > 0 && (
            <div className="border-t border-terminal-border pt-3">
              <p className="text-xs font-semibold text-terminal-text mb-2">Quote Requests</p>
              <div className="space-y-2">
                {quoteRequests.map((req, i) => {
                  const qs = QUOTE_STATUSES[req.status] || QUOTE_STATUSES.submitted;
                  return (
                    <div key={i} className="bg-terminal-bg/50 border border-terminal-border rounded p-2 flex items-center justify-between">
                      <div>
                        <p className="text-[11px] text-terminal-text">
                          ${formatNumber(req.floorPrice, 2)} | {req.termMonths}mo | {formatNumber(req.hashrateTH, 0)} TH/s
                        </p>
                        <p className="text-[10px] text-terminal-muted">{formatDate(req.createdAt)}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${qs.bg} ${qs.color}`}>
                        {qs.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
