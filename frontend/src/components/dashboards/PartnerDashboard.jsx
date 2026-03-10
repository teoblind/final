import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import api from '../../lib/hooks/useApi';

export default function PartnerDashboard() {
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      try {
        const response = await api.get('/v1/partners/view');
        if (!cancelled) {
          setData(response.data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || err.message || 'Failed to load partner data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  // Generate 24 hourly bar values from data or use placeholder
  const hourlyLoad = data?.loadProfile || Array.from({ length: 24 }, () => 0);
  const maxHourlyLoad = Math.max(...hourlyLoad, 1);

  // Generate 30 daily bars from data or use placeholder
  const dailyConsumption = data?.dailyConsumption || Array.from({ length: 30 }, () => 0);
  const maxDaily = Math.max(...dailyConsumption, 1);

  const partnerName = data?.partnerCompanyName || user?.companyName || 'Partner';
  const tenantName = data?.tenantName || 'Tenant';

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
          <p className="text-lg font-semibold mb-2">Error Loading Partner Data</p>
          <p className="text-sm text-terminal-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Limited view banner */}
      <div className="mb-4 px-4 py-2 bg-terminal-amber/10 border border-terminal-amber/30 rounded text-terminal-amber text-xs">
        Limited View &mdash; Data shared by {tenantName}
      </div>

      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-terminal-green">
          Partner View &mdash; {partnerName}
        </h2>
        <p className="text-xs text-terminal-muted mt-1">
          Viewing: {tenantName}
        </p>
      </div>

      {/* Top Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Energy Consumption Card */}
        <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
          <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
            Energy Consumption
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-terminal-muted">Current Load</p>
              <p className="text-2xl font-bold text-terminal-green">
                {data?.currentMW != null ? data.currentMW.toFixed(1) : '--'}
              </p>
              <p className="text-xs text-terminal-muted">MW</p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">Total Capacity</p>
              <p className="text-2xl font-bold text-terminal-text">
                {data?.totalCapacityMW != null ? data.totalCapacityMW.toFixed(1) : '--'}
              </p>
              <p className="text-xs text-terminal-muted">MW</p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">Utilization</p>
              <p className="text-2xl font-bold text-terminal-cyan">
                {data?.utilizationPct != null
                  ? `${data.utilizationPct.toFixed(1)}%`
                  : '--'}
              </p>
              <p className="text-xs text-terminal-muted">of capacity</p>
            </div>
          </div>
        </div>

        {/* Curtailment Today Card */}
        <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
          <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
            Curtailment Today
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-terminal-muted">MW Curtailed</p>
              <p className="text-2xl font-bold text-terminal-amber">
                {data?.curtailmentMW != null ? data.curtailmentMW.toFixed(1) : '--'}
              </p>
              <p className="text-xs text-terminal-muted">MW</p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">Hours Curtailed</p>
              <p className="text-2xl font-bold text-terminal-amber">
                {data?.curtailmentHours != null ? data.curtailmentHours.toFixed(1) : '--'}
              </p>
              <p className="text-xs text-terminal-muted">hours</p>
            </div>
          </div>
        </div>
      </div>

      {/* Load Profile Chart (24h) */}
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4 mb-6">
        <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
          Load Profile &mdash; 24h
        </h3>
        <div className="flex items-end gap-1 h-40">
          {hourlyLoad.map((value, index) => {
            const heightPct = maxHourlyLoad > 0 ? (value / maxHourlyLoad) * 100 : 0;
            return (
              <div
                key={index}
                className="flex-1 flex flex-col items-center justify-end"
              >
                <div
                  className="w-full bg-terminal-green/70 rounded-t hover:bg-terminal-green transition-colors min-h-[2px]"
                  style={{ height: `${Math.max(heightPct, 1)}%` }}
                  title={`${String(index).padStart(2, '0')}:00 — ${value.toFixed(1)} MW`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-[10px] text-terminal-muted">00:00</span>
          <span className="text-[10px] text-terminal-muted">06:00</span>
          <span className="text-[10px] text-terminal-muted">12:00</span>
          <span className="text-[10px] text-terminal-muted">18:00</span>
          <span className="text-[10px] text-terminal-muted">23:00</span>
        </div>
      </div>

      {/* Monthly Summary */}
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4 mb-6">
        <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
          Monthly Summary
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <p className="text-xs text-terminal-muted">Avg Load</p>
            <p className="text-lg font-bold text-terminal-text">
              {data?.monthly?.avgLoadMW != null
                ? `${data.monthly.avgLoadMW.toFixed(1)} MW`
                : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">Peak</p>
            <p className="text-lg font-bold text-terminal-green">
              {data?.monthly?.peakMW != null
                ? `${data.monthly.peakMW.toFixed(1)} MW`
                : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">Minimum</p>
            <p className="text-lg font-bold text-terminal-text">
              {data?.monthly?.minMW != null
                ? `${data.monthly.minMW.toFixed(1)} MW`
                : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">Curtailment Hours</p>
            <p className="text-lg font-bold text-terminal-amber">
              {data?.monthly?.curtailmentHours != null
                ? data.monthly.curtailmentHours
                : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">Total MWh</p>
            <p className="text-lg font-bold text-terminal-text">
              {data?.monthly?.totalMWh != null
                ? data.monthly.totalMWh.toLocaleString()
                : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">DR Events</p>
            <p className="text-lg font-bold text-terminal-cyan">
              {data?.monthly?.demandResponseEvents != null
                ? data.monthly.demandResponseEvents
                : '--'}
            </p>
          </div>
        </div>
      </div>

      {/* Daily Consumption Chart (30d) */}
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4 mb-6">
        <h3 className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
          Daily Consumption &mdash; 30d
        </h3>
        <div className="flex items-end gap-0.5 h-32">
          {dailyConsumption.map((value, index) => {
            const heightPct = maxDaily > 0 ? (value / maxDaily) * 100 : 0;
            return (
              <div
                key={index}
                className="flex-1 flex flex-col items-center justify-end"
              >
                <div
                  className="w-full bg-terminal-cyan/60 rounded-t hover:bg-terminal-cyan transition-colors min-h-[2px]"
                  style={{ height: `${Math.max(heightPct, 1)}%` }}
                  title={`Day ${index + 1} — ${value.toFixed(1)} MWh`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-[10px] text-terminal-muted">Day 1</span>
          <span className="text-[10px] text-terminal-muted">Day 15</span>
          <span className="text-[10px] text-terminal-muted">Day 30</span>
        </div>
      </div>

      {/* Export Buttons */}
      <div className="flex gap-3">
        <button onClick={() => alert('CSV report download started.')} className="px-4 py-2 bg-terminal-panel border border-terminal-border rounded text-terminal-text text-sm hover:border-terminal-green transition-colors">
          Download Report (CSV)
        </button>
        <button onClick={() => alert('PDF report download started.')} className="px-4 py-2 bg-terminal-panel border border-terminal-border rounded text-terminal-text text-sm hover:border-terminal-green transition-colors">
          Download Report (PDF)
        </button>
      </div>
    </div>
  );
}
