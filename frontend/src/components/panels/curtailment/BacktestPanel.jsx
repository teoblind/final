import React, { useState } from 'react';
import Panel from '../../Panel';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 5e: Curtailment Backtest
 * Run historical backtests comparing curtailment strategies.
 */
export default function BacktestPanel() {
  const [strategy, setStrategy] = useState('peeling');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [node, setNode] = useState('HB_NORTH');
  const [thresholdMWh, setThresholdMWh] = useState(50);
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const strategies = [
    { value: 'peeling', label: 'Peeling (Default)', desc: 'Shut least-efficient machines first when unprofitable' },
    { value: 'all_or_nothing', label: 'All-or-Nothing', desc: 'All machines on or all off at fleet-average breakeven' },
    { value: 'threshold', label: 'Fixed Threshold', desc: 'Mine below a fixed $/MWh price, curtail above' },
    { value: 'aggressive', label: 'Aggressive', desc: 'Curtail with wider hysteresis band' },
  ];

  const runBacktest = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/curtailment/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          strategy,
          node,
          params: strategy === 'threshold' ? { thresholdMWh } : {},
        }),
      });
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResults(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const handleExport = () => {
    if (!results?.dailyResults) return;
    const headers = 'Date,AlwaysMine,Strategy,Improvement,CurtailedHours,MiningHours';
    const rows = results.dailyResults.map(d =>
      `${d.date},${d.alwaysMineRevenue.toFixed(2)},${d.strategyRevenue.toFixed(2)},${d.improvement.toFixed(2)},${d.curtailedHours.toFixed(1)},${d.miningHours.toFixed(1)}`
    );
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backtest-${strategy}-${startDate}-${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const r = results?.results;
  const isImprovement = r && r.improvement > 0;

  return (
    <Panel
      title="Strategy Backtest"
      source="Historical Data"
      loading={running}
      onExport={results?.dailyResults ? handleExport : undefined}
    >
      <div className="space-y-4">
        {/* Configuration */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-terminal-muted mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Strategy</label>
            <select
              value={strategy}
              onChange={e => setStrategy(e.target.value)}
              className="bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
            >
              {strategies.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-terminal-muted mt-1">
              {strategies.find(s => s.value === strategy)?.desc}
            </p>
          </div>
          <div>
            <label className="block text-xs text-terminal-muted mb-1">ERCOT Node</label>
            <select
              value={node}
              onChange={e => setNode(e.target.value)}
              className="bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
            >
              {['HB_NORTH', 'HB_SOUTH', 'HB_WEST', 'HB_HOUSTON', 'HB_PAN'].map(n => (
                <option key={n} value={n}>{n.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
        </div>

        {strategy === 'threshold' && (
          <div>
            <label className="block text-xs text-terminal-muted mb-1">
              Price Threshold ($/MWh)
            </label>
            <input
              type="number"
              value={thresholdMWh}
              onChange={e => setThresholdMWh(Number(e.target.value))}
              className="bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-32"
            />
          </div>
        )}

        <button
          onClick={runBacktest}
          disabled={running}
          className="px-4 py-2 text-sm bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors disabled:opacity-50"
        >
          {running ? 'Running Backtest...' : 'Run Backtest'}
        </button>

        {error && (
          <div className="bg-terminal-red/10 border border-terminal-red/20 rounded px-3 py-2 text-xs text-terminal-red">
            {error}
          </div>
        )}

        {/* Results */}
        {r && (
          <div className="border-t border-terminal-border pt-4 space-y-4">
            <p className="text-xs font-semibold text-terminal-text">
              Backtest Results — {results.totalDays} days, {results.dataPoints} data points
            </p>

            {/* Comparison */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-terminal-bg/50 rounded p-3">
                <p className="text-xs text-terminal-muted">Always Mine</p>
                <p className={`text-sm font-bold ${r.alwaysMineRevenue >= 0 ? 'text-terminal-text' : 'text-terminal-red'}`}>
                  ${formatNumber(r.alwaysMineRevenue, 0)}
                </p>
              </div>
              <div className="bg-terminal-bg/50 rounded p-3">
                <p className="text-xs text-terminal-muted">With Strategy</p>
                <p className={`text-sm font-bold ${r.strategyRevenue >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                  ${formatNumber(r.strategyRevenue, 0)}
                </p>
              </div>
              <div className={`rounded p-3 ${isImprovement ? 'bg-terminal-green/10' : 'bg-terminal-red/10'}`}>
                <p className="text-xs text-terminal-muted">Improvement</p>
                <p className={`text-sm font-bold ${isImprovement ? 'text-terminal-green' : 'text-terminal-red'}`}>
                  {isImprovement ? '+' : ''}${formatNumber(r.improvement, 0)}
                  <span className="text-xs font-normal ml-1">
                    ({isImprovement ? '+' : ''}{formatNumber(r.improvementPct, 1)}%)
                  </span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-terminal-bg/50 rounded p-3">
                <p className="text-xs text-terminal-muted">Curtailment Rate</p>
                <p className="text-sm font-bold text-terminal-text">
                  {formatNumber(r.curtailmentRate, 1)}%
                </p>
              </div>
              <div className="bg-terminal-bg/50 rounded p-3">
                <p className="text-xs text-terminal-muted">Mining Hours</p>
                <p className="text-sm font-bold text-terminal-text">
                  {formatNumber(r.totalMiningHours, 0)}h
                </p>
              </div>
            </div>

            {/* Avg Energy Prices */}
            {(r.avgMiningEnergyPrice > 0 || r.avgCurtailedEnergyPrice > 0) && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-terminal-bg/50 rounded p-3">
                  <p className="text-xs text-terminal-muted">Avg Mining Energy Price</p>
                  <p className="text-sm font-bold text-terminal-green">
                    ${formatNumber(r.avgMiningEnergyPrice, 1)}/MWh
                  </p>
                </div>
                <div className="bg-terminal-bg/50 rounded p-3">
                  <p className="text-xs text-terminal-muted">Avg Curtailed Energy Price</p>
                  <p className="text-sm font-bold text-terminal-red">
                    ${formatNumber(r.avgCurtailedEnergyPrice, 1)}/MWh
                  </p>
                </div>
              </div>
            )}

            {/* Monthly Breakdown */}
            {results.monthlyBreakdown?.length > 0 && (
              <div>
                <p className="text-xs text-terminal-muted mb-2">Monthly Breakdown</p>
                <div className="border border-terminal-border rounded overflow-hidden">
                  <div className="grid grid-cols-5 gap-2 px-3 py-1.5 bg-terminal-bg/50 text-[10px] text-terminal-muted border-b border-terminal-border">
                    <div>Month</div>
                    <div className="text-right">Always Mine</div>
                    <div className="text-right">Optimized</div>
                    <div className="text-right">Savings</div>
                    <div className="text-right">Days</div>
                  </div>
                  {results.monthlyBreakdown.map((m, i) => {
                    const isSaved = m.savings > 0;
                    return (
                      <div key={i} className="grid grid-cols-5 gap-2 px-3 py-1.5 text-xs border-b border-terminal-border/50">
                        <div className="text-terminal-text">{m.month}</div>
                        <div className={`text-right ${m.alwaysMine >= 0 ? 'text-terminal-text' : 'text-terminal-red'}`}>
                          ${formatNumber(m.alwaysMine, 0)}
                        </div>
                        <div className={`text-right ${m.optimized >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                          ${formatNumber(m.optimized, 0)}
                        </div>
                        <div className={`text-right font-medium ${isSaved ? 'text-terminal-cyan' : 'text-terminal-red'}`}>
                          {isSaved ? '+' : ''}${formatNumber(m.savings, 0)}
                        </div>
                        <div className="text-right text-terminal-muted">{m.days}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Daily P&L chart (simplified) */}
            {results.dailyResults?.length > 0 && (
              <div>
                <p className="text-xs text-terminal-muted mb-2">Daily Improvement (Strategy vs Always-Mine)</p>
                <div className="flex items-center gap-px h-16">
                  {results.dailyResults.map((d, i) => {
                    const maxAbs = Math.max(
                      ...results.dailyResults.map(dr => Math.abs(dr.improvement))
                    ) || 1;
                    const height = Math.min(100, (Math.abs(d.improvement) / maxAbs) * 100);
                    const isPos = d.improvement >= 0;
                    return (
                      <div
                        key={i}
                        className="flex-1 flex items-center justify-center"
                        style={{ height: '100%' }}
                        title={`${d.date}: ${isPos ? '+' : ''}$${d.improvement.toFixed(2)}`}
                      >
                        <div
                          className={`w-full rounded-sm ${
                            isPos ? 'bg-terminal-green/50' : 'bg-terminal-red/50'
                          }`}
                          style={{
                            height: `${height}%`,
                            marginTop: isPos ? 'auto' : '0',
                            marginBottom: isPos ? '0' : 'auto',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
                  <span>{results.dailyResults[0]?.date}</span>
                  <span>{results.dailyResults[results.dailyResults.length - 1]?.date}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
