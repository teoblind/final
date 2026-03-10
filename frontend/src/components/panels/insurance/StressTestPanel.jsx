/**
 * Panel: Stress Test View (Charts 3A-3D)
 *
 * Run and visualize scenario analyses from SanghaModel.
 * Available to Sangha admins and LP dashboard.
 */
import React, { useState } from 'react';
import { Zap, Play, Loader, RefreshCw } from 'lucide-react';
import Panel from '../../Panel';
import { postApi } from '../../../hooks/useApi';
import {
  ScenarioComparisonTable, ImpactBarChart, FleetImpactCard, MultiScenarioChart,
} from '../../charts/ScenarioCharts';

const PRESET_SCENARIOS = [
  { key: 'btc_30', label: 'BTC -30%', params: { btc_price_change_percent: -30 } },
  { key: 'btc_50', label: 'BTC -50%', params: { btc_price_change_percent: -50 } },
  { key: 'diff_30', label: 'Difficulty +30%', params: { difficulty_change_percent: 30 } },
  { key: 'energy_50', label: 'Energy +50%', params: { energy_price_change_percent: 50 } },
  { key: 'halving', label: 'Halving Event', params: { halving_event: true } },
  { key: 'combined', label: 'BTC -30% + Diff +30%', params: { btc_price_change_percent: -30, difficulty_change_percent: 30 } },
];

export default function StressTestPanel() {
  const [selectedScenario, setSelectedScenario] = useState('btc_30');
  const [customParams, setCustomParams] = useState({ btc: '', diff: '', energy: '' });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [resultError, setResultError] = useState(null);
  const [multiResults, setMultiResults] = useState(null);
  const [runningMulti, setRunningMulti] = useState(false);

  const handleRunSingle = async () => {
    setRunning(true);
    setResultError(null);
    try {
      let params;
      if (selectedScenario === 'custom') {
        params = {};
        if (customParams.btc) params.btc_price_change_percent = parseFloat(customParams.btc);
        if (customParams.diff) params.difficulty_change_percent = parseFloat(customParams.diff);
        if (customParams.energy) params.energy_price_change_percent = parseFloat(customParams.energy);
      } else {
        params = PRESET_SCENARIOS.find(s => s.key === selectedScenario)?.params || {};
      }
      const res = await postApi('/v1/charts/scenario', params);
      setResult(res.scenario);
    } catch (err) {
      setResultError(err.response?.data?.error || err.message || 'Scenario failed');
    } finally {
      setRunning(false);
    }
  };

  const handleRunAll = async () => {
    setRunningMulti(true);
    try {
      const res = await postApi('/v1/charts/scenario/multi', {});
      setMultiResults(res.scenarios);
    } catch (err) {
      console.error('Multi-scenario failed:', err);
    } finally {
      setRunningMulti(false);
    }
  };

  return (
    <Panel
      title="Stress Test Scenarios"
      source="SanghaModel"
      loading={false}
      headerRight={
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-terminal-amber" />
          {result?._mock && (
            <span className="text-[9px] px-1.5 py-0.5 bg-terminal-amber/20 text-terminal-amber rounded">MOCK</span>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Scenario Selector */}
        <div>
          <p className="text-xs font-semibold text-terminal-text mb-2">Select Scenario</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
            {PRESET_SCENARIOS.map(s => (
              <button
                key={s.key}
                onClick={() => setSelectedScenario(s.key)}
                className={`px-2 py-1.5 text-[11px] rounded transition-colors ${
                  selectedScenario === s.key
                    ? 'bg-terminal-amber/20 text-terminal-amber border border-terminal-amber/30'
                    : 'text-terminal-muted border border-terminal-border hover:bg-terminal-border/50'
                }`}
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={() => setSelectedScenario('custom')}
              className={`px-2 py-1.5 text-[11px] rounded transition-colors ${
                selectedScenario === 'custom'
                  ? 'bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30'
                  : 'text-terminal-muted border border-terminal-border hover:bg-terminal-border/50'
              }`}
            >
              Custom
            </button>
          </div>
        </div>

        {/* Custom params */}
        {selectedScenario === 'custom' && (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-terminal-muted block mb-1">BTC Price Change %</label>
              <input
                type="number"
                value={customParams.btc}
                onChange={e => setCustomParams(p => ({ ...p, btc: e.target.value }))}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-sans focus:outline-none focus:border-terminal-cyan"
                placeholder="-30"
              />
            </div>
            <div>
              <label className="text-[10px] text-terminal-muted block mb-1">Difficulty Change %</label>
              <input
                type="number"
                value={customParams.diff}
                onChange={e => setCustomParams(p => ({ ...p, diff: e.target.value }))}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-sans focus:outline-none focus:border-terminal-cyan"
                placeholder="30"
              />
            </div>
            <div>
              <label className="text-[10px] text-terminal-muted block mb-1">Energy Price Change %</label>
              <input
                type="number"
                value={customParams.energy}
                onChange={e => setCustomParams(p => ({ ...p, energy: e.target.value }))}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text font-sans focus:outline-none focus:border-terminal-cyan"
                placeholder="50"
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleRunSingle}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 text-xs bg-terminal-amber/20 text-terminal-amber border border-terminal-amber/30 rounded hover:bg-terminal-amber/30 transition-colors disabled:opacity-50"
          >
            {running ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? 'Running...' : 'Run Scenario'}
          </button>
          <button
            onClick={handleRunAll}
            disabled={runningMulti}
            className="flex items-center gap-2 px-4 py-2 text-xs bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/30 transition-colors disabled:opacity-50"
          >
            {runningMulti ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {runningMulti ? 'Running all...' : 'Compare All Presets'}
          </button>
        </div>

        {resultError && (
          <p className="text-xs text-terminal-red">{resultError}</p>
        )}

        {/* Single scenario results */}
        {result && (
          <div className="space-y-4 border-t border-terminal-border pt-4">
            {/* 3A: Comparison Table */}
            <ScenarioComparisonTable
              baseline={result.baseline}
              shocked={result.shocked}
              impact={result.impact_summary}
            />
            {/* 3B: Impact Bar Chart */}
            <ImpactBarChart impact={result.impact_summary} />
            {/* 3C: Fleet Impact Card */}
            <FleetImpactCard fleet={result.fleet_specific} />
          </div>
        )}

        {/* Multi-scenario results (3D) */}
        {multiResults && (
          <div className="border-t border-terminal-border pt-4">
            <MultiScenarioChart scenarios={multiResults} />
          </div>
        )}
      </div>
    </Panel>
  );
}
