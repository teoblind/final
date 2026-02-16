import React, { useState } from 'react';
import {
  PieChart, Shield, TrendingUp, AlertTriangle, Zap, DollarSign,
  Activity, RefreshCw, ChevronDown, Clock
} from 'lucide-react';
import Panel from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';
import { formatNumber, formatCurrency } from '../../../utils/formatters';

const STRESS_SCENARIOS = [
  { key: 'btc_crash', label: 'BTC Price Crash', icon: TrendingUp, description: 'BTC drops 40% over 30 days' },
  { key: 'difficulty_spike', label: 'Difficulty Spike', icon: Activity, description: '+25% difficulty adjustment' },
  { key: 'energy_spike', label: 'Energy Price Spike', icon: Zap, description: 'Energy costs double for 60 days' },
  { key: 'mass_curtailment', label: 'Mass Curtailment', icon: AlertTriangle, description: '50% fleet offline for 30 days' },
];

const RISK_TIERS = [
  { key: 'low', label: 'Low Risk (0-30)', color: 'bg-terminal-green', textColor: 'text-terminal-green' },
  { key: 'medium', label: 'Medium Risk (31-60)', color: 'bg-terminal-amber', textColor: 'text-terminal-amber' },
  { key: 'high', label: 'High Risk (61-100)', color: 'bg-terminal-red', textColor: 'text-terminal-red' },
];

/**
 * Panel 9f: Portfolio Risk Dashboard (Sangha Admin)
 * Aggregate metrics, exposure by risk tier, claims vs premium tracking,
 * stress testing, and portfolio health indicator.
 */
