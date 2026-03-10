import React, { useState } from 'react';
import {
  Users, Plus, ChevronDown, ChevronUp, Edit, RefreshCw,
  DollarSign, TrendingUp, AlertTriangle, CheckCircle
} from 'lucide-react';
import Panel from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';
import { formatNumber, formatCurrency } from '../../../utils/formatters';

/**
 * Panel 9h: LP Management (Sangha Admin)
 * CRUD for balance sheet partners, capital tracking, per-LP exposure.
 */
export default function LPManagementPanel() {
  const [expandedLP, setExpandedLP] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', shortName: '', contactEmail: '', capitalCommitted: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/v1/admin/insurance/lp-partners',
    { refreshInterval: 30 * 1000 }
  );

  const { data: exposureData } = useApi(
    '/v1/admin/insurance/lp-exposure',
    { refreshInterval: 60 * 1000 }
  );

  const { data: revenueData } = useApi(
    '/v1/admin/insurance/revenue',
    { refreshInterval: 60 * 1000 }
  );

  const partners = data?.partners || [];
  const exposureMap = {};
  (exposureData?.exposure || []).forEach(e => { exposureMap[e.lpId] = e; });
  const revenue = revenueData?.revenue || {};

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await postApi('/v1/admin/insurance/lp-partners', {
        name: createForm.name,
        shortName: createForm.shortName,
        contactEmail: createForm.contactEmail,
        capitalCommitted: parseFloat(createForm.capitalCommitted) || 0,
      });
      setShowCreateForm(false);
      setCreateForm({ name: '', shortName: '', contactEmail: '', capitalCommitted: '' });
      refetch();
    } catch (err) {
      setCreateError(err.response?.data?.error || err.message || 'Failed to create LP');
    } finally {
      setCreating(false);
    }
  };

  const getStatusBadge = (status) => {
    const config = {
      active: { color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
      inactive: { color: 'text-terminal-muted', bg: 'bg-terminal-muted/20' },
      onboarding: { color: 'text-terminal-amber', bg: 'bg-terminal-amber/20' },
    };
    const c = config[status] || config.active;
    return <span className={`text-[10px] px-2 py-0.5 rounded ${c.bg} ${c.color}`}>{status || 'active'}</span>;
  };

  return (
    <Panel
      title="LP Management"
      source="Sangha Admin"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex items-center gap-2">
          <Users size={14} className="text-terminal-cyan" />
          <span className="text-xs text-terminal-muted">Phase 9b</span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Sangha Revenue Summary */}
        {revenue && (
          <div className="bg-terminal-bg/50 border border-terminal-green/20 rounded p-3">
            <p className="text-[10px] text-terminal-muted uppercase mb-2">Sangha Revenue (Annualized)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-terminal-muted">Structuring Fees</p>
                <p className="text-sm font-bold text-terminal-green font-sans">{formatCurrency(revenue.totalStructuringFees, 'USD', 0)}</p>
              </div>
              <div>
                <p className="text-[10px] text-terminal-muted">Management Fees</p>
                <p className="text-sm font-bold text-terminal-green font-sans">{formatCurrency(revenue.totalManagementFees, 'USD', 0)}</p>
              </div>
              <div>
                <p className="text-[10px] text-terminal-muted">Total Revenue</p>
                <p className="text-sm font-bold text-terminal-green font-sans">
                  {formatCurrency((revenue.totalStructuringFees || 0) + (revenue.totalManagementFees || 0), 'USD', 0)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Add LP Button */}
        <div className="flex justify-between items-center">
          <p className="text-xs font-semibold text-terminal-text">Balance Sheet Partners ({partners.length})</p>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors"
          >
            <Plus size={12} />
            Add LP
          </button>
        </div>

        {/* Create Form */}
        {showCreateForm && (
          <div className="bg-terminal-bg/50 border border-terminal-green/20 rounded p-3 space-y-2">
            <p className="text-xs font-semibold text-terminal-green">New Balance Sheet Partner</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-terminal-muted block mb-1">Name *</label>
                <input
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-green"
                  placeholder="Capital Corp LLC"
                />
              </div>
              <div>
                <label className="text-[10px] text-terminal-muted block mb-1">Short Name</label>
                <input
                  value={createForm.shortName}
                  onChange={e => setCreateForm(f => ({ ...f, shortName: e.target.value }))}
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-green"
                  placeholder="CC"
                />
              </div>
              <div>
                <label className="text-[10px] text-terminal-muted block mb-1">Contact Email *</label>
                <input
                  value={createForm.contactEmail}
                  onChange={e => setCreateForm(f => ({ ...f, contactEmail: e.target.value }))}
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-green"
                  placeholder="contact@capital.com"
                />
              </div>
              <div>
                <label className="text-[10px] text-terminal-muted block mb-1">Capital Committed ($)</label>
                <input
                  type="number"
                  value={createForm.capitalCommitted}
                  onChange={e => setCreateForm(f => ({ ...f, capitalCommitted: e.target.value }))}
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-sans focus:outline-none focus:border-terminal-green"
                  placeholder="10000000"
                />
              </div>
            </div>
            {createError && (
              <p className="text-xs text-terminal-red flex items-center gap-1"><AlertTriangle size={12} />{createError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowCreateForm(false); setCreateError(null); }}
                className="flex-1 px-3 py-1.5 text-xs border border-terminal-border rounded text-terminal-muted hover:bg-terminal-border"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !createForm.name || !createForm.contactEmail}
                className="flex-1 px-3 py-1.5 text-xs bg-terminal-green text-terminal-bg rounded font-semibold disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create LP'}
              </button>
            </div>
          </div>
        )}

        {/* LP Partner List */}
        {partners.length === 0 ? (
          <div className="text-center py-6">
            <Users size={32} className="text-terminal-muted mx-auto mb-2" />
            <p className="text-sm text-terminal-muted">No balance sheet partners configured.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {partners.map(p => {
              const exp = exposureMap[p.id] || {};
              const isExpanded = expandedLP === p.id;

              return (
                <div key={p.id} className="border border-terminal-border rounded-lg">
                  <div
                    className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-terminal-border/20 transition-colors"
                    onClick={() => setExpandedLP(isExpanded ? null : p.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-terminal-cyan/20 text-terminal-cyan flex items-center justify-center text-xs font-bold">
                        {(p.shortName || p.name || '?').substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs text-terminal-text font-medium">{p.name}</p>
                        <p className="text-[10px] text-terminal-muted">{p.contactEmail}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(p.status)}
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-terminal-green font-sans">{formatCurrency(exp.capitalDeployed || p.capitalDeployed, 'USD', 0)}</p>
                        <p className="text-[10px] text-terminal-muted">deployed</p>
                      </div>
                      {isExpanded ? <ChevronUp size={14} className="text-terminal-muted" /> : <ChevronDown size={14} className="text-terminal-muted" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-terminal-border/30">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                        <div className="bg-terminal-bg/50 rounded p-2">
                          <p className="text-[10px] text-terminal-muted">Capital Committed</p>
                          <p className="text-sm font-bold text-terminal-text font-sans">{formatCurrency(p.capitalCommitted, 'USD', 0)}</p>
                        </div>
                        <div className="bg-terminal-bg/50 rounded p-2">
                          <p className="text-[10px] text-terminal-muted">Capital Deployed</p>
                          <p className="text-sm font-bold text-terminal-green font-sans">{formatCurrency(exp.capitalDeployed || 0, 'USD', 0)}</p>
                        </div>
                        <div className="bg-terminal-bg/50 rounded p-2">
                          <p className="text-[10px] text-terminal-muted">Active Policies</p>
                          <p className="text-sm font-bold text-terminal-text">{exp.activePolicies || 0}</p>
                        </div>
                        <div className="bg-terminal-bg/50 rounded p-2">
                          <p className="text-[10px] text-terminal-muted">Monthly Premium</p>
                          <p className="text-sm font-bold text-terminal-cyan font-sans">{formatCurrency(exp.monthlyPremium || 0, 'USD', 0)}</p>
                        </div>
                        <div className="bg-terminal-bg/50 rounded p-2">
                          <p className="text-[10px] text-terminal-muted">Covered Hashrate</p>
                          <p className="text-sm font-bold text-terminal-text font-sans">
                            {formatNumber((exp.coveredHashrate || 0) / 1000, 1)} PH/s
                          </p>
                        </div>
                        <div className="bg-terminal-bg/50 rounded p-2">
                          <p className="text-[10px] text-terminal-muted">Claims Paid</p>
                          <p className="text-sm font-bold text-terminal-red font-sans">{formatCurrency(exp.totalClaimsPaid || 0, 'USD', 0)}</p>
                        </div>
                        <div className="bg-terminal-bg/50 rounded p-2">
                          <p className="text-[10px] text-terminal-muted">Pending Allocations</p>
                          <p className="text-sm font-bold text-terminal-amber">{exp.pendingAllocations || 0}</p>
                        </div>
                        <div className="bg-terminal-bg/50 rounded p-2">
                          <p className="text-[10px] text-terminal-muted">Utilization</p>
                          <p className="text-sm font-bold text-terminal-text font-sans">
                            {p.capitalCommitted > 0
                              ? `${formatNumber(((exp.capitalDeployed || 0) / p.capitalCommitted) * 100, 1)}%`
                              : '--'}
                          </p>
                        </div>
                      </div>

                      {p.feeStructure && (
                        <div className="mt-3 bg-terminal-bg/50 rounded p-2">
                          <p className="text-[10px] text-terminal-muted mb-1 font-semibold">Fee Structure</p>
                          <div className="flex gap-4 text-xs">
                            <span className="text-terminal-muted">
                              Structuring: <span className="text-terminal-text font-sans">{p.feeStructure.structuringFeePercent || 5}%</span>
                            </span>
                            <span className="text-terminal-muted">
                              Management: <span className="text-terminal-text font-sans">{p.feeStructure.managementFeePercent || 1}%</span>
                            </span>
                          </div>
                        </div>
                      )}

                      {p.preferredInstruments && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(typeof p.preferredInstruments === 'string' ? p.preferredInstruments.split(',') : []).map((inst, i) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-terminal-cyan/10 text-terminal-cyan">
                              {inst.trim()}
                            </span>
                          ))}
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
