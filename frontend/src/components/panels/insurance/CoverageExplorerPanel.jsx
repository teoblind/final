import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, Sliders, DollarSign, Clock, Zap, AlertTriangle, Send, X, Check
} from 'lucide-react';
import Panel from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';
import { formatNumber, formatCurrency } from '../../../utils/formatters';

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

/**
 * Panel 9c: Interactive Coverage Explorer
 * Floor price slider, term selector, hashrate input, indicative premium display,
 * and formal quote request CTA.
 */
export default function CoverageExplorerPanel() {
  const [term, setTerm] = useState('12mo');
  const [hashrate, setHashrate] = useState('');
  const [floorPrice, setFloorPrice] = useState(50);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteSuccess, setQuoteSuccess] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const debounceRef = useRef(null);

  // Fetch risk profile for suggested floors and fleet data
  const { data: profileData } = useApi('/v1/insurance/risk-profile', {
    refreshInterval: 5 * 60 * 1000,
  });

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
        `${import.meta.env.VITE_API_URL || '/api'}/v1/insurance/quotes/indicative?floor_price=${floor}&term_months=${termConfig?.months || 12}&hashrate_th=${hr}`
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
  }, []);

  // Debounce slider / input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchIndicative(floorPrice, term, hashrate);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [floorPrice, term, hashrate, fetchIndicative]);

  const handlePreset = (preset) => {
    const floor = suggestedFloors[preset.percentile];
    if (floor != null) {
      setFloorPrice(floor);
    }
  };

  const handleSubmitQuote = async () => {
    setQuoteSubmitting(true);
    setQuoteError(null);
    try {
      const termConfig = TERMS.find(t => t.key === term);
      await postApi('/v1/insurance/quotes/request', {
        floor_price: floorPrice,
        term_months: termConfig?.months || 12,
        hashrate_th: parseFloat(hashrate),
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
            These are indicative estimates only. Formal quotes may differ based on detailed underwriting review.
          </p>
        </div>

        {/* Floor Price Slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-terminal-text">Floor Price ($/PH/day)</label>
            <span className="text-sm font-bold text-terminal-cyan font-mono">
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

        {/* Preset Buttons */}
        <div className="flex gap-2">
          {PRESETS.map(preset => (
            <button
              key={preset.key}
              onClick={() => handlePreset(preset)}
              className={`flex-1 px-2 py-1.5 text-xs border border-terminal-border rounded hover:bg-terminal-border/50 transition-colors ${preset.color}`}
            >
              {preset.label}
              {suggestedFloors[preset.percentile] != null && (
                <span className="block text-[10px] text-terminal-muted font-mono">
                  ${formatNumber(suggestedFloors[preset.percentile], 2)}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Term Selector */}
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

        {/* Hashrate Input */}
        <div>
          <label className="text-xs font-semibold text-terminal-text mb-2 block">Covered Hashrate (TH/s)</label>
          <div className="relative">
            <Zap size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" />
            <input
              type="number"
              value={hashrate}
              onChange={(e) => setHashrate(e.target.value)}
              placeholder="Enter hashrate"
              className="w-full bg-terminal-bg border border-terminal-border rounded pl-8 pr-3 py-2 text-sm text-terminal-text font-mono placeholder:text-terminal-muted/50 focus:outline-none focus:border-terminal-cyan"
            />
          </div>
        </div>

        {/* Indicative Premium Display */}
        <div className="bg-terminal-bg/50 border border-terminal-border rounded p-4">
          <p className="text-xs font-semibold text-terminal-text mb-3 flex items-center gap-1.5">
            <DollarSign size={12} className="text-terminal-green" />
            Indicative Premium
            {indicativeLoading && (
              <span className="ml-2 text-[10px] text-terminal-muted animate-pulse">Calculating...</span>
            )}
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-[10px] text-terminal-muted uppercase">Monthly</p>
              <p className="text-lg font-bold text-terminal-green font-mono">
                {monthlyCost != null ? formatCurrency(monthlyCost, 'USD', 0) : '--'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-terminal-muted uppercase">Annual</p>
              <p className="text-lg font-bold text-terminal-text font-mono">
                {annualCost != null ? formatCurrency(annualCost, 'USD', 0) : '--'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-terminal-muted uppercase">Per TH/s</p>
              <p className="text-lg font-bold text-terminal-text font-mono">
                {costPerTH != null ? `$${formatNumber(costPerTH, 2)}` : '--'}
              </p>
            </div>
          </div>
        </div>

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
                  <p className="text-xs text-terminal-muted mt-1">Our underwriting team will review your request.</p>
                </div>
              ) : (
                <>
                  <div className="bg-terminal-bg/50 rounded p-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-terminal-muted">Floor Price</span>
                      <span className="text-terminal-text font-mono">${formatNumber(floorPrice, 2)}/PH/day</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-terminal-muted">Term</span>
                      <span className="text-terminal-text">{TERMS.find(t => t.key === term)?.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-terminal-muted">Hashrate</span>
                      <span className="text-terminal-text font-mono">{formatNumber(parseFloat(hashrate) || 0, 0)} TH/s</span>
                    </div>
                    {monthlyCost != null && (
                      <div className="flex justify-between pt-2 border-t border-terminal-border">
                        <span className="text-terminal-muted">Est. Monthly Premium</span>
                        <span className="text-terminal-green font-mono">{formatCurrency(monthlyCost, 'USD', 0)}</span>
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