export default function PortfolioRiskPanel() {
  const [stressScenario, setStressScenario] = useState('btc_crash');
  const [stressRunning, setStressRunning] = useState(false);
  const [stressResults, setStressResults] = useState(null);
  const [showScenarioDropdown, setShowScenarioDropdown] = useState(false);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/v1/admin/insurance/portfolio',
    { refreshInterval: 60 * 1000 }
  );

  const metrics = data?.metrics || {};
  const exposure = data?.exposureByTier || {};
  const claimsVsPremium = data?.claimsVsPremium || {};
  const pendingClaims = data?.pendingClaims || {};
  const portfolioHealth = data?.portfolioHealth;

  const totalExposure = (exposure.low || 0) + (exposure.medium || 0) + (exposure.high || 0);

  const getHealthColor = (health) => {
    if (!health) return 'text-terminal-muted';
    if (health === 'healthy' || health === 'good') return 'text-terminal-green';
    if (health === 'warning' || health === 'caution') return 'text-terminal-amber';
    return 'text-terminal-red';
  };

  const getHealthLabel = (health) => {
    if (!health) return 'Unknown';
    return health.charAt(0).toUpperCase() + health.slice(1);
  };

  const lossRatio = metrics.trailingLossRatio;

  const handleStressTest = async () => {
    setStressRunning(true);
    setStressResults(null);
    try {
      const result = await postApi('/v1/admin/insurance/stress-test', {
        scenarioType: stressScenario,
      });
      setStressResults(result);
    } catch (err) {
      console.error('Stress test failed:', err);
      setStressResults({ error: err.response?.data?.error || err.message || 'Stress test failed' });
    } finally {
      setStressRunning(false);
    }
  };

  const selectedScenario = STRESS_SCENARIOS.find(s => s.key === stressScenario);

  return (
    <Panel
      title="Portfolio Risk"
      source={data?.source || 'Sangha Admin'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex items-center gap-2">
          <PieChart size={14} className="text-terminal-amber" />
          <span className="text-xs text-terminal-muted">Admin</span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Portfolio Health Indicator */}
        {portfolioHealth && (
          <div className="flex items-center justify-between bg-terminal-bg/50 rounded px-3 py-2">
            <span className="text-xs text-terminal-muted">Portfolio Health</span>
            <span className={`text-xs font-bold ${getHealthColor(portfolioHealth)}`}>
              {getHealthLabel(portfolioHealth)}
            </span>
          </div>
        )}

        {/* Aggregate Metrics Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-terminal-bg/50 rounded p-3">
            <p className="text-[10px] text-terminal-muted uppercase">Active Policies</p>
            <p className="text-xl font-bold text-terminal-text">{metrics.activePolicies || 0}</p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3">
            <p className="text-[10px] text-terminal-muted uppercase">Covered Hashrate</p>
            <p className="text-xl font-bold text-terminal-cyan">
              {formatNumber((metrics.totalCoveredHashrateTH || 0) / 1000, 1)}
              <span className="text-xs text-terminal-muted"> PH/s</span>
            </p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3">
            <p className="text-[10px] text-terminal-muted uppercase">Monthly Premium Income</p>
            <p className="text-xl font-bold text-terminal-green">
              {formatCurrency(metrics.monthlyPremiumIncome, 'USD', 0)}
            </p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3">
            <p className="text-[10px] text-terminal-muted uppercase">Trailing Loss Ratio</p>
            <p className={`text-xl font-bold ${
              lossRatio != null
                ? lossRatio <= 0.5 ? 'text-terminal-green'
                  : lossRatio <= 0.8 ? 'text-terminal-amber'
                  : 'text-terminal-red'
                : 'text-terminal-muted'
            }`}>
              {lossRatio != null ? `${formatNumber(lossRatio * 100, 1)}%` : '--'}
            </p>
          </div>
        </div>

        {/* Exposure by Risk Tier */}
        <div className="border-t border-terminal-border pt-3">
          <p className="text-xs font-semibold text-terminal-text mb-3">Exposure by Risk Tier</p>
          <div className="space-y-2">
            {RISK_TIERS.map(tier => {
              const value = exposure[tier.key] || 0;
              const pct = totalExposure > 0 ? (value / totalExposure) * 100 : 0;
              return (
                <div key={tier.key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={tier.textColor}>{tier.label}</span>
                    <span className="text-terminal-text font-mono">
                      {formatNumber(value / 1000, 1)} PH/s ({formatNumber(pct, 0)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-terminal-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full ${tier.color} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Claims vs Premium */}
        <div className="border-t border-terminal-border pt-3">
          <p className="text-xs font-semibold text-terminal-text mb-3">Claims vs Premium (Trailing)</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-[10px] text-terminal-muted uppercase">Premium Collected</p>
              <div className="flex items-end gap-2">
                <p className="text-lg font-bold text-terminal-green font-mono">
                  {formatCurrency(claimsVsPremium.premiumCollected, 'USD', 0)}
                </p>
              </div>
              {/* Visual bar */}
              <div className="w-full h-3 bg-terminal-bg rounded mt-2 overflow-hidden">
                <div className="h-full bg-terminal-green/60 rounded" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-[10px] text-terminal-muted uppercase">Claims Paid</p>
              <div className="flex items-end gap-2">
                <p className="text-lg font-bold text-terminal-red font-mono">
                  {formatCurrency(claimsVsPremium.claimsPaid, 'USD', 0)}
                </p>
              </div>
              {/* Visual bar relative to premium */}
              <div className="w-full h-3 bg-terminal-bg rounded mt-2 overflow-hidden">
                <div
                  className="h-full bg-terminal-red/60 rounded transition-all duration-500"
                  style={{
                    width: claimsVsPremium.premiumCollected > 0
                      ? `${Math.min(((claimsVsPremium.claimsPaid || 0) / claimsVsPremium.premiumCollected) * 100, 100)}%`
                      : '0%'
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Pending Claims */}
        <div className="flex items-center justify-between bg-terminal-amber/10 border border-terminal-amber/20 rounded px-3 py-2">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-terminal-amber" />
            <span className="text-xs text-terminal-amber">Pending Claims</span>
          </div>
          <div className="text-right">
            <span className="text-sm font-bold text-terminal-amber">{pendingClaims.count || 0}</span>
            <span className="text-xs text-terminal-muted ml-2">
              ({formatCurrency(pendingClaims.totalAmount, 'USD', 0)})
            </span>
          </div>
        </div>

        {/* Stress Test */}
        <div className="border-t border-terminal-border pt-3">
          <p className="text-xs font-semibold text-terminal-text mb-3 flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-terminal-red" />
            Stress Testing
          </p>

          <div className="flex gap-2 mb-3">
            {/* Scenario Selector */}
            <div className="relative flex-1">
              <button
                onClick={() => setShowScenarioDropdown(!showScenarioDropdown)}
                className="w-full flex items-center justify-between bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-xs text-terminal-text hover:border-terminal-cyan transition-colors"
              >
                <span>{selectedScenario?.label || 'Select scenario'}</span>
                <ChevronDown size={12} className="text-terminal-muted" />
              </button>
              {showScenarioDropdown && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-terminal-panel border border-terminal-border rounded shadow-lg">
                  {STRESS_SCENARIOS.map(scenario => (
                    <button
                      key={scenario.key}
                      onClick={() => {
                        setStressScenario(scenario.key);
                        setShowScenarioDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-terminal-border/50 transition-colors ${
                        stressScenario === scenario.key ? 'text-terminal-cyan' : 'text-terminal-text'
                      }`}
                    >
                      <p className="font-medium">{scenario.label}</p>
                      <p className="text-[10px] text-terminal-muted">{scenario.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleStressTest}
              disabled={stressRunning}
              className="flex items-center gap-1.5 px-4 py-2 text-xs bg-terminal-red/20 text-terminal-red border border-terminal-red/30 rounded hover:bg-terminal-red/30 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={stressRunning ? 'animate-spin' : ''} />
              {stressRunning ? 'Running...' : 'Run Stress Test'}
            </button>
          </div>

          {/* Stress Test Results */}
          {stressResults && (
            <div className={`rounded p-3 ${
              stressResults.error
                ? 'bg-terminal-red/10 border border-terminal-red/20'
                : 'bg-terminal-bg/50 border border-terminal-border'
            }`}>
              {stressResults.error ? (
                <p className="text-xs text-terminal-red">{stressResults.error}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-terminal-text mb-2">
                    Scenario: {selectedScenario?.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-terminal-muted">Projected Claims: </span>
                      <span className="text-terminal-red font-mono">
                        {formatCurrency(stressResults.projectedClaims, 'USD', 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-terminal-muted">Loss Ratio: </span>
                      <span className={`font-mono ${
                        stressResults.projectedLossRatio > 1 ? 'text-terminal-red' : 'text-terminal-amber'
                      }`}>
                        {formatNumber((stressResults.projectedLossRatio || 0) * 100, 1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-terminal-muted">Policies Triggered: </span>
                      <span className="text-terminal-text font-mono">
                        {stressResults.policiesTriggered || 0} / {metrics.activePolicies || 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-terminal-muted">Capital at Risk: </span>
                      <span className="text-terminal-red font-mono">
                        {formatCurrency(stressResults.capitalAtRisk, 'USD', 0)}
                      </span>
                    </div>
                  </div>
                  {stressResults.recommendation && (
                    <p className="text-[11px] text-terminal-muted mt-2 pt-2 border-t border-terminal-border/30 leading-relaxed">
                      {stressResults.recommendation}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
