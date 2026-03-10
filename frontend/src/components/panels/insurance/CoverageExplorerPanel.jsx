import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, Sliders, DollarSign, Clock, Zap, AlertTriangle, Send, X, Check,
  Activity, Gauge, BarChart3
} from 'lucide-react';
import Panel from '../../Panel';
import GlossaryTerm from '../../GlossaryTerm';
import { useApi, postApi } from '../../../hooks/useApi';
import { formatNumber, formatCurrency } from '../../../utils/formatters';
import {
  RevenueFanChart, HashpriceRibbonChart, RiskScoreGauge, FloorCards, ProbNegativeChart,
} from '../../charts/AssessmentCharts';

const TERMS = [
  { key: '6mo', label: '6 Mo', months: 6 },
  { key: '12mo', label: '12 Mo', months: 12 },
  { key: '24mo', label: '24 Mo', months: 24 },
  { key: '36mo', label: '36 Mo', months: 36 },
];

const PRESETS = [
  { key: 'conservative', label: 'Conservative', percentile: 'p25', color: 'text-terminal-green' },
  { key: 'moderate', label: 'Moderate', percentile: 'p40', color: 'text-terminal-amber' },
  { key: 'aggressive', label: 'Aggressive', percentile: 'p50', color: 'text-terminal-red' },
];

const COVERAGE_MODES = [
  { key: 'quarq_spread', label: 'Quarq Spread', glossaryId: 'quarq_spread', icon: '\u26A1' },
  { key: 'synthetic_ppa', label: 'Synthetic PPA', glossaryId: 'synthetic_ppa', icon: '\uD83D\uDCC4' },
  { key: 'proxy_revenue', label: 'Revenue Swap', glossaryId: 'proxy_revenue_swap', icon: '\uD83D\uDD04' },
  { key: 'efficiency_hedge', label: 'Efficiency Hedge', glossaryId: 'heat_rate_hedge', icon: '\uD83D\uDD27' },
];

/**
 * Panel 9c: Interactive Coverage Explorer
 * Supports 4 instrument modes with mode-specific controls.
 */
