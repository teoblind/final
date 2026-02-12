import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Fleet Scenario Simulator
 * "What-if" tool with reactive sliders for BTC price, difficulty, and electricity cost.
 */
export default function ScenarioSimulator() {
  const { data: profData } = useApi('/fleet/profitability', { refreshInterval: 5 * 60 * 1000 });

  const [btcMultiplier, setBtcMultiplier] = useState(1.0);
  const [diffMultiplier, setDiffMultiplier] = useState(1.0);
  const [elecOverride, setElecOverride] = useState(null); // null = use current
  const [scenarioResult, setScenarioResult] = useState(null);
  const [simulating, setSimulating] = useState(false);

  const hasFleet = profData?.hasFleet;
  const currentBtcPrice = profData?.networkHashprice?.btcPrice || 65000;
  const currentEnergy = profData?.defaultEnergyCostKWh || 0.05;

  // Debounced simulation
  const runSimulation = useCallback(async () => {
    if (!hasFleet) return;
    setSimulating(true);
    try {
      const response = await fetch('/api/fleet/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          btcPriceMultiplier: btcMultiplier,
          difficultyMultiplier: diffMultiplier,
          electricityPrice: elecOverride,
        }),
      });
      if (response.ok) {
        const result = await response.json();
        setScenarioResult(result);
      }
    } catch (err) {
      console.error('Simulation failed:', err);
    } finally {
      setSimulating(false);
    }
  }, [btcMultiplier, diffMultiplier, elecOverride, hasFleet]);

  // Debounce: run simulation 300ms after last change
  useEffect(() => {
    const timer = setTimeout(runSimulation, 300);
    return () => clearTimeout(timer);
  }, [runSimulation]);

  const handleReset = () => {
    setBtcMultiplier(1.0);
    setDiffMultiplier(1.0);
    setElecOverride(null);
  };

  const fleet = scenarioResult?.fleetResult;
  const isNegative = fleet && fleet.totalNetRevenue < 0;

  if (!hasFleet) {
    return (
      <Panel title="Scenario Simulator" source="Fleet Config Required" loading={false}>
        <div className="flex flex-col items-center justify-center py-6 text-terminal-muted text-sm">
          <p>Configure your fleet in Settings to use the simulator.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Scenario Simulator"
      source="Local Calculation"
      loading={simulating && !scenarioResult}
      headerRight={
        <button
          onClick={handleReset}
          className="px-2 py-1 text-xs text-terminal-muted hover:text-terminal-text border border-terminal-border rounded transition-colors"
        >
          Reset
        </button>
      }
    >
      <div className="space-y-4">
        {/* BTC Price Slider */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-terminal-muted">BTC Price</label>
            <span className="text-xs font-medium text-terminal-text">
              ${formatNumber(currentBtcPrice * btcMultiplier, 0)}
              {btcMultiplier !== 1.0 && (
                <span className={`ml-1 ${btcMultiplier > 1 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                  ({btcMultiplier > 1 ? '+' : ''}{((btcMultiplier - 1) * 100).toFixed(0)}%)
                </span>
              )}
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            value={btcMultiplier}
            onChange={e => setBtcMultiplier(Number(e.target.value))}
            className="w-full accent-terminal-green h-1"
          />
          <div className="flex justify-between text-[10px] text-terminal-muted">
            <span>-50%</span><span>0%</span><span>+100%</span>
          </div>
        </div>

        {/* Difficulty Slider */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-terminal-muted">Difficulty Change</label>
            <span className="text-xs font-medium text-terminal-text">
              {diffMultiplier > 1 ? '+' : ''}{((diffMultiplier - 1) * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="0.8"
            max="1.2"
            step="0.01"
            value={diffMultiplier}
            onChange={e => setDiffMultiplier(Number(e.target.value))}
            className="w-full accent-terminal-amber h-1"
          />
          <div className="flex justify-between text-[10px] text-terminal-muted">
            <span>-20%</span><span>0%</span><span>+20%</span>
          </div>
        </div>

        {/* Electricity Override */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-terminal-muted">Electricity ($/kWh)</label>
            <span className="text-xs font-medium text-terminal-text">
              ${(elecOverride !== null ? elecOverride : currentEnergy).toFixed(3)}
            </span>
          </div>
          <input
            type="range"
            min="0.00"
            max="0.15"
            step="0.001"
            value={elecOverride !== null ? elecOverride : currentEnergy}
            onChange={e => setElecOverride(Number(e.target.value))}
            className="w-full accent-terminal-cyan h-1"
          />
          <div className="flex justify-between text-[10px] text-terminal-muted">
            <span>$0.00</span><span>$0.075</span><span>$0.15</span>
          </div>
        </div>

        {/* Results */}
        {fleet && (
          <div className="border-t border-terminal-border pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-terminal-bg/50 rounded p-3">
                <p className="text-xs text-terminal-muted">Net Revenue</p>
                <p className={`text-lg font-bold ${isNegative ? 'text-terminal-red' : 'text-terminal-green'}`}>
                  {isNegative ? '-' : ''}${formatNumber(Math.abs(fleet.totalNetRevenue), 0)}<span className="text-xs font-normal">/day</span>
                </p>
              </div>
              <div className="bg-terminal-bg/50 rounded p-3">
                <p className="text-xs text-terminal-muted">Profit Margin</p>
                <p className={`text-lg font-bold ${fleet.profitMargin >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                  {formatNumber(fleet.profitMargin, 1)}%
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-terminal-muted">
                Profitable: <span className="text-terminal-green">{fleet.profitableMachines}</span> machines
              </span>
              {fleet.unprofitableMachines > 0 && (
                <span className="text-terminal-red">
                  Unprofitable: {fleet.unprofitableMachines}
                </span>
              )}
            </div>

            {/* Comparison to current */}
            {profData?.fleet && (
              <div className="text-xs text-terminal-muted">
                vs. current: {fleet.totalNetRevenue > profData.fleet.totalNetRevenue ? (
                  <span className="text-terminal-green">
                    +${formatNumber(fleet.totalNetRevenue - profData.fleet.totalNetRevenue, 0)}/day
                  </span>
                ) : (
                  <span className="text-terminal-red">
                    -${formatNumber(Math.abs(fleet.totalNetRevenue - profData.fleet.totalNetRevenue), 0)}/day
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
