/**
 * Panel: Risk Detail (Charts 2A-2D)
 *
 * Full Monte Carlo risk assessment visualization.
 * Shows radar chart, VaR waterfall, diversification score, and simulation metadata.
 */
import React, { useState } from 'react';
import { Shield, RefreshCw, Loader } from 'lucide-react';
import Panel from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';
import {
  RiskRadarChart, VaRWaterfallChart, DiversificationBar, SimulationMetadata,
  RevenueFanChart, RiskScoreGauge,
} from '../../charts/AssessmentCharts';

export default function RiskDetailPanel() {
  const [runningFull, setRunningFull] = useState(false);
  const [fullData, setFullData] = useState(null);
  const [fullError, setFullError] = useState(null);

  // Quick assessment data (auto-fetched)
  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/v1/charts/assessment',
    { refreshInterval: 5 * 60 * 1000 }
  );

  const assessment = fullData?.assessment || data?.assessment;

  const handleRunFull = async () => {
    setRunningFull(true);
    setFullError(null);
    try {
      const result = await postApi('/v1/charts/assessment/full', {});
      setFullData(result);
    } catch (err) {
      setFullError(err.response?.data?.error || err.message || 'Full assessment failed');
    } finally {
      setRunningFull(false);
    }
  };

  return (
    <Panel
      title="Risk Assessment Detail"
      source="SanghaModel"
      loading={loading}
      error={error}
      lastUpdated={lastFetched}
      isStale={isStale}
      onRefresh={refetch}
      headerRight={
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-terminal-cyan" />
          {assessment?._mock && (
            <span className="text-[9px] px-1.5 py-0.5 bg-terminal-amber/20 text-terminal-amber rounded">MOCK</span>
          )}
        </div>
      }
    >
      {assessment ? (
        <div className="space-y-6">
          {/* Top Row: Risk Score + Radar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RiskScoreGauge
              riskScore={assessment.insurance_inputs?.risk_score}
              probLoss12m={assessment.risk_metrics?.prob_below_breakeven_12m}
            />
            <RiskRadarChart riskMetrics={assessment.risk_metrics} />
          </div>

          {/* VaR Waterfall + Diversification */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VaRWaterfallChart riskMetrics={assessment.risk_metrics} />
            <DiversificationBar score={assessment.risk_metrics?.diversification_score} />
          </div>

          {/* Revenue Fan Chart */}
          <RevenueFanChart projections={assessment.revenue_projections?.monthly_projections} />

          {/* Full Assessment Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleRunFull}
              disabled={runningFull}
              className="flex items-center gap-2 px-4 py-2 text-xs bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/30 transition-colors disabled:opacity-50"
            >
              {runningFull ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {runningFull ? 'Running simulations...' : 'Run Full Assessment (100K sims)'}
            </button>
            {fullData && (
              <span className="text-[10px] text-terminal-green">Full assessment loaded</span>
            )}
            {fullError && (
              <span className="text-[10px] text-terminal-red">{fullError}</span>
            )}
          </div>

          {/* Simulation Metadata */}
          <SimulationMetadata
            params={assessment.simulation_params}
            generatedAt={assessment.generated_at}
            modelVersion={assessment.model_version}
          />
        </div>
      ) : (
        <div className="text-center py-8">
          <Shield size={32} className="text-terminal-muted mx-auto mb-2" />
          <p className="text-sm text-terminal-muted">No risk assessment data available.</p>
          <p className="text-xs text-terminal-muted mt-1">Configure your fleet profile to generate an assessment.</p>
        </div>
      )}
    </Panel>
  );
}
