import React from 'react';
import { ArrowRight, BarChart3 } from 'lucide-react';
import Panel from '../../Panel';
import GlossaryTerm from '../../GlossaryTerm';
import QuarqSpreadViz from './visualizations/QuarqSpreadViz';
import SyntheticPPAViz from './visualizations/SyntheticPPAViz';
import ProxyRevenueSwapViz from './visualizations/ProxyRevenueSwapViz';
import HeatRateHedgeViz from './visualizations/HeatRateHedgeViz';

const INSTRUMENTS = [
  {
    id: 'quarq_spread',
    name: 'Quarq Spread',
    dotColor: '#8B7355',
    energyAnalogy: 'Spark Spread (gas plant gross margin)',
    plainEnglish:
      "Like measuring a gas plant's profit margin, but for Bitcoin mining: hashprice revenue minus electricity cost, adjusted for how efficient your machines are.",
    howItWorks: [
      'Quarq Spread = Hashprice Revenue \u2212 (Energy Cost \u00D7 Fleet Efficiency Factor)',
      'When spread is positive, mining is profitable. When negative, you\u2019re losing money.',
      'Sangha can guarantee a minimum spread \u2014 if your actual spread drops below the floor, Sangha pays the difference.',
      'Your fleet\u2019s efficiency curve determines the \u201Cheat rate\u201D equivalent \u2014 less efficient machines have a thinner spread.',
    ],
    risksAddressed: ['Energy price spikes', 'Hashprice compression'],
    Visualization: QuarqSpreadViz,
    coverageMode: 'quarq_spread',
    glossaryId: 'quarq_spread',
  },
  {
    id: 'synthetic_ppa',
    name: 'Synthetic PPA (CfD)',
    dotColor: '#4A5568',
    energyAnalogy: 'Contract for Difference / Virtual PPA',
    plainEnglish:
      'A financial bet where no physical electricity changes hands \u2014 you lock a strike price for hashprice, and Sangha settles the difference vs. market in cash.',
    howItWorks: [
      'You agree on a \u201Cstrike\u201D hashprice with Sangha (e.g., $50/PH/day)',
      'If market hashprice falls below strike \u2192 Sangha pays you the difference',
      'If market hashprice rises above strike \u2192 you pay Sangha a share of the upside',
      'No physical delivery \u2014 pure financial settlement, just like a virtual PPA in energy markets',
    ],
    risksAddressed: ['Hashprice volatility', 'Revenue predictability'],
    Visualization: SyntheticPPAViz,
    coverageMode: 'synthetic_ppa',
    glossaryId: 'synthetic_ppa',
  },
  {
    id: 'proxy_revenue_swap',
    name: 'Proxy Revenue Swap',
    dotColor: '#8B4A5E',
    energyAnalogy: 'Proxy Revenue Swap (wind/solar)',
    plainEnglish:
      'A hedge that covers both price risk (BTC crashes) and volume risk (difficulty spikes reduce your effective output) \u2014 like insuring a wind farm against both low power prices AND no wind.',
    howItWorks: [
      'Combines BTC price protection with difficulty/hashrate volume protection',
      'Even if BTC price holds, a 50% difficulty increase halves your effective revenue \u2014 this covers that',
      'Settlement based on actual hashprice (which embeds both BTC price and difficulty)',
      'Analogous to how a wind farm PRS covers both power price AND generation volume (wind variability)',
    ],
    risksAddressed: [
      'BTC price crash',
      'Difficulty spike',
      'Combined revenue compression',
    ],
    Visualization: ProxyRevenueSwapViz,
    coverageMode: 'proxy_revenue',
    glossaryId: 'proxy_revenue_swap',
  },
  {
    id: 'heat_rate_hedge',
    name: 'Heat Rate / Efficiency Hedge',
    dotColor: '#5B7B6F',
    energyAnalogy: 'Heat Rate Call Option (gas plant)',
    plainEnglish:
      'Insurance that lets an inefficient miner operate as if they had better machines \u2014 Sangha absorbs the efficiency gap so the miner still hits their floor.',
    howItWorks: [
      'Your S19 fleet runs at 34 J/TH. S21 Pro runs at 15 J/TH. That\u2019s a 2.3x efficiency gap.',
      'Sangha prices coverage as if your fleet were more efficient \u2014 you pay a higher premium to close the gap',
      'When energy prices spike, efficient fleets survive but yours would be curtailed. This hedge keeps you running.',
      'Analogous to a gas plant buying a heat rate call \u2014 converting an inefficient plant into an economically efficient one',
    ],
    risksAddressed: [
      'Fleet obsolescence',
      'Energy price sensitivity',
      'Competitive disadvantage',
    ],
    Visualization: HeatRateHedgeViz,
    coverageMode: 'efficiency_hedge',
    glossaryId: 'heat_rate_hedge',
  },
];

