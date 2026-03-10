import React, { useState, useEffect } from 'react';
import { RefreshCw, Download, Camera, Settings, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, AlertTriangle, Info, Circle } from 'lucide-react';
import { formatTimeAgo, formatNumber, formatCurrency, exportToCSV } from '../utils/formatters';
import { useApi, postApi } from '../hooks/useApi';
import {
  calculateLiquiditySignals,
  EXAMPLE_INPUTS,
  EMPTY_INPUTS
} from '../utils/liquidityScoring';
import html2canvas from 'html2canvas';

// ============================================================================
// DATA FRESHNESS INDICATOR COMPONENT
// ============================================================================

function FreshnessIndicator({ freshness, source, date }) {
  const config = {
    fresh: { color: 'text-terminal-green', bg: 'bg-terminal-green', label: 'Fresh' },
    stale: { color: 'text-terminal-amber', bg: 'bg-terminal-amber', label: 'Stale' },
    very_stale: { color: 'text-terminal-red', bg: 'bg-terminal-red', label: 'Very Stale' },
    manual: { color: 'text-terminal-blue', bg: 'bg-terminal-blue', label: 'Manual' },
    unknown: { color: 'text-terminal-muted', bg: 'bg-terminal-muted', label: 'Unknown' }
  };

  const c = config[freshness] || config.unknown;
  const sourceLabel = source === 'fred' ? 'FRED' : source === 'yahoo' ? 'Yahoo' : source === 'manual' ? 'Manual' : source || 'N/A';

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${c.bg} ml-1`}
      title={`${c.label} | Source: ${sourceLabel}${date ? ` | Date: ${date}` : ''}`}
    />
  );
}

// ============================================================================
// SIGNAL BADGE COMPONENT
// ============================================================================

function SignalBadge({ signal, size = 'default' }) {
  const config = {
    BUY: { bg: 'bg-terminal-green/20', border: 'border-terminal-green/50', text: 'text-terminal-green', icon: TrendingUp },
    SELL: { bg: 'bg-terminal-red/20', border: 'border-terminal-red/50', text: 'text-terminal-red', icon: TrendingDown },
    CAUTIOUS: { bg: 'bg-terminal-red/10', border: 'border-terminal-red/30', text: 'text-terminal-red', icon: ChevronDown },
    NEUTRAL: { bg: 'bg-terminal-amber/20', border: 'border-terminal-amber/50', text: 'text-terminal-amber', icon: Minus }
  };

  const c = config[signal] || config.NEUTRAL;
  const Icon = c.icon;
  const sizeClass = size === 'large' ? 'px-4 py-2 text-lg' : 'px-2 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1 ${sizeClass} rounded border ${c.bg} ${c.border} ${c.text} font-bold`}>
      <Icon size={size === 'large' ? 20 : 12} />
      {signal}
    </span>
  );
}

// ============================================================================
// SCORE BAR COMPONENT
// ============================================================================

function ScoreBar({ label, value, description }) {
  if (value === null || value === undefined) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-terminal-muted">{label}</span>
          <span className="text-terminal-muted">-</span>
        </div>
        <div className="h-2 bg-terminal-border rounded-full" />
      </div>
    );
  }

  // Color gradient: red (0) -> yellow (50) -> green (100)
  const getColor = (v) => {
    if (v >= 60) return 'bg-terminal-green';
    if (v >= 40) return 'bg-terminal-amber';
    return 'bg-terminal-red';
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-terminal-muted">{label}</span>
        <span className={`font-sans ${value >= 50 ? 'text-terminal-green' : 'text-terminal-red'}`}>{value}</span>
      </div>
      <div className="h-2 bg-terminal-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getColor(value)}`}
          style={{ width: `${value}%` }}
        />
      </div>
      {description && <p className="text-xs text-terminal-muted">{description}</p>}
    </div>
  );
}

// ============================================================================
// SCORE BAR WITH FRESHNESS INDICATOR
// ============================================================================