export default function CoverageExplorerPanel({ initialMode }) {
  const [mode, setMode] = useState(initialMode || 'quarq_spread');
  const [term, setTerm] = useState('12mo');
  const [hashrate, setHashrate] = useState('');
  const [floorPrice, setFloorPrice] = useState(50);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteSuccess, setQuoteSuccess] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const debounceRef = useRef(null);

  // Synthetic PPA specific
  const [strikeHashprice, setStrikeHashprice] = useState(50);
  const [upsideSharePct, setUpsideSharePct] = useState(15);

  // Proxy Revenue Swap specific
  const [floorRevenue, setFloorRevenue] = useState(5000);
  const [difficultyCapMultiple, setDifficultyCapMultiple] = useState(1.5);

  // Efficiency Hedge specific
  const [targetEfficiency, setTargetEfficiency] = useState(15);
  const [currentFleetEfficiency, setCurrentFleetEfficiency] = useState(34);

  // Update mode when initialMode prop changes
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  // Fetch risk profile for suggested floors and fleet data
  const { data: profileData } = useApi('/v1/insurance/risk-profile', {
    refreshInterval: 5 * 60 * 1000,
  });

  // Chart data from SanghaModel quick assessment
  const [showCharts, setShowCharts] = useState(false);
  const { data: chartData } = useApi(
    hashrate ? `/v1/charts/assessment?hashrate=${hashrate}` : null,
    { refreshInterval: 5 * 60 * 1000 }
  );
  const chartAssessment = chartData?.assessment;

  // Indicative premium
  const [indicative, setIndicative] = useState(null);
  const [indicativeLoading, setIndicativeLoading] = useState(false);

  const assessment = profileData?.assessment;
  const suggestedFloors = assessment?.suggestedFloors || {};
  const fleetHashrate = assessment?.fleetHashrateTH || profileData?.fleetHashrateTH;

  // Initialize hashrate from fleet data
  useEffect(() => {
    if (fleetHashrate && !hashrate) {
      setHashrate(String(fleetHashrate));
    }
  }, [fleetHashrate]);

  // Initialize floor from suggested floors
  useEffect(() => {
    if (suggestedFloors.p25 && floorPrice === 50) {
      setFloorPrice(suggestedFloors.p25);
    }
  }, [suggestedFloors]);

  const sliderMin = suggestedFloors.min || 20;
  const sliderMax = suggestedFloors.max || 120;

  // Debounced fetch for indicative premium
  const fetchIndicative = useCallback(async (floor, termKey, hr) => {
    if (!floor || !hr) return;
    setIndicativeLoading(true);
    try {
      const termConfig = TERMS.find(t => t.key === termKey);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || '/api'}/v1/insurance/quotes/indicative?floor=${floor}&term=${termConfig?.months || 12}&hashrate=${hr}&mode=${mode}`
      );
      if (res.ok) {
        const result = await res.json();
        setIndicative(result);
      }
    } catch (err) {
      console.error('Failed to fetch indicative quote:', err);
    } finally {
      setIndicativeLoading(false);
    }
  }, [mode]);

  // Debounce slider / input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const floor = mode === 'synthetic_ppa' ? strikeHashprice : floorPrice;
      fetchIndicative(floor, term, hashrate);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [floorPrice, strikeHashprice, term, hashrate, mode, fetchIndicative]);

  const handlePreset = (preset) => {
    const floor = suggestedFloors[preset.percentile];
    if (floor != null) {
      setFloorPrice(floor);
      setStrikeHashprice(floor);
    }
  };

  const handleSubmitQuote = async () => {
    setQuoteSubmitting(true);
    setQuoteError(null);
    try {
      const termConfig = TERMS.find(t => t.key === term);
      await postApi('/v1/insurance/quotes/request', {
        floor_price: mode === 'synthetic_ppa' ? strikeHashprice : floorPrice,
        term_months: termConfig?.months || 12,
        hashrate_th: parseFloat(hashrate),
        coverage_mode: mode,
      });
      setQuoteSuccess(true);
      setTimeout(() => {
        setShowQuoteModal(false);
        setQuoteSuccess(false);
      }, 2000);
    } catch (err) {
      setQuoteError(err.response?.data?.error || err.message || 'Failed to submit request');
    } finally {
      setQuoteSubmitting(false);
    }
  };

  const monthlyCost = indicative?.monthlyPremium;
  const annualCost = indicative?.annualPremium;
  const costPerTH = indicative?.costPerTH;

  const currentModeConfig = COVERAGE_MODES.find(m => m.key === mode);

  // Mode-specific controls renderer
  const renderModeControls = () => {
    switch (mode) {
      case 'quarq_spread':
        return (
          <>
            {/* Guaranteed Spread Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-terminal-text">
                  Guaranteed <GlossaryTerm id="quarq_spread">Spread</GlossaryTerm> ($/TH/s/day)
                </label>
                <span className="text-sm font-bold text-terminal-cyan font-sans">
                  ${formatNumber(floorPrice, 2)}
                </span>
              </div>
              <input
                type="range"
                min={sliderMin}
                max={sliderMax}
                step={0.5}
                value={floorPrice}
                onChange={(e) => setFloorPrice(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-cyan"
              />
              <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
                <span>${formatNumber(sliderMin, 0)}</span>
                <span>${formatNumber(sliderMax, 0)}</span>
              </div>
            </div>
            {/* Presets */}
            <div className="flex gap-2">
              {PRESETS.map(preset => (
                <button
                  key={preset.key}
                  onClick={() => handlePreset(preset)}
                  className={`flex-1 px-2 py-1.5 text-xs border border-terminal-border rounded hover:bg-terminal-border/50 transition-colors ${preset.color}`}
                >
                  {preset.label}
                  {suggestedFloors[preset.percentile] != null && (
                    <span className="block text-[10px] text-terminal-muted font-sans">
                      ${formatNumber(suggestedFloors[preset.percentile], 2)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        );

      case 'synthetic_ppa':
        return (
          <>
            {/* Strike Hashprice */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-terminal-text">
                  Strike <GlossaryTerm id="hashprice">Hashprice</GlossaryTerm> ($/PH/day)
                </label>
                <span className="text-sm font-bold text-terminal-cyan font-sans">
                  ${formatNumber(strikeHashprice, 2)}
                </span>
              </div>
              <input
                type="range"
                min={sliderMin}
                max={sliderMax}
                step={0.5}
                value={strikeHashprice}
                onChange={(e) => setStrikeHashprice(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-cyan"
              />
              <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
                <span>${formatNumber(sliderMin, 0)}</span>
                <span>${formatNumber(sliderMax, 0)}</span>
              </div>
            </div>
            {/* Upside Share */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-terminal-text">
                  <GlossaryTerm id="upside_sharing">Upside Sharing</GlossaryTerm> (%)
                </label>
                <span className="text-sm font-bold text-terminal-amber font-sans">
                  {upsideSharePct}%
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={50}
                step={1}
                value={upsideSharePct}
                onChange={(e) => setUpsideSharePct(parseInt(e.target.value))}
                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-amber"
              />
              <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
                <span>5%</span>
                <span>50%</span>
              </div>
            </div>
            {/* CfD explainer */}
            <p className="text-[10px] text-terminal-muted leading-relaxed">
              Below the strike, Sangha pays you the difference. Above the strike, you share {upsideSharePct}% of the upside.
              Pure financial settlement — no physical delivery.
            </p>
          </>
        );

      case 'proxy_revenue':
        return (
          <>
            {/* Floor Revenue */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-terminal-text">
                  <GlossaryTerm id="revenue_floor">Revenue Floor</GlossaryTerm> ($/day)
                </label>
                <span className="text-sm font-bold text-terminal-cyan font-sans">
                  ${formatNumber(floorRevenue, 0)}
                </span>
              </div>
              <input
                type="range"
                min={1000}
                max={50000}
                step={500}
                value={floorRevenue}
                onChange={(e) => setFloorRevenue(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-cyan"
              />
              <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
                <span>$1,000</span>
                <span>$50,000</span>
              </div>
            </div>
            {/* Difficulty Cap */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-terminal-text">Difficulty Cap Multiple</label>
                <span className="text-sm font-bold text-terminal-amber font-sans">
                  {difficultyCapMultiple}x
                </span>
              </div>
              <input
                type="range"
                min={1.1}
                max={3.0}
                step={0.1}
                value={difficultyCapMultiple}
                onChange={(e) => setDifficultyCapMultiple(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-amber"
              />
              <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
                <span>1.1x</span>
                <span>3.0x</span>
              </div>
            </div>
            <p className="text-[10px] text-terminal-muted leading-relaxed">
              Covers both BTC price drops and difficulty increases up to {difficultyCapMultiple}x the current level.
              Settles based on actual <GlossaryTerm id="hashprice">hashprice</GlossaryTerm> which embeds both risks.
            </p>
          </>
        );

      case 'efficiency_hedge':
        return (
          <>
            {/* Target Efficiency */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-terminal-text">Target Efficiency (J/TH)</label>
                <span className="text-sm font-bold text-terminal-green font-sans">
                  {targetEfficiency} J/TH
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={30}
                step={1}
                value={targetEfficiency}
                onChange={(e) => setTargetEfficiency(parseInt(e.target.value))}
                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-green"
              />
              <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
                <span>10 J/TH (S21 Pro)</span>
                <span>30 J/TH</span>
              </div>
            </div>
            {/* Current Fleet Efficiency */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-terminal-text">Your Fleet Efficiency (J/TH)</label>
                <span className="text-sm font-bold text-terminal-amber font-sans">
                  {currentFleetEfficiency} J/TH
                </span>
              </div>
              <input
                type="range"
                min={15}
                max={50}
                step={1}
                value={currentFleetEfficiency}
                onChange={(e) => setCurrentFleetEfficiency(parseInt(e.target.value))}
                className="w-full h-1.5 bg-terminal-border rounded-lg appearance-none cursor-pointer accent-terminal-amber"
              />
              <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
                <span>15 J/TH</span>
                <span>50 J/TH</span>
              </div>
            </div>
            {/* Efficiency gap display */}
            <div className="bg-terminal-bg rounded p-3 border border-terminal-border">
              <div className="flex items-center justify-between text-xs">
                <span className="text-terminal-muted">Efficiency Gap</span>
                <span className={`font-bold font-sans ${currentFleetEfficiency > targetEfficiency ? 'text-terminal-amber' : 'text-terminal-green'}`}>
                  {currentFleetEfficiency > targetEfficiency
                    ? `${(currentFleetEfficiency / targetEfficiency).toFixed(1)}x`
                    : 'No gap'}
                </span>
              </div>
              <p className="text-[10px] text-terminal-muted mt-1 leading-relaxed">
                Sangha absorbs the gap between your fleet's {currentFleetEfficiency} J/TH and the virtual {targetEfficiency} J/TH target,
                effectively lowering your breakeven energy price.
              </p>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <Panel
      title="Coverage Explorer"
      source="Insurance Engine"
      loading={false}
      headerRight={
        <div className="flex items-center gap-2">
          <Sliders size={14} className="text-terminal-cyan" />
        </div>
      }
    >
      <div className="space-y-4">
        {/* Disclaimer */}
        <div className="flex items-start gap-2 bg-terminal-amber/10 border border-terminal-amber/20 rounded px-3 py-2">
          <AlertTriangle size={14} className="text-terminal-amber mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-terminal-amber leading-relaxed">
            Indicative estimates only. Sangha structures coverage backed by institutional capital partners.
            Formal terms are set during underwriting and LP approval.
          </p>
        </div>

        {/* How It Works — three-party explainer */}
        <details className="bg-terminal-bg/50 border border-terminal-border rounded">
          <summary className="px-3 py-2 text-[11px] text-terminal-cyan cursor-pointer hover:text-terminal-text">
            How coverage works (three-party structure)
          </summary>
          <div className="px-3 pb-3 text-[10px] text-terminal-muted leading-relaxed space-y-1.5">
            <p><span className="text-terminal-text font-semibold">1. You request coverage</span> — choose your instrument, floor price, and term.</p>
            <p><span className="text-terminal-text font-semibold">2. Sangha structures the deal</span> — our underwriting team assesses risk and structures terms.</p>
            <p><span className="text-terminal-text font-semibold">3. Institutional capital backs it</span> — a balance sheet partner provides the capital guarantee.</p>
            <p><span className="text-terminal-text font-semibold">4. You pay a monthly premium</span> — if hashprice drops below your floor, the capital partner pays the difference via Sangha.</p>
            <p className="text-terminal-muted/60 pt-1">Your identity is never shared with capital partners. Sangha manages all counterparty relationships.</p>
          </div>
        </details>

        {/* Mode Selector */}
        <div>
          <label className="text-xs font-semibold text-terminal-text mb-2 block">Instrument Type</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
            {COVERAGE_MODES.map(m => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`px-2 py-2 text-[11px] rounded transition-colors flex items-center justify-center gap-1.5 ${
                  mode === m.key
                    ? 'bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30'
                    : 'text-terminal-muted border border-terminal-border hover:text-terminal-text hover:bg-terminal-border/50'
                }`}
              >
                <span>{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mode-specific controls */}
        {renderModeControls()}

        {/* Term Selector (common) */}
        <div>
          <label className="text-xs font-semibold text-terminal-text mb-2 block">Coverage Term</label>
          <div className="flex gap-1">
            {TERMS.map(t => (
              <button
                key={t.key}
                onClick={() => setTerm(t.key)}
                className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                  term === t.key
                    ? 'bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30'
                    : 'text-terminal-muted border border-terminal-border hover:text-terminal-text hover:bg-terminal-border/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hashrate Input (common) */}
        <div>
          <label className="text-xs font-semibold text-terminal-text mb-2 block">Covered Hashrate (TH/s)</label>
          <div className="relative">
            <Zap size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" />
            <input
              type="number"
              value={hashrate}
              onChange={(e) => setHashrate(e.target.value)}
              placeholder="Enter hashrate"
              className="w-full bg-terminal-bg border border-terminal-border rounded pl-8 pr-3 py-2 text-sm text-terminal-text font-sans placeholder:text-terminal-muted/50 focus:outline-none focus:border-terminal-cyan"
            />
          </div>
        </div>

        {/* Indicative Premium Display */}
        <div className="bg-terminal-bg/50 border border-terminal-border rounded p-4">
          <p className="text-xs font-semibold text-terminal-text mb-3 flex items-center gap-1.5">
            <DollarSign size={12} className="text-terminal-green" />
            Indicative Premium
            {currentModeConfig && (
              <span className="text-[10px] text-terminal-muted">({currentModeConfig.label})</span>
            )}
            {indicativeLoading && (
              <span className="ml-2 text-[10px] text-terminal-muted animate-pulse">Calculating...</span>
            )}
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-[10px] text-terminal-muted uppercase">Monthly</p>
              <p className="text-lg font-bold text-terminal-green font-sans">
                {monthlyCost != null ? formatCurrency(monthlyCost, 'USD', 0) : '--'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-terminal-muted uppercase">Annual</p>
              <p className="text-lg font-bold text-terminal-text font-sans">
                {annualCost != null ? formatCurrency(annualCost, 'USD', 0) : '--'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-terminal-muted uppercase">Per TH/s</p>
              <p className="text-lg font-bold text-terminal-text font-sans">
                {costPerTH != null ? `$${formatNumber(costPerTH, 2)}` : '--'}
              </p>
            </div>
          </div>
        </div>

        {/* Risk Assessment Charts */}
        {chartAssessment && (
          <div className="border-t border-terminal-border pt-4">
            <button
              onClick={() => setShowCharts(!showCharts)}
              className="flex items-center gap-2 text-xs text-terminal-cyan hover:text-terminal-text transition-colors mb-3"
            >
              <BarChart3 size={14} />
              {showCharts ? 'Hide' : 'Show'} Risk Assessment Charts
              {chartAssessment._mock && (
                <span className="text-[9px] px-1.5 py-0.5 bg-terminal-amber/20 text-terminal-amber rounded ml-1">MOCK</span>
              )}
            </button>
            {showCharts && (
              <div className="space-y-6">
                {/* 1C + 1D side by side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <RiskScoreGauge
                    riskScore={chartAssessment.insurance_inputs?.risk_score}
                    probLoss12m={chartAssessment.risk_metrics?.prob_below_breakeven_12m}
                  />
                  <FloorCards insuranceInputs={chartAssessment.insurance_inputs} />
                </div>
                {/* 1A: Revenue Fan Chart */}
                <RevenueFanChart projections={chartAssessment.revenue_projections?.monthly_projections} />
                {/* 1B: Hashprice Forecast Ribbon */}
                <HashpriceRibbonChart
                  horizons={chartAssessment.hashprice_distribution?.horizons}
                  currentHashprice={chartAssessment.hashprice_distribution?.current_hashprice}
                />
                {/* 1E: Probability of Negative Revenue */}
                <ProbNegativeChart projections={chartAssessment.revenue_projections?.monthly_projections} />
              </div>
            )}
          </div>
        )}

        {/* CTA Button */}
        <button
          onClick={() => setShowQuoteModal(true)}
          className="w-full py-3 bg-terminal-green text-terminal-bg font-semibold rounded hover:bg-terminal-green/90 transition-colors text-sm flex items-center justify-center gap-2"
        >
          <Shield size={16} />
          Request Formal Quote
        </button>
      </div>

      {/* Quote Request Modal */}
      {showQuoteModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-terminal-panel border border-terminal-border rounded-lg w-full max-w-md">
            <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
              <h4 className="font-semibold text-terminal-text">Request Formal Quote</h4>
              <button
                onClick={() => { setShowQuoteModal(false); setQuoteError(null); }}
                className="p-1 hover:bg-terminal-border rounded"
              >
                <X size={16} className="text-terminal-muted" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {quoteSuccess ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Check size={32} className="text-terminal-green mb-2" />
                  <p className="text-sm text-terminal-green font-semibold">Quote request submitted!</p>
                  <p className="text-xs text-terminal-muted mt-1">Sangha's underwriting team will structure terms with our institutional capital partners.</p>
                </div>
              ) : (
                <>
                  <div className="bg-terminal-bg/50 rounded p-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-terminal-muted">Instrument</span>
                      <span className="text-terminal-cyan">{currentModeConfig?.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-terminal-muted">
                        {mode === 'synthetic_ppa' ? 'Strike Price' : 'Floor Price'}
                      </span>
                      <span className="text-terminal-text font-sans">
                        ${formatNumber(mode === 'synthetic_ppa' ? strikeHashprice : floorPrice, 2)}/PH/day
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-terminal-muted">Term</span>
                      <span className="text-terminal-text">{TERMS.find(t => t.key === term)?.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-terminal-muted">Hashrate</span>
                      <span className="text-terminal-text font-sans">{formatNumber(parseFloat(hashrate) || 0, 0)} TH/s</span>
                    </div>
                    {monthlyCost != null && (
                      <div className="flex justify-between pt-2 border-t border-terminal-border">
                        <span className="text-terminal-muted">Est. Monthly Premium</span>
                        <span className="text-terminal-green font-sans">{formatCurrency(monthlyCost, 'USD', 0)}</span>
                      </div>
                    )}
                  </div>

                  {quoteError && (
                    <div className="flex items-center gap-2 bg-terminal-red/10 border border-terminal-red/20 rounded px-3 py-2 text-xs text-terminal-red">
                      <AlertTriangle size={12} />
                      {quoteError}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowQuoteModal(false); setQuoteError(null); }}
                      className="flex-1 px-3 py-2 text-sm border border-terminal-border rounded text-terminal-muted hover:bg-terminal-border transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitQuote}
                      disabled={quoteSubmitting}
                      className="flex-1 px-3 py-2 text-sm bg-terminal-green text-terminal-bg rounded font-semibold hover:bg-terminal-green/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Send size={14} />
                      {quoteSubmitting ? 'Submitting...' : 'Submit Request'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
