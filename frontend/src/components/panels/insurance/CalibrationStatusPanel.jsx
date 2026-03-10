import React, { useState, useEffect } from 'react';
import {
  Database, RefreshCw, CheckCircle, AlertTriangle, XCircle, Clock,
  Upload, Server, Calendar, Wifi, WifiOff
} from 'lucide-react';
import Panel from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';
import { formatNumber, formatDate, formatDateTime } from '../../../utils/formatters';

const QUALITY_BADGES = {
  good: { label: 'Good', color: 'text-terminal-green', bg: 'bg-terminal-green/20', icon: CheckCircle },
  partial: { label: 'Partial', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20', icon: AlertTriangle },
  missing: { label: 'Missing', color: 'text-terminal-red', bg: 'bg-terminal-red/20', icon: XCircle },
  stale: { label: 'Stale', color: 'text-terminal-muted', bg: 'bg-terminal-muted/20', icon: Clock },
};

const DATA_QUALITY_FIELDS = [
  { key: 'fleetComposition', label: 'Fleet Composition', icon: Server },
  { key: 'curtailmentData', label: 'Curtailment Data', icon: Clock },
  { key: 'energyProfiles', label: 'Energy Profiles', icon: Database },
  { key: 'poolData', label: 'Pool Data', icon: Database },
];

const EXPORT_STATUSES = {
  completed: { label: 'Completed', color: 'text-terminal-green', bg: 'bg-terminal-green/20' },
  in_progress: { label: 'In Progress', color: 'text-terminal-cyan', bg: 'bg-terminal-cyan/20' },
  failed: { label: 'Failed', color: 'text-terminal-red', bg: 'bg-terminal-red/20' },
  pending: { label: 'Pending', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20' },
};

/**
 * Panel 9g: Calibration Status (Sangha Admin)
 * Shows last export info, data quality indicators, export history,
 * force export, SanghaModel health check, and next scheduled export.
 */
export default function CalibrationStatusPanel() {
  const [forceExporting, setForceExporting] = useState(false);
  const [countdown, setCountdown] = useState(null);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/v1/admin/insurance/calibration',
    { refreshInterval: 30 * 1000 }
  );

  const lastExport = data?.lastExport;
  const dataQuality = data?.dataQuality || {};
  const exportHistory = data?.exportHistory || [];
  const modelHealth = data?.modelServiceHealth;
  const nextScheduledExport = data?.nextScheduledExport;

  // Countdown timer for next scheduled export
  useEffect(() => {
    if (!nextScheduledExport) {
      setCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const now = new Date().getTime();
      const target = new Date(nextScheduledExport).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setCountdown('Now');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m ${seconds}s`);
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextScheduledExport]);

  const handleForceExport = async () => {
    setForceExporting(true);
    try {
      await postApi('/v1/admin/insurance/calibration/export');
      await refetch();
    } catch (err) {
      console.error('Force export failed:', err);
    } finally {
      setForceExporting(false);
    }
  };

  const isConnected = modelHealth?.status === 'healthy' || modelHealth?.status === 'connected';

  return (
    <Panel
      title="Calibration Status"
      source={data?.source || 'Sangha Admin'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex items-center gap-2">
          <Database size={14} className="text-terminal-cyan" />
          <span className="text-xs text-terminal-muted">Admin</span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* SanghaModel Connection Status */}
        <div className={`flex items-center justify-between rounded px-3 py-2 ${
          isConnected
            ? 'bg-terminal-green/10 border border-terminal-green/20'
            : 'bg-terminal-red/10 border border-terminal-red/20'
        }`}>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <Wifi size={14} className="text-terminal-green" />
            ) : (
              <WifiOff size={14} className="text-terminal-red" />
            )}
            <span className="text-xs text-terminal-text">SanghaModel Service</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-terminal-green' : 'bg-terminal-red animate-pulse'}`} />
            <span className={`text-xs font-medium ${isConnected ? 'text-terminal-green' : 'text-terminal-red'}`}>
              {modelHealth?.status ? modelHealth.status.charAt(0).toUpperCase() + modelHealth.status.slice(1) : 'Unknown'}
            </span>
          </div>
        </div>

        {/* Last Export Info */}
        <div className="bg-terminal-bg/50 border border-terminal-border rounded p-3">
          <p className="text-xs font-semibold text-terminal-text mb-2 flex items-center gap-1.5">
            <Upload size={12} className="text-terminal-cyan" />
            Last Calibration Export
          </p>
          {lastExport ? (
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-[10px] text-terminal-muted uppercase">Timestamp</p>
                <p className="text-terminal-text font-sans text-[11px]">
                  {formatDateTime(lastExport.timestamp)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-terminal-muted uppercase">Tenants</p>
                <p className="text-terminal-text font-sans">
                  {lastExport.tenantsIncluded || 0}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-terminal-muted uppercase">Total Hashrate</p>
                <p className="text-terminal-cyan font-sans">
                  {formatNumber((lastExport.totalHashrateTH || 0) / 1000, 1)} PH/s
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-terminal-muted">No exports recorded yet.</p>
          )}
        </div>

        {/* Next Scheduled Export */}
        {nextScheduledExport && (
          <div className="flex items-center justify-between bg-terminal-bg/50 rounded px-3 py-2">
            <div className="flex items-center gap-2">
              <Calendar size={12} className="text-terminal-muted" />
              <span className="text-xs text-terminal-muted">Next Scheduled Export</span>
            </div>
            <span className="text-xs font-bold text-terminal-amber font-sans">
              {countdown || '--'}
            </span>
          </div>
        )}

        {/* Data Quality Indicators */}
        <div className="border-t border-terminal-border pt-3">
          <p className="text-xs font-semibold text-terminal-text mb-2">Data Quality</p>
          <div className="grid grid-cols-2 gap-2">
            {DATA_QUALITY_FIELDS.map(field => {
              const quality = dataQuality[field.key] || 'missing';
              const badge = QUALITY_BADGES[quality] || QUALITY_BADGES.missing;
              const BadgeIcon = badge.icon;
              const FieldIcon = field.icon;
              return (
                <div
                  key={field.key}
                  className="flex items-center justify-between bg-terminal-bg/50 rounded px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <FieldIcon size={12} className="text-terminal-muted" />
                    <span className="text-xs text-terminal-text">{field.label}</span>
                  </div>
                  <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${badge.bg} ${badge.color}`}>
                    <BadgeIcon size={10} />
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Force Export Button */}
        <button
          onClick={handleForceExport}
          disabled={forceExporting || !isConnected}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/30 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={forceExporting ? 'animate-spin' : ''} />
          {forceExporting ? 'Exporting...' : 'Force Calibration Export'}
        </button>
        {!isConnected && (
          <p className="text-[10px] text-terminal-red text-center -mt-2">
            SanghaModel service unavailable. Cannot export.
          </p>
        )}

        {/* Export History Table */}
        <div className="border-t border-terminal-border pt-3">
          <p className="text-xs font-semibold text-terminal-text mb-2">Export History</p>
          {exportHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border">
                    <th className="text-left py-1.5 text-terminal-muted font-normal">Date</th>
                    <th className="text-left py-1.5 text-terminal-muted font-normal">Version</th>
                    <th className="text-right py-1.5 text-terminal-muted font-normal">Tenants</th>
                    <th className="text-right py-1.5 text-terminal-muted font-normal">Hashrate</th>
                    <th className="text-center py-1.5 text-terminal-muted font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {exportHistory.map((exp, i) => {
                    const es = EXPORT_STATUSES[exp.status] || EXPORT_STATUSES.pending;
                    return (
                      <tr key={i} className="border-b border-terminal-border/30">
                        <td className="py-1.5 text-terminal-text font-sans text-[11px]">
                          {formatDate(exp.date || exp.timestamp)}
                        </td>
                        <td className="py-1.5 text-terminal-muted">
                          {exp.version || '--'}
                        </td>
                        <td className="text-right py-1.5 text-terminal-text font-sans">
                          {exp.tenants || 0}
                        </td>
                        <td className="text-right py-1.5 text-terminal-cyan font-sans">
                          {formatNumber((exp.hashrateTH || 0) / 1000, 1)} PH
                        </td>
                        <td className="text-center py-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${es.bg} ${es.color}`}>
                            {es.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-terminal-muted text-center py-3">No export history available.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
