import React, { useState, useCallback } from 'react';
import api from '../../lib/hooks/useApi';

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'fleet', label: 'Fleet Config' },
  { id: 'energy', label: 'Energy' },
  { id: 'pool', label: 'Pool' },
  { id: 'review', label: 'Review' },
];

const ASIC_MODELS = [
  { model: 'S21 Pro', hashrate: 234, unit: 'TH/s' },
  { model: 'S21', hashrate: 200, unit: 'TH/s' },
  { model: 'S19 XP', hashrate: 140, unit: 'TH/s' },
  { model: 'S19j Pro', hashrate: 104, unit: 'TH/s' },
  { model: 'T21', hashrate: 190, unit: 'TH/s' },
];

const POOL_OPTIONS = ['Foundry', 'Antpool', 'F2Pool', 'ViaBTC', 'Braiins'];

const ISO_OPTIONS = [
  { id: 'ERCOT', label: 'ERCOT (Texas)', available: true },
  { id: 'PJM', label: 'PJM (Mid-Atlantic)', available: false },
  { id: 'MISO', label: 'MISO (Midwest)', available: false },
  { id: 'CAISO', label: 'CAISO (California)', available: false },
  { id: 'NYISO', label: 'NYISO (New York)', available: false },
];

export default function OnboardingWizard({ onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Step 2: Fleet Config
  const [workloadTypes, setWorkloadTypes] = useState({ btc: false, aiHpc: false });
  const [asicEntries, setAsicEntries] = useState([
    { model: 'S21 Pro', quantity: 0 },
  ]);

  // Step 3: Energy Config
  const [iso, setIso] = useState('ERCOT');
  const [settlementNode, setSettlementNode] = useState('');
  const [electricityRate, setElectricityRate] = useState('');

  // Step 4: Pool Connection
  const [selectedPool, setSelectedPool] = useState('');
  const [poolApiKey, setPoolApiKey] = useState('');
  const [poolTestStatus, setPoolTestStatus] = useState(null); // null | 'testing' | 'success' | 'error'

  // Navigation
  const goNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
      setError(null);
    }
  };

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      setError(null);
    }
  };

  // ASIC management
  const addAsicEntry = () => {
    setAsicEntries([...asicEntries, { model: 'S21', quantity: 0 }]);
  };

  const updateAsicEntry = (index, field, value) => {
    const updated = [...asicEntries];
    updated[index] = { ...updated[index], [field]: value };
    setAsicEntries(updated);
  };

  const removeAsicEntry = (index) => {
    if (asicEntries.length <= 1) return;
    setAsicEntries(asicEntries.filter((_, i) => i !== index));
  };

  // Pool connection test
  const testPoolConnection = async () => {
    if (!selectedPool || !poolApiKey) return;
    setPoolTestStatus('testing');
    try {
      await api.post('/v1/pools/test', {
        pool: selectedPool,
        apiKey: poolApiKey,
      });
      setPoolTestStatus('success');
    } catch {
      setPoolTestStatus('error');
    }
  };

  // Compute total hashrate for review
  const getTotalHashrate = useCallback(() => {
    return asicEntries.reduce((sum, entry) => {
      const model = ASIC_MODELS.find((m) => m.model === entry.model);
      return sum + (model ? model.hashrate * (parseInt(entry.quantity, 10) || 0) : 0);
    }, 0);
  }, [asicEntries]);

  const getTotalMachines = useCallback(() => {
    return asicEntries.reduce((sum, entry) => sum + (parseInt(entry.quantity, 10) || 0), 0);
  }, [asicEntries]);

  // Submit configuration
  const handleLaunch = async () => {
    setSubmitting(true);
    setError(null);

    const config = {
      workloadTypes,
      fleet: workloadTypes.btc
        ? asicEntries
            .filter((e) => parseInt(e.quantity, 10) > 0)
            .map((e) => ({
              model: e.model,
              quantity: parseInt(e.quantity, 10),
            }))
        : [],
      energy: {
        iso,
        settlementNode,
        electricityRate: parseFloat(electricityRate) || 0,
      },
      pool: selectedPool
        ? {
            provider: selectedPool,
            apiKey: poolApiKey,
          }
        : null,
    };

    try {
      await api.post('/v1/tenant', { settings: config });
      if (onComplete) {
        onComplete(config);
      }
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || 'Failed to save configuration'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Skip entire setup
  const handleSkip = () => {
    if (onComplete) {
      onComplete(null);
    }
  };

  // Render step indicator
  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((step, index) => (
        <div key={step.id} className="flex items-center gap-2">
          <button
            onClick={() => index < currentStep && setCurrentStep(index)}
            disabled={index > currentStep}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              index === currentStep
                ? 'bg-terminal-green text-[#0a0a0a]'
                : index < currentStep
                  ? 'bg-terminal-green/20 text-terminal-green border border-terminal-green/40 cursor-pointer'
                  : 'bg-terminal-panel border border-terminal-border text-terminal-muted'
            }`}
          >
            {index < currentStep ? '\u2713' : index + 1}
          </button>
          {index < STEPS.length - 1 && (
            <div
              className={`w-8 h-px ${
                index < currentStep ? 'bg-terminal-green/40' : 'bg-terminal-border'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );

  // Step 1: Welcome
  const renderWelcome = () => (
    <div className="text-center max-w-lg mx-auto">
      <div className="flex items-center justify-center gap-2 mb-4">
        <span className="text-terminal-green text-4xl font-bold">&#9650;</span>
      </div>
      <h2 className="text-2xl font-bold text-terminal-text mb-4">
        Welcome to Sangha MineOS
      </h2>
      <p className="text-terminal-muted text-sm leading-relaxed mb-6">
        Sangha MineOS is a unified intelligence platform for mining operations.
        It connects your energy markets, fleet hashprice, curtailment strategy,
        mining pools, and AI agents into a single command center.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left mb-6">
        {[
          { label: 'Real-time Energy', desc: 'Live ERCOT price feeds and curtailment optimization' },
          { label: 'Fleet Analytics', desc: 'Hashprice tracking, breakeven analysis, scenario modeling' },
          { label: 'Pool Integration', desc: 'Connect mining pools for earnings and worker monitoring' },
          { label: 'AI Agents', desc: 'Autonomous agents that optimize operations 24/7' },
        ].map((item) => (
          <div
            key={item.label}
            className="p-3 bg-[#0a0a0a] border border-terminal-border rounded"
          >
            <p className="text-terminal-green text-xs font-semibold mb-1">{item.label}</p>
            <p className="text-terminal-muted text-xs">{item.desc}</p>
          </div>
        ))}
      </div>
      <p className="text-terminal-muted text-xs">
        Let's configure your environment. This takes about 2 minutes.
      </p>
    </div>
  );

  // Step 2: Fleet Config
  const renderFleetConfig = () => (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-terminal-text mb-2">Fleet Configuration</h2>
      <p className="text-terminal-muted text-sm mb-6">
        Select your workload types and configure your fleet.
      </p>

      {/* Workload type checkboxes */}
      <div className="mb-6">
        <p className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
          Workload Types
        </p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={workloadTypes.btc}
              onChange={(e) =>
                setWorkloadTypes({ ...workloadTypes, btc: e.target.checked })
              }
              className="w-4 h-4 accent-[#00d26a] bg-[#0a0a0a] border-terminal-border rounded"
            />
            <span className="text-sm text-terminal-text">BTC Mining</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={workloadTypes.aiHpc}
              onChange={(e) =>
                setWorkloadTypes({ ...workloadTypes, aiHpc: e.target.checked })
              }
              className="w-4 h-4 accent-[#00d26a] bg-[#0a0a0a] border-terminal-border rounded"
            />
            <span className="text-sm text-terminal-text">AI / HPC</span>
          </label>
        </div>
      </div>

      {/* ASIC model selector (only if BTC selected) */}
      {workloadTypes.btc && (
        <div>
          <p className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
            ASIC Fleet
          </p>
          <div className="space-y-3">
            {asicEntries.map((entry, index) => {
              const modelInfo = ASIC_MODELS.find((m) => m.model === entry.model);
              return (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 bg-[#0a0a0a] border border-terminal-border rounded"
                >
                  <select
                    value={entry.model}
                    onChange={(e) => updateAsicEntry(index, 'model', e.target.value)}
                    className="flex-1 px-2 py-1.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm focus:outline-none focus:border-terminal-green"
                  >
                    {ASIC_MODELS.map((m) => (
                      <option key={m.model} value={m.model}>
                        {m.model} ({m.hashrate} {m.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    value={entry.quantity}
                    onChange={(e) =>
                      updateAsicEntry(index, 'quantity', e.target.value)
                    }
                    placeholder="Qty"
                    className="w-24 px-2 py-1.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm text-center focus:outline-none focus:border-terminal-green"
                  />
                  <span className="text-xs text-terminal-muted w-20 text-right">
                    {modelInfo
                      ? `${(modelInfo.hashrate * (parseInt(entry.quantity, 10) || 0)).toLocaleString()} TH/s`
                      : ''}
                  </span>
                  {asicEntries.length > 1 && (
                    <button
                      onClick={() => removeAsicEntry(index)}
                      className="text-terminal-red hover:text-terminal-red/80 text-sm px-1"
                    >
                      X
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={addAsicEntry}
            className="mt-3 text-sm text-terminal-cyan hover:underline"
          >
            + Add another model
          </button>
          {getTotalMachines() > 0 && (
            <div className="mt-4 p-3 bg-terminal-green/5 border border-terminal-green/20 rounded">
              <p className="text-xs text-terminal-muted">Fleet Total</p>
              <p className="text-lg font-bold text-terminal-green">
                {getTotalHashrate().toLocaleString()} TH/s
              </p>
              <p className="text-xs text-terminal-muted">
                {getTotalMachines().toLocaleString()} machines
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Step 3: Energy Config
  const renderEnergyConfig = () => (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-terminal-text mb-2">Energy Configuration</h2>
      <p className="text-terminal-muted text-sm mb-6">
        Configure your energy market and settlement details.
      </p>

      {/* ISO selector */}
      <div className="mb-5">
        <p className="text-xs text-terminal-muted uppercase tracking-wider mb-3">
          ISO / Market Region
        </p>
        <div className="space-y-2">
          {ISO_OPTIONS.map((option) => (
            <label
              key={option.id}
              className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors ${
                iso === option.id
                  ? 'bg-terminal-green/10 border-terminal-green/40'
                  : option.available
                    ? 'bg-[#0a0a0a] border-terminal-border hover:border-terminal-muted'
                    : 'bg-[#0a0a0a] border-terminal-border opacity-40 cursor-not-allowed'
              }`}
            >
              <input
                type="radio"
                name="iso"
                value={option.id}
                checked={iso === option.id}
                onChange={(e) => option.available && setIso(e.target.value)}
                disabled={!option.available}
                className="accent-[#00d26a]"
              />
              <span className="text-sm text-terminal-text">{option.label}</span>
              {!option.available && (
                <span className="text-xs text-terminal-muted ml-auto">Coming soon</span>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Settlement node */}
      <div className="mb-5">
        <label className="block text-xs text-terminal-muted uppercase tracking-wider mb-1.5">
          Settlement Node
        </label>
        <input
          type="text"
          value={settlementNode}
          onChange={(e) => setSettlementNode(e.target.value)}
          placeholder="e.g., HB_HOUSTON"
          className="w-full px-3 py-2.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-green transition-colors"
        />
      </div>

      {/* Electricity rate */}
      <div>
        <label className="block text-xs text-terminal-muted uppercase tracking-wider mb-1.5">
          Contract Electricity Rate ($/kWh)
        </label>
        <input
          type="number"
          step="0.001"
          min="0"
          value={electricityRate}
          onChange={(e) => setElectricityRate(e.target.value)}
          placeholder="0.045"
          className="w-full px-3 py-2.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-green transition-colors"
        />
      </div>
    </div>
  );

  // Step 4: Pool Connection
  const renderPoolConnection = () => (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-terminal-text mb-2">Pool Connection</h2>
      <p className="text-terminal-muted text-sm mb-6">
        Connect your mining pool for real-time hashrate and earnings data. This step is optional.
      </p>

      {/* Pool selector */}
      <div className="mb-5">
        <label className="block text-xs text-terminal-muted uppercase tracking-wider mb-1.5">
          Mining Pool
        </label>
        <select
          value={selectedPool}
          onChange={(e) => {
            setSelectedPool(e.target.value);
            setPoolTestStatus(null);
          }}
          className="w-full px-3 py-2.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm focus:outline-none focus:border-terminal-green"
        >
          <option value="">Select a pool...</option>
          {POOL_OPTIONS.map((pool) => (
            <option key={pool} value={pool}>
              {pool}
            </option>
          ))}
        </select>
      </div>

      {/* API Key */}
      {selectedPool && (
        <div className="mb-5">
          <label className="block text-xs text-terminal-muted uppercase tracking-wider mb-1.5">
            API Key
          </label>
          <input
            type="text"
            value={poolApiKey}
            onChange={(e) => {
              setPoolApiKey(e.target.value);
              setPoolTestStatus(null);
            }}
            placeholder="Enter your pool API key"
            className="w-full px-3 py-2.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-green transition-colors font-mono"
          />
        </div>
      )}

      {/* Test connection */}
      {selectedPool && poolApiKey && (
        <div className="mb-5">
          <button
            onClick={testPoolConnection}
            disabled={poolTestStatus === 'testing'}
            className="px-4 py-2 bg-terminal-panel border border-terminal-border rounded text-terminal-text text-sm hover:border-terminal-cyan transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {poolTestStatus === 'testing' && (
              <div className="w-3 h-3 border-2 border-terminal-cyan/30 border-t-terminal-cyan rounded-full animate-spin" />
            )}
            {poolTestStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>
          {poolTestStatus === 'success' && (
            <p className="mt-2 text-xs text-terminal-green">
              Connection successful. Pool data will sync after setup.
            </p>
          )}
          {poolTestStatus === 'error' && (
            <p className="mt-2 text-xs text-terminal-red">
              Connection failed. Please check your API key and try again.
            </p>
          )}
        </div>
      )}

      {/* Skip link */}
      <button
        onClick={goNext}
        className="text-sm text-terminal-muted hover:text-terminal-text underline"
      >
        Skip this step
      </button>
    </div>
  );

  // Step 5: Review & Launch
  const renderReview = () => (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-bold text-terminal-text mb-2">Review & Launch</h2>
      <p className="text-terminal-muted text-sm mb-6">
        Review your configuration before launching the dashboard.
      </p>

      <div className="space-y-4">
        {/* Workload Types */}
        <div className="p-4 bg-[#0a0a0a] border border-terminal-border rounded">
          <p className="text-xs text-terminal-muted uppercase tracking-wider mb-2">
            Workload Types
          </p>
          <div className="flex gap-3">
            {workloadTypes.btc && (
              <span className="px-2 py-1 text-xs bg-terminal-green/10 text-terminal-green border border-terminal-green/30 rounded">
                BTC Mining
              </span>
            )}
            {workloadTypes.aiHpc && (
              <span className="px-2 py-1 text-xs bg-terminal-cyan/10 text-terminal-cyan border border-terminal-cyan/30 rounded">
                AI / HPC
              </span>
            )}
            {!workloadTypes.btc && !workloadTypes.aiHpc && (
              <span className="text-xs text-terminal-muted">None selected</span>
            )}
          </div>
        </div>

        {/* Fleet Summary */}
        {workloadTypes.btc && (
          <div className="p-4 bg-[#0a0a0a] border border-terminal-border rounded">
            <p className="text-xs text-terminal-muted uppercase tracking-wider mb-2">
              Fleet
            </p>
            {asicEntries
              .filter((e) => parseInt(e.quantity, 10) > 0)
              .map((entry, i) => (
                <div key={i} className="flex justify-between text-sm mb-1">
                  <span className="text-terminal-text">{entry.model}</span>
                  <span className="text-terminal-muted">x{entry.quantity}</span>
                </div>
              ))}
            <div className="mt-2 pt-2 border-t border-terminal-border flex justify-between">
              <span className="text-xs text-terminal-muted">Total Hashrate</span>
              <span className="text-sm font-bold text-terminal-green">
                {getTotalHashrate().toLocaleString()} TH/s
              </span>
            </div>
          </div>
        )}

        {/* Energy */}
        <div className="p-4 bg-[#0a0a0a] border border-terminal-border rounded">
          <p className="text-xs text-terminal-muted uppercase tracking-wider mb-2">
            Energy
          </p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-terminal-muted">ISO</span>
              <span className="text-terminal-text">{iso}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-muted">Settlement Node</span>
              <span className="text-terminal-text">{settlementNode || 'Not set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-muted">Rate</span>
              <span className="text-terminal-text">
                {electricityRate ? `$${electricityRate}/kWh` : 'Not set'}
              </span>
            </div>
          </div>
        </div>

        {/* Pool */}
        <div className="p-4 bg-[#0a0a0a] border border-terminal-border rounded">
          <p className="text-xs text-terminal-muted uppercase tracking-wider mb-2">
            Pool
          </p>
          {selectedPool ? (
            <div className="text-sm">
              <div className="flex justify-between">
                <span className="text-terminal-muted">Provider</span>
                <span className="text-terminal-text">{selectedPool}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-terminal-muted">API Key</span>
                <span className="text-terminal-text font-mono">
                  {poolApiKey ? `${poolApiKey.slice(0, 8)}...` : 'Not set'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-terminal-muted">Skipped</p>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 px-3 py-2 bg-terminal-red/10 border border-terminal-red/30 rounded text-terminal-red text-sm">
          {error}
        </div>
      )}

      {/* Launch */}
      <button
        onClick={handleLaunch}
        disabled={submitting}
        className="mt-6 w-full py-3 bg-terminal-green text-[#0a0a0a] font-bold rounded hover:bg-terminal-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-lg"
      >
        {submitting && (
          <div className="w-5 h-5 border-2 border-[#0a0a0a]/30 border-t-[#0a0a0a] rounded-full animate-spin" />
        )}
        Launch Dashboard
      </button>

      {/* Tips */}
      <div className="mt-6 p-4 bg-terminal-panel border border-terminal-border rounded">
        <p className="text-xs text-terminal-muted uppercase tracking-wider mb-2">
          Next Steps
        </p>
        <ul className="text-xs text-terminal-muted space-y-1.5">
          <li className="flex items-start gap-2">
            <span className="text-terminal-green">&#8226;</span>
            <span>Explore the Operations Dashboard for real-time fleet data</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-terminal-green">&#8226;</span>
            <span>Set up curtailment schedules to optimize energy costs</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-terminal-green">&#8226;</span>
            <span>Enable AI agents for autonomous operation optimization</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-terminal-green">&#8226;</span>
            <span>Check Macro Intelligence for market thesis monitoring</span>
          </li>
        </ul>
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return renderWelcome();
      case 1:
        return renderFleetConfig();
      case 2:
        return renderEnergyConfig();
      case 3:
        return renderPoolConnection();
      case 4:
        return renderReview();
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] overflow-y-auto">
      <div className="min-h-screen flex flex-col">
        {/* Top bar with skip */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-terminal-border">
          <div className="flex items-center gap-2">
            <span className="text-terminal-green font-bold text-lg">&#9650;</span>
            <span className="text-sm font-semibold text-terminal-text">Setup Wizard</span>
          </div>
          <button
            onClick={handleSkip}
            className="text-xs text-terminal-muted hover:text-terminal-text"
          >
            Skip Setup
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-6">
          {renderStepIndicator()}
        </div>

        {/* Step content */}
        <div className="flex-1 px-6 py-6">{renderCurrentStep()}</div>

        {/* Navigation footer (not on review step, which has its own launch button) */}
        {currentStep < 4 && (
          <div className="px-6 py-4 border-t border-terminal-border flex items-center justify-between">
            <button
              onClick={goBack}
              disabled={currentStep === 0}
              className="px-4 py-2 text-sm text-terminal-muted hover:text-terminal-text border border-terminal-border rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Back
            </button>
            <span className="text-xs text-terminal-muted">
              Step {currentStep + 1} of {STEPS.length} &mdash; {STEPS[currentStep].label}
            </span>
            <button
              onClick={goNext}
              className="px-6 py-2 text-sm bg-terminal-green text-[#0a0a0a] font-semibold rounded hover:bg-terminal-green/90 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