function ScoreBarWithFreshness({ label, value, description, freshness }) {
  if (value === null || value === undefined) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-terminal-muted flex items-center">
            {label}
            {freshness && <FreshnessIndicator {...freshness} />}
          </span>
          <span className="text-terminal-muted">-</span>
        </div>
        <div className="h-2 bg-terminal-border rounded-full" />
      </div>
    );
  }

  // Color gradient: red (0) -> yellow (50) -> green (100)
  const getColor = (v) => {
    if (v >= 60) return 'bg-terminal-green';
    if (v >= 40) return 'bg-terminal-amber';
    return 'bg-terminal-red';
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-terminal-muted flex items-center">
          {label}
          {freshness && <FreshnessIndicator {...freshness} />}
        </span>
        <span className={`font-sans ${value >= 50 ? 'text-terminal-green' : 'text-terminal-red'}`}>{value}</span>
      </div>
      <div className="h-2 bg-terminal-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getColor(value)}`}
          style={{ width: `${value}%` }}
        />
      </div>
      {description && <p className="text-xs text-terminal-muted">{description}</p>}
    </div>
  );
}

// ============================================================================
// ASSET CARD COMPONENT
// ============================================================================

function AssetCard({ name, symbol, price, score, signal, previousSignal, factors }) {
  const [expanded, setExpanded] = useState(false);

  const getPrevSignalColor = (sig) => {
    if (sig === 'BUY') return 'text-terminal-green';
    if (sig === 'SELL' || sig === 'CAUTIOUS') return 'text-terminal-red';
    if (sig === 'NEUTRAL') return 'text-terminal-amber';
    return 'text-terminal-muted';
  };

  return (
    <div className="bg-terminal-bg/50 rounded-lg p-4 border border-terminal-border">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="font-bold text-lg">{name}</h4>
          <p className="text-terminal-muted text-sm">{symbol}</p>
        </div>
        <div className="text-right">
          <SignalBadge signal={signal} />
          <p className={`text-xs mt-1 ${getPrevSignalColor(previousSignal)}`}>
            was {previousSignal || '--'}
          </p>
        </div>
      </div>

      <div className="flex justify-between items-center mb-3">
        <div>
          <p className="text-xs text-terminal-muted">Price</p>
          <p className="text-xl font-sans">{formatCurrency(price, 'USD', price > 1000 ? 0 : 2)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-terminal-muted">Score</p>
          <p className={`text-2xl font-sans font-bold ${score > 0 ? 'text-terminal-green' : score < 0 ? 'text-terminal-red' : 'text-terminal-amber'}`}>
            {score > 0 ? '+' : ''}{score}
          </p>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-xs text-terminal-muted hover:text-terminal-text"
      >
        <span>Factor Breakdown</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && factors && (
        <div className="mt-3 pt-3 border-t border-terminal-border space-y-2 text-xs">
          {Object.entries(factors).map(([key, value]) => (
            <div key={key} className="flex justify-between">
              <span className="text-terminal-muted capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
              <span className={`font-sans ${value > 0 ? 'text-terminal-green' : value < 0 ? 'text-terminal-red' : 'text-terminal-muted'}`}>
                {value > 0 ? '+' : ''}{value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// REGIME STATUS COMPONENT
// ============================================================================

function RegimeStatus({ regimes }) {
  const statusColors = {
    EASING: 'text-terminal-green',
    NEUTRAL: 'text-terminal-amber',
    TIGHTENING: 'text-terminal-red',
    HIGH: 'text-terminal-red',
    ELEVATED: 'text-terminal-amber',
    STABLE: 'text-terminal-green',
    LOW: 'text-terminal-green',
    WEAK: 'text-terminal-red',
    SOFTENING: 'text-terminal-amber',
    TIGHT: 'text-terminal-green',
    STRONG: 'text-terminal-red',
    FIRM: 'text-terminal-amber',
    STRESSED: 'text-terminal-red',
    NORMAL: 'text-terminal-green',
    EASY: 'text-terminal-green'
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {Object.entries(regimes).map(([key, { status, detail }]) => (
        <div key={key} className="bg-terminal-bg/30 rounded p-2">
          <p className="text-xs text-terminal-muted uppercase">{key}</p>
          <p className={`font-bold ${statusColors[status] || 'text-terminal-muted'}`}>{status}</p>
          <p className="text-xs text-terminal-muted font-sans">{detail}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// YIELD CURVE MINI CHART
// ============================================================================

function YieldCurveMini({ yieldCurve }) {
  if (!yieldCurve || !yieldCurve.us2y) return null;

  const points = [
    { label: '2Y', value: yieldCurve.us2y },
    { label: '10Y', value: yieldCurve.us10y },
    { label: '30Y', value: yieldCurve.us30y }
  ];

  const maxY = Math.max(...points.map(p => p.value)) + 0.5;
  const minY = Math.min(...points.map(p => p.value)) - 0.5;
  const range = maxY - minY;

  const svgPoints = points.map((p, i) => {
    const x = 20 + (i * 80);
    const y = 60 - ((p.value - minY) / range) * 50;
    return { ...p, x, y };
  });

  const pathD = svgPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div className="bg-terminal-bg/30 rounded-lg p-3">
      <div className="flex justify-between items-center mb-2">
        <p className="text-xs text-terminal-muted uppercase">Yield Curve</p>
        {yieldCurve.isInverted && (
          <span className="text-xs text-terminal-red flex items-center gap-1">
            <AlertTriangle size={12} />
            INVERTED
          </span>
        )}
      </div>
      <svg viewBox="0 0 200 70" className="w-full h-16">
        <path d={pathD} fill="none" stroke={yieldCurve.isInverted ? '#ff3b30' : '#00d26a'} strokeWidth="2" />
        {svgPoints.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill={yieldCurve.isInverted ? '#ff3b30' : '#00d26a'} />
            <text x={p.x} y="68" textAnchor="middle" fill="#666" fontSize="10">{p.label}</text>
            <text x={p.x} y={p.y - 8} textAnchor="middle" fill="#e5e5e5" fontSize="9" fontFamily="'Exo 2', sans-serif">
              {p.value.toFixed(2)}%
            </text>
          </g>
        ))}
      </svg>
      <p className="text-xs text-terminal-muted text-center mt-1">
        2s10s: <span className={yieldCurve.spread2s10s < 0 ? 'text-terminal-red' : 'text-terminal-green'}>
          {yieldCurve.spread2s10s > 0 ? '+' : ''}{(yieldCurve.spread2s10s * 100).toFixed(0)}bps
        </span>
      </p>
    </div>
  );
}

// ============================================================================
// INPUT EDITOR COMPONENT
// ============================================================================

function InputEditor({ inputs, onUpdate, onClose }) {
  const [form, setForm] = useState(inputs);

  const handleChange = (key, value) => {
    const parsed = value === '' ? null : parseFloat(value);
    setForm({ ...form, [key]: isNaN(parsed) ? value : parsed });
  };

  const handleSubmit = () => {
    onUpdate(form);
    onClose();
  };

  const inputGroups = [
    {
      title: 'Core Components',
      fields: [
        { key: 'moveIndex', label: 'MOVE Index', placeholder: '118' },
        { key: 'us10y', label: '10Y Yield %', placeholder: '4.19' },
        { key: 'dxy', label: 'DXY', placeholder: '97.6' },
        { key: 'fedBS', label: 'Fed BS ($T)', placeholder: '6.05' }
      ]
    },
    {
      title: 'Bitcoin',
      fields: [
        { key: 'btcPrice', label: 'BTC Price', placeholder: '70259' },
        { key: 'btc200dma', label: 'BTC 200DMA', placeholder: '78000' },
        { key: 'btcMvrv', label: 'MVRV', placeholder: '1.35' },
        { key: 'btcFundingRate', label: 'Funding Rate', placeholder: '-0.01' },
        { key: 'btcEtfFlowWeekly', label: 'ETF Flow ($M)', placeholder: '-358' }
      ]
    },
    {
      title: 'Precious Metals',
      fields: [
        { key: 'goldPrice', label: 'Gold Price', placeholder: '4987' },
        { key: 'silverPrice', label: 'Silver Price', placeholder: '77' },
        { key: 'goldSilverRatio', label: 'G/S Ratio', placeholder: '64.7' }
      ]
    },
    {
      title: 'Macro',
      fields: [
        { key: 'cpiYoy', label: 'CPI YoY %', placeholder: '2.8' },
        { key: 'coreYoy', label: 'Core CPI %', placeholder: '3.2' },
        { key: 'us2y', label: '2Y Yield %', placeholder: '4.0' },
        { key: 'us30y', label: '30Y Yield %', placeholder: '4.5' },
        { key: 'unemployment', label: 'Unemployment %', placeholder: '4.1' },
        { key: 'vix', label: 'VIX', placeholder: '18' },
        { key: 'hyOAS', label: 'HY OAS (bps)', placeholder: '350' }
      ]
    },
    {
      title: 'Liquidity Plumbing',
      fields: [
        { key: 'tga', label: 'TGA ($B)', placeholder: '750' },
        { key: 'rrp', label: 'RRP ($B)', placeholder: '200' }
      ]
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden">
        <div className="flex justify-between items-center px-4 py-3 border-b border-terminal-border">
          <h3 className="font-bold">Edit Liquidity Inputs</h3>
          <button onClick={onClose} className="text-terminal-muted hover:text-terminal-text">
            &times;
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[70vh]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {inputGroups.map(group => (
              <div key={group.title}>
                <h4 className="text-sm font-bold text-terminal-muted mb-3">{group.title}</h4>
                <div className="space-y-2">
                  {group.fields.map(field => (
                    <div key={field.key} className="flex items-center gap-2">
                      <label className="text-xs text-terminal-muted w-28 shrink-0">{field.label}</label>
                      <input
                        type="text"
                        value={form[field.key] ?? ''}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="flex-1 bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-sm font-sans"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-6 pt-4 border-t border-terminal-border">
            <button
              onClick={() => setForm(EXAMPLE_INPUTS)}
              className="px-3 py-2 text-sm bg-terminal-blue/20 border border-terminal-blue/30 text-terminal-blue rounded hover:bg-terminal-blue/30"
            >
              Load Example
            </button>
            <button
              onClick={() => setForm(EMPTY_INPUTS)}
              className="px-3 py-2 text-sm bg-terminal-border rounded hover:bg-terminal-muted/20"
            >
              Clear All
            </button>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-terminal-border rounded hover:bg-terminal-border"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 text-sm bg-terminal-green/20 border border-terminal-green/30 text-terminal-green rounded hover:bg-terminal-green/30"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SIGNAL HISTORY COMPONENT
// ============================================================================

function SignalHistory({ history }) {
  if (!history || history.length === 0) {
    return (
      <div className="text-center py-8 text-terminal-muted">
        <p>No signal history yet</p>
        <p className="text-xs mt-1">Signals will be logged here</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {history.slice(0, 10).map((entry, i) => (
        <div key={i} className="flex items-center justify-between text-xs bg-terminal-bg/30 rounded p-2">
          <span className="text-terminal-muted">{formatTimeAgo(entry.timestamp)}</span>
          <div className="flex items-center gap-2">
            <span>Composite: {entry.composite}</span>
            <SignalBadge signal={entry.overallSignal} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// MAIN LIQUIDITY PANEL COMPONENT
// ============================================================================

export default function LiquidityPanel() {
  const panelRef = React.useRef(null);
  const [showEditor, setShowEditor] = useState(false);
  const [inputs, setInputs] = useState(EXAMPLE_INPUTS);
  const [history, setHistory] = useState([]);
  const [sources, setSources] = useState({});

  // Fetch data from API
  const { data: apiData, loading, error, lastFetched, refetch } = useApi(
    '/liquidity',
    { refreshInterval: 5 * 60 * 1000 }
  );

  // Fetch sources/freshness metadata
  const { data: sourcesData, refetch: refetchSources } = useApi(
    '/liquidity/sources',
    { refreshInterval: 5 * 60 * 1000 }
  );

  // Use API data if available, otherwise use local state
  useEffect(() => {
    if (apiData?.inputs) {
      setInputs(prev => ({ ...prev, ...apiData.inputs }));
    }
    if (apiData?.history) {
      setHistory(apiData.history);
    }
  }, [apiData]);

  // Update sources when fetched
  useEffect(() => {
    if (sourcesData?.sources) {
      setSources(sourcesData.sources);
    }
  }, [sourcesData]);

  // Helper to get freshness indicator props for a field
  const getFreshness = (field) => {
    const sourceInfo = sources[field];
    if (!sourceInfo) {
      return { freshness: 'unknown', source: null, date: null };
    }
    return {
      freshness: sourceInfo.freshness || 'unknown',
      source: sourceInfo.source,
      date: sourceInfo.date
    };
  };

  // Get previous signal from history
  const getPreviousSignal = (asset) => {
    if (!history || history.length < 2) return null;
    const prevEntry = history[1]; // Index 0 is current, 1 is previous
    if (!prevEntry) return null;
    if (asset === 'btc') return prevEntry.btc?.signal || prevEntry.btcSignal;
    if (asset === 'gold') return prevEntry.gold?.signal || prevEntry.goldSignal;
    if (asset === 'silver') return prevEntry.silver?.signal || prevEntry.silverSignal;
    return null;
  };

  // Calculate signals
  const result = calculateLiquiditySignals(inputs);

  // Save signal to history when it changes
  const handleSaveSignal = async () => {
    try {
      await postApi('/liquidity/signal', {
        inputs,
        result: {
          composite: result.composite.composite,
          overallSignal: result.overallSignal,
          btcSignal: result.btc.signal,
          goldSignal: result.gold.signal,
          silverSignal: result.silver.signal
        }
      });
      refetch();
    } catch (err) {
      console.error('Failed to save signal:', err);
    }
  };

  const handleScreenshot = async () => {
    if (!panelRef.current) return;
    try {
      const canvas = await html2canvas(panelRef.current, {
        backgroundColor: '#0a0a0a',
        scale: 2
      });
      const link = document.createElement('a');
      link.download = `liquidity_signal_${new Date().toISOString().split('T')[0]}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Screenshot failed:', err);
    }
  };

  const handleExport = () => {
    const exportData = [{
      timestamp: result.timestamp,
      composite: result.composite.composite,
      moveScore: result.composite.moveScore,
      rateScore: result.composite.rateScore,
      dxyScore: result.composite.dxyScore,
      bankScore: result.composite.bankScore,
      overallSignal: result.overallSignal,
      btcScore: result.btc.score,
      btcSignal: result.btc.signal,
      goldScore: result.gold.score,
      goldSignal: result.gold.signal,
      silverScore: result.silver.score,
      silverSignal: result.silver.signal,
      ...inputs
    }];
    exportToCSV(exportData, 'liquidity_signals');
  };

  const compositeColor = result.composite.composite > 50 ? 'text-terminal-green' :
    result.composite.composite > 35 ? 'text-terminal-amber' : 'text-terminal-red';

  return (
    <div ref={panelRef} className="bg-terminal-panel border border-terminal-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border bg-terminal-bg/50">
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-lg">TBL Liquidity Signal</h2>
          <span className="text-xs text-terminal-muted">(DIY Implementation)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEditor(true)}
            className="p-1.5 hover:bg-terminal-border rounded transition-colors"
            title="Edit Inputs"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={() => { refetch(); refetchSources(); }}
            disabled={loading}
            className="p-1.5 hover:bg-terminal-border rounded transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleScreenshot}
            className="p-1.5 hover:bg-terminal-border rounded transition-colors"
            title="Screenshot"
          >
            <Camera size={14} />
          </button>
          <button
            onClick={handleExport}
            className="p-1.5 hover:bg-terminal-border rounded transition-colors"
            title="Export CSV"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="px-4 py-1.5 text-xs text-terminal-muted border-b border-terminal-border flex justify-between">
        <span>Source: {sourcesData?.primarySource === 'fred' ? 'FRED API' : sourcesData?.primarySource === 'yahoo' ? 'Yahoo Finance' : 'Manual Entry'} + Yahoo Finance</span>
        <span>Updated: {formatTimeAgo(lastFetched || result.timestamp)}</span>
      </div>

      <div className="p-4 space-y-6">
        {/* Composite Score Hero */}
        <div className="text-center py-6 bg-terminal-bg/30 rounded-lg">
          <p className="text-sm text-terminal-muted uppercase tracking-wider mb-2">Composite Liquidity Index</p>
          <p className={`text-6xl font-sans font-bold ${compositeColor}`}>
            {result.composite.composite ?? '-'}
          </p>
          <p className={`text-lg mt-2 ${result.composite.isConducive ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {result.composite.composite !== null
              ? (result.composite.isConducive ? 'CONDUCIVE' : 'NOT CONDUCIVE')
              : '-'}
          </p>
          <div className="mt-4">
            <SignalBadge signal={result.overallSignal} size="large" />
          </div>
        </div>

        {/* Component Scores */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-terminal-muted uppercase">Component Scores</h3>
          <ScoreBarWithFreshness
            label="Bond Volatility (MOVE)"
            value={result.composite.moveScore}
            description={`MOVE: ${inputs.moveIndex ?? '-'} | Lower = Better`}
            freshness={getFreshness('moveIndex')}
          />
          <ScoreBarWithFreshness
            label="Treasury Rates (10Y)"
            value={result.composite.rateScore}
            description={`10Y: ${inputs.us10y ?? '-'}% | Lower = Better`}
            freshness={getFreshness('us10y')}
          />
          <ScoreBarWithFreshness
            label="Dollar Strength (DXY)"
            value={result.composite.dxyScore}
            description={`DXY: ${inputs.dxy ?? '-'} | Lower = Better`}
            freshness={getFreshness('dxy')}
          />
          <ScoreBarWithFreshness
            label="Banking Assets (Fed BS)"
            value={result.composite.bankScore}
            description={`Fed BS: $${inputs.fedBS ?? '-'}T | Higher = Better`}
            freshness={getFreshness('fedBS')}
          />
        </div>

        {/* Asset Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AssetCard
            name="Bitcoin"
            symbol="BTC"
            price={inputs.btcPrice}
            score={result.btc.score}
            signal={result.btc.signal}
            previousSignal={getPreviousSignal('btc')}
            factors={result.btc.factors}
          />
          <AssetCard
            name="Gold"
            symbol="XAU"
            price={inputs.goldPrice}
            score={result.gold.score}
            signal={result.gold.signal}
            previousSignal={getPreviousSignal('gold')}
            factors={result.gold.factors}
          />
          <AssetCard
            name="Silver"
            symbol="XAG"
            price={inputs.silverPrice}
            score={result.silver.score}
            signal={result.silver.signal}
            previousSignal={getPreviousSignal('silver')}
            factors={result.silver.factors}
          />
        </div>

        {/* Yield Curve & Regimes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <YieldCurveMini yieldCurve={result.yieldCurve} />
          <div className="bg-terminal-bg/30 rounded-lg p-3">
            <p className="text-xs text-terminal-muted uppercase mb-2">Regime Summary</p>
            <RegimeStatus regimes={result.regimes} />
          </div>
        </div>

        {/* Macro Data Panel */}
        <div className="bg-terminal-bg/30 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-terminal-muted uppercase">Macro Data</h3>
            <div className="flex items-center gap-3 text-xs text-terminal-muted">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-terminal-green"></span> Fresh</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-terminal-amber"></span> Stale</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-terminal-red"></span> Very Stale</span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-terminal-muted">Fed Funds</p>
              <p className="font-sans flex items-center">
                {inputs.fedFundsRate || '-'}
                <FreshnessIndicator {...getFreshness('fedFundsRate')} />
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">CPI YoY</p>
              <p className="font-sans flex items-center">
                {inputs.cpiYoy ? `${inputs.cpiYoy}%` : '-'}
                <FreshnessIndicator {...getFreshness('cpiYoy')} />
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">Core CPI</p>
              <p className="font-sans flex items-center">
                {inputs.coreYoy ? `${inputs.coreYoy}%` : '-'}
                <FreshnessIndicator {...getFreshness('coreYoy')} />
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">Unemployment</p>
              <p className="font-sans flex items-center">
                {inputs.unemployment ? `${inputs.unemployment}%` : '-'}
                <FreshnessIndicator {...getFreshness('unemployment')} />
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">VIX</p>
              <p className="font-sans flex items-center">
                {inputs.vix ?? '-'}
                <FreshnessIndicator {...getFreshness('vix')} />
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">HY OAS</p>
              <p className="font-sans flex items-center">
                {inputs.hyOAS ? `${inputs.hyOAS}bps` : '-'}
                <FreshnessIndicator {...getFreshness('hyOAS')} />
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">TGA</p>
              <p className="font-sans flex items-center">
                {inputs.tga ? `$${inputs.tga}B` : '-'}
                <FreshnessIndicator {...getFreshness('tga')} />
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted">RRP</p>
              <p className="font-sans flex items-center">
                {inputs.rrp ? `$${inputs.rrp}B` : '-'}
                <FreshnessIndicator {...getFreshness('rrp')} />
              </p>
            </div>
          </div>
        </div>

        {/* Signal History */}
        <div className="bg-terminal-bg/30 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-terminal-muted uppercase">Signal History</h3>
            <button
              onClick={handleSaveSignal}
              className="text-xs text-terminal-green hover:underline"
            >
              + Log Current Signal
            </button>
          </div>
          <SignalHistory history={history} />
        </div>

        {/* Disclaimer */}
        <div className="flex items-start gap-2 text-xs text-terminal-muted bg-terminal-bg/30 rounded p-3">
          <Info size={14} className="shrink-0 mt-0.5" />
          <p>
            DIY implementation inspired by The Bitcoin Layer's framework. Not financial advice.
            Scores and signals are for educational purposes only.
          </p>
        </div>
      </div>

      {/* Input Editor Modal */}
      {showEditor && (
        <InputEditor
          inputs={inputs}
          onUpdate={setInputs}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}
