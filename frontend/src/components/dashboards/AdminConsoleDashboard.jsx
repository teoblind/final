import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import api from '../../lib/hooks/useApi';

const UnderwritingQueuePanel = lazy(() => import('../panels/insurance/UnderwritingQueuePanel'));
const PortfolioRiskPanel = lazy(() => import('../panels/insurance/PortfolioRiskPanel'));
const CalibrationStatusPanel = lazy(() => import('../panels/insurance/CalibrationStatusPanel'));
const LPManagementPanel = lazy(() => import('../panels/insurance/LPManagementPanel'));

export default function AdminConsoleDashboard() {
  const [aggregate, setAggregate] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('capacityMW');
  const [sortDirection, setSortDirection] = useState('desc');

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      setLoading(true);
      try {
        const [aggRes, tenantRes] = await Promise.all([
          api.get('/v1/admin/aggregate'),
          api.get('/v1/admin/tenants'),
        ]);

        if (!cancelled) {
          setAggregate(aggRes.data);
          setTenants(tenantRes.data?.tenants || tenantRes.data || []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.error || err.message || 'Failed to load admin data'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sorted tenants
  const sortedTenants = useMemo(() => {
    const sorted = [...tenants];
    sorted.sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sortDirection === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
    return sorted;
  }, [tenants, sortField, sortDirection]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortIndicator = (field) => {
    if (sortField !== field) return '';
    return sortDirection === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const getStatusBadge = (status) => {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'active') {
      return (
        <span className="px-2 py-0.5 text-xs rounded bg-terminal-green/10 text-terminal-green border border-terminal-green/30">
          Active
        </span>
      );
    }
    if (normalized === 'trial') {
      return (
        <span className="px-2 py-0.5 text-xs rounded bg-terminal-amber/10 text-terminal-amber border border-terminal-amber/30">
          Trial
        </span>
      );
    }
    if (normalized === 'suspended') {
      return (
        <span className="px-2 py-0.5 text-xs rounded bg-terminal-red/10 text-terminal-red border border-terminal-red/30">
          Suspended
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 text-xs rounded bg-terminal-panel text-terminal-muted border border-terminal-border">
        {status || 'Unknown'}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center py-24">
          <div className="spinner w-10 h-10" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="flex flex-col items-center justify-center py-24 text-terminal-red">
          <p className="text-lg font-semibold mb-2">Admin Console Error</p>
          <p className="text-sm text-terminal-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-terminal-green">
          AMPERA &mdash; Admin Console
        </h2>
        <p className="text-xs text-terminal-muted mt-1">
          Platform-wide metrics and tenant management
        </p>
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Tenants"
          value={aggregate?.totalTenants ?? '--'}
          color="text-terminal-green"
        />
        <StatCard
          label="Total Capacity"
          value={
            aggregate?.totalCapacityGW != null
              ? `${aggregate.totalCapacityGW.toFixed(2)} GW`
              : '--'
          }
          color="text-terminal-green"
        />
        <StatCard
          label="Total Hashrate"
          value={
            aggregate?.totalHashrateEH != null
              ? `${aggregate.totalHashrateEH.toFixed(2)} EH/s`
              : '--'
          }
          color="text-terminal-green"
        />
        <StatCard
          label="Active GPUs"
          value={
            aggregate?.activeGPUs != null
              ? aggregate.activeGPUs.toLocaleString()
              : '--'
          }
          color="text-terminal-cyan"
        />
      </div>

      {/* Network Intelligence */}
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4 mb-6">
        <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
          Network Intelligence
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-terminal-muted">BTC Network Coverage</p>
            <p className="text-xl font-bold text-terminal-green">
              {aggregate?.networkCoveragePct != null
                ? `${aggregate.networkCoveragePct.toFixed(2)}%`
                : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">Avg Fleet Efficiency</p>
            <p className="text-xl font-bold text-terminal-text">
              {aggregate?.avgEfficiencyJTH != null
                ? `${aggregate.avgEfficiencyJTH.toFixed(1)} J/TH`
                : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">Avg Curtailment Savings</p>
            <p className="text-xl font-bold text-terminal-amber">
              {aggregate?.avgCurtailmentSavingsPct != null
                ? `${aggregate.avgCurtailmentSavingsPct.toFixed(1)}%`
                : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">Agent Adoption</p>
            <p className="text-xl font-bold text-terminal-cyan">
              {aggregate?.agentAdoptionPct != null
                ? `${aggregate.agentAdoptionPct.toFixed(1)}%`
                : '--'}
            </p>
          </div>
        </div>
      </div>

      {/* Tenant List Table */}
      <div className="bg-terminal-panel border border-terminal-border rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-terminal-border">
          <h3 className="text-sm font-semibold text-terminal-text">
            Tenants ({tenants.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-terminal-border text-terminal-muted text-xs uppercase tracking-wider">
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:text-terminal-text"
                  onClick={() => handleSort('name')}
                >
                  Name{sortIndicator('name')}
                </th>
                <th
                  className="px-4 py-2 text-right cursor-pointer hover:text-terminal-text"
                  onClick={() => handleSort('capacityMW')}
                >
                  Capacity MW{sortIndicator('capacityMW')}
                </th>
                <th
                  className="px-4 py-2 text-right cursor-pointer hover:text-terminal-text"
                  onClick={() => handleSort('hashrate')}
                >
                  Hashrate{sortIndicator('hashrate')}
                </th>
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:text-terminal-text"
                  onClick={() => handleSort('plan')}
                >
                  Plan{sortIndicator('plan')}
                </th>
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:text-terminal-text"
                  onClick={() => handleSort('status')}
                >
                  Status{sortIndicator('status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTenants.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-terminal-muted"
                  >
                    No tenants found
                  </td>
                </tr>
              ) : (
                sortedTenants.map((tenant, index) => (
                  <tr
                    key={tenant.id || index}
                    className="border-b border-terminal-border/50 hover:bg-terminal-bg/50 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-terminal-text font-medium">
                      {tenant.name || '--'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-terminal-text">
                      {tenant.capacityMW != null
                        ? tenant.capacityMW.toLocaleString()
                        : '--'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-terminal-text">
                      {tenant.hashrate != null
                        ? `${tenant.hashrate.toLocaleString()} TH/s`
                        : '--'}
                    </td>
                    <td className="px-4 py-2.5 text-terminal-muted">
                      {tenant.plan || '--'}
                    </td>
                    <td className="px-4 py-2.5">
                      {getStatusBadge(tenant.status)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Underwriting Pipeline */}
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4 mb-6">
        <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
          Underwriting Pipeline
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-terminal-muted">Ready</p>
            <p className="text-2xl font-bold text-terminal-green">
              {aggregate?.underwriting?.ready ?? '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">Insufficient Data</p>
            <p className="text-2xl font-bold text-terminal-amber">
              {aggregate?.underwriting?.insufficientData ?? '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">Active Policies</p>
            <p className="text-2xl font-bold text-terminal-cyan">
              {aggregate?.underwriting?.activePolicies ?? '--'}
            </p>
          </div>
        </div>
      </div>

      {/* Phase 9: Insurance Admin Panels */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-terminal-green mb-3">Insurance & Underwriting</h3>
        <Suspense fallback={<div className="flex items-center justify-center py-8"><div className="spinner w-8 h-8" /></div>}>
          <div className="space-y-4">
            <UnderwritingQueuePanel />
            <LPManagementPanel />
            <PortfolioRiskPanel />
            <CalibrationStatusPanel />
          </div>
        </Suspense>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button className="px-4 py-2 bg-terminal-green text-[#0a0a0a] font-semibold rounded hover:bg-terminal-green/90 transition-colors text-sm">
          Generate Network Report
        </button>
        <button className="px-4 py-2 bg-terminal-panel border border-terminal-border rounded text-terminal-text text-sm hover:border-terminal-green transition-colors">
          Export Underwriting Data
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, color = 'text-terminal-text' }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
      <p className="text-xs text-terminal-muted uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