function InstrumentCard({ instrument, onExplore }) {
  const { name, dotColor, energyAnalogy, plainEnglish, howItWorks, risksAddressed, Visualization, glossaryId } = instrument;
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className="bg-terminal-bg/50 border border-terminal-border rounded-lg p-4 flex flex-col hover:border-terminal-green/30 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-terminal-text truncate">
            <GlossaryTerm id={glossaryId}>{name}</GlossaryTerm>
          </h4>
          <p className="text-[10px] text-terminal-cyan truncate">{energyAnalogy}</p>
        </div>
      </div>

      {/* Plain English */}
      <p className="text-[11px] text-terminal-muted leading-relaxed mb-3">
        {plainEnglish}
      </p>

      {/* Mini Visualization */}
      <div className="flex justify-center mb-3">
        <Visualization />
      </div>

      {/* How it works (expandable) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] text-terminal-cyan hover:underline mb-2 text-left"
      >
        {expanded ? 'Hide mechanics \u25B2' : 'How it works \u25BC'}
      </button>
      {expanded && (
        <ul className="space-y-1.5 mb-3">
          {howItWorks.map((step, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[10px] text-terminal-muted leading-relaxed">
              <span className="text-terminal-cyan mt-0.5 flex-shrink-0">\u2022</span>
              <span>{step}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Risks addressed */}
      <div className="flex flex-wrap gap-1 mb-3 mt-auto">
        {risksAddressed.map((risk, i) => (
          <span
            key={i}
            className="text-[9px] px-1.5 py-0.5 rounded bg-terminal-border/50 text-terminal-muted"
          >
            {risk}
          </span>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => onExplore && onExplore(instrument.coverageMode)}
        className="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs bg-terminal-green/10 text-terminal-green border border-terminal-green/20 rounded hover:bg-terminal-green/20 transition-colors font-medium"
      >
        Explore Coverage
        <ArrowRight size={12} />
      </button>
    </div>
  );
}

/**
 * Panel 9e: Financial Instruments
 * Educational panel mapping Sangha coverage products to traditional energy market derivatives.
 */
export default function FinancialInstrumentsPanel({ onExploreCoverage }) {
  return (
    <Panel
      title="Financial Instruments"
      source="Sangha"
      loading={false}
      headerRight={
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-terminal-cyan" />
          <span className="text-xs text-terminal-muted">Phase 9</span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Header description */}
        <div className="flex items-start gap-2 text-[11px] text-terminal-muted leading-relaxed">
          <BarChart3 size={14} className="text-terminal-cyan mt-0.5 flex-shrink-0" />
          <p>
            How Sangha coverage maps to traditional energy market instruments.
            Each product type uses familiar financial structures adapted for Bitcoin mining economics.
            <span className="text-[10px] text-terminal-muted/60 block mt-1">
              These descriptions are educational. Actual product terms are determined during formal quoting.
            </span>
          </p>
        </div>

        {/* 4-card grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {INSTRUMENTS.map((instrument) => (
            <InstrumentCard
              key={instrument.id}
              instrument={instrument}
              onExplore={onExploreCoverage}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}
