import React, { useState } from 'react';
import {
  Shield, RefreshCw, AlertTriangle, CheckCircle, Info, TrendingUp, Activity
} from 'lucide-react';
import Panel from '../../Panel';
import GlossaryTerm from '../../GlossaryTerm';
import { useApi, postApi } from '../../../hooks/useApi';
import { formatNumber, formatDateTime } from '../../../utils/formatters';

/**
 * Panel 9a: Risk Profile Overview
 * Shows composite risk score with circular gauge, key findings,
 * fleet efficiency percentile, energy cost percentile, and natural language summary.
 */
export default function RiskProfilePanel() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/v1/insurance/risk-profile',
    { refreshInterval: 5 * 60 * 1000 }
  );

  const assessment = data?.assessment;
  const riskScore = assessment?.compositeRiskScore;
  const findings = assessment?.keyFindings || [];
  const summary = assessment?.summary;
  const fleetEfficiencyPercentile = assessment?.fleetEfficiencyPercentile;
  const energyCostPercentile = assessment?.energyCostPercentile;
  const modelVersion = assessment?.modelVersion;
  const assessedAt = assessment?.assessedAt;

  const getRiskTier = (score) => {
    if (score == null) return { label: 'N/A', color: 'text-terminal-muted', bg: 'bg-terminal-muted/20', stroke: '#666' };
    if (score <= 30) return { label: 'LOW RISK', color: 'text-terminal-green', bg: 'bg-terminal-green/20', stroke: '#00d26a' };
    if (score <= 60) return { label: 'MEDIUM RISK', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20', stroke: '#ffb800' };
    return { label: 'HIGH RISK', color: 'text-terminal-red', bg: 'bg-terminal-red/20', stroke: '#ff3b30' };
  };

  const tier = getRiskTier(riskScore);

  // SVG circular gauge parameters
  const gaugeRadius = 54;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeProgress = riskScore != null ? (riskScore / 100) * gaugeCircumference : 0;
  const gaugeDashoffset = gaugeCircumference - gaugeProgress;

  const handleRefreshAssessment = async () => {
    setRefreshing(true);
    try {
      await postApi('/v1/insurance/risk-profile/refresh');
      await refetch();
    } catch (err) {
      console.error('Failed to refresh assessment:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const hasAssessment = assessment != null && riskScore != null;

  return (
    <Panel
      title="Risk Profile"
      source={data?.source || 'SanghaModel'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-terminal-cyan" />
          <span className="text-xs text-terminal-muted">Phase 9</span>
        </div>
      }
    >
      {!hasAssessment && !loading ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Shield size={40} className="text-terminal-muted mb-3" />
          <p className="text-sm text-terminal-muted mb-1">No assessment available</p>
          <p className="text-xs text-terminal-muted mb-4">
            Click Refresh to run an initial risk assessment on your fleet.
          </p>
          <button
            onClick={handleRefreshAssessment}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors text-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Assessing...' : 'Refresh Assessment'}
          </button>
        </div>
      ) : hasAssessment ? (
        <div className="space-y-4">
          {/* Circular Gauge + Score */}
          <div className="flex items-center gap-6">
            <div className="relative flex-shrink-0">
              <svg width="130" height="130" viewBox="0 0 130 130">
                {/* Background circle */}
                <circle
                  cx="65"
                  cy="65"
                  r={gaugeRadius}
                  fill="none"
                  stroke="#222"
                  strokeWidth="8"
                />
                {/* Progress arc */}
                <circle
                  cx="65"
                  cy="65"
                  r={gaugeRadius}
                  fill="none"
                  stroke={tier.stroke}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={gaugeCircumference}
                  strokeDashoffset={gaugeDashoffset}
                  transform="rotate(-90 65 65)"
                  className="transition-all duration-700 ease-out"
                />
                {/* Score text */}
                <text
                  x="65"
                  y="60"
                  textAnchor="middle"
                  className={`text-3xl font-bold ${tier.color}`}
                  fill="currentColor"
                  style={{ fontSize: '28px', fontWeight: 700 }}
                >
                  {riskScore}
                </text>
                <text
                  x="65"
                  y="80"
                  textAnchor="middle"
                  fill="#666"
                  style={{ fontSize: '10px' }}
                >
                  / 100
                </text>
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold ${tier.bg} ${tier.color} mb-2`}>
                {riskScore <= 30 ? <CheckCircle size={12} /> : riskScore <= 60 ? <AlertTriangle size={12} /> : <AlertTriangle size={12} />}
                {tier.label}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="bg-terminal-bg/50 rounded p-2">
                  <p className="text-[10px] text-terminal-muted uppercase">Fleet Efficiency</p>
                  <p className="text-sm font-bold text-terminal-text">
                    {fleetEfficiencyPercentile != null ? `P${formatNumber(fleetEfficiencyPercentile, 0)}` : '--'}
                  </p>
                </div>
                <div className="bg-terminal-bg/50 rounded p-2">
                  <p className="text-[10px] text-terminal-muted uppercase">Energy Cost</p>
                  <p className="text-sm font-bold text-terminal-text">
                    {energyCostPercentile != null ? `P${formatNumber(energyCostPercentile, 0)}` : '--'}
                  </p>
                </div>
              </div>
              <div className="bg-terminal-bg/50 rounded p-2 mt-2">
                <p className="text-[10px] text-terminal-muted uppercase">
                  Current <GlossaryTerm id="quarq_spread">Quarq Spread</GlossaryTerm>
                </p>
                <p className="text-sm font-bold text-terminal-green">
                  {assessment?.quarqSpread != null ? `$${formatNumber(assessment.quarqSpread, 2)}/TH/day` : '--'}
                </p>
              </div>
            </div>
          </div>

          {/* Key Findings */}
          {findings.length > 0 && (
            <div className="border-t border-terminal-border pt-3">
              <p className="text-xs font-semibold text-terminal-text mb-2 flex items-center gap-1.5">
                <Activity size={12} className="text-terminal-cyan" />
                Key Findings
              </p>
              <ul className="space-y-1.5">
                {findings.map((finding, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-terminal-muted">
                    <span className="text-terminal-cyan mt-0.5">&#8226;</span>
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Natural Language Summary */}
          {summary && (
            <div className="bg-terminal-bg/50 border border-terminal-border rounded p-3">
              <p className="text-xs font-semibold text-terminal-text mb-1 flex items-center gap-1.5">
                <Info size={12} className="text-terminal-cyan" />
                Summary
              </p>
              <p className="text-xs text-terminal-muted leading-relaxed">{summary}</p>
            </div>
          )}

          {/* Refresh Button + Meta */}
          <div className="flex items-center justify-between pt-3 border-t border-terminal-border">
            <button
              onClick={handleRefreshAssessment}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-1.5 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors text-xs disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Assessing...' : 'Refresh Assessment'}
            </button>
            <div className="text-right">
              {assessedAt && (
                <p className="text-[10px] text-terminal-muted">
                  Last assessed: {formatDateTime(assessedAt)}
                </p>
              )}
              {modelVersion && (
                <p className="text-[10px] text-terminal-muted">
                  Model: {modelVersion}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
