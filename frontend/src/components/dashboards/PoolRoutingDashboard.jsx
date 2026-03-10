import React, { useState } from 'react';

// ─── Demo Data ──────────────────────────────────────────────────────────────

const TICKER = [
  { label: 'Primary Pool', value: 'ViaBTC', valueClass: 'sm', sub: 'PPS+ · Connected', subClass: 'green', highlight: true },
  { label: 'Pool Fee', value: '4.0', unit: '%', sub: 'PPS rate', subClass: 'flat' },
  { label: 'Hashrate Allocated', value: '72.4', unit: ' PH/s', sub: '100% to ViaBTC', subClass: 'flat' },
  { label: '24H Earnings', value: '0.0841', unit: ' BTC', sub: '$5,124 at spot', subClass: 'green' },
  { label: 'Effective Rate', value: '$47.20', unit: ' /PH/day', sub: 'Net of fees', subClass: 'flat' },
  { label: 'Pool Luck (7D)', value: '98', unit: '%', sub: 'Within normal range', subClass: 'flat' },
];

const POOLS = [
  { name: 'ViaBTC', tag: 'Current', tagClass: 'primary', method: 'PPS+', fee: '4.0%', feeClass: '', rate: '$47.20', rateClass: '', luck: '98%', luckClass: '', uptime: '99.9%', uptimeClass: 'green', delta: '—', deltaClass: '', current: true },
  { name: 'Foundry USA', method: 'FPPS', fee: '2.0%', feeClass: 'best', rate: '$48.16', rateClass: 'best', luck: '102%', luckClass: '', uptime: '99.8%', uptimeClass: 'green', delta: '+$0.96', deltaClass: 'green' },
  { name: 'Braiins Pool', method: 'FPPS', fee: '2.0%', feeClass: 'best', rate: '$48.10', rateClass: 'best', luck: '97%', luckClass: '', uptime: '99.7%', uptimeClass: 'green', delta: '+$0.90', deltaClass: 'green' },
  { name: 'F2Pool', method: 'FPPS', fee: '4.0%', feeClass: '', rate: '$47.18', rateClass: '', luck: '101%', luckClass: '', uptime: '99.6%', uptimeClass: 'green', delta: '-$0.02', deltaClass: 'warn' },
  { name: 'AntPool', method: 'PPS+', fee: '4.0%', feeClass: '', rate: '$47.30', rateClass: '', luck: '105%', luckClass: 'green', uptime: '99.9%', uptimeClass: 'green', delta: '+$0.10', deltaClass: 'green' },
  { name: 'Luxor', method: 'FPPS', fee: '2.5%', feeClass: '', rate: '$47.88', rateClass: '', luck: '96%', luckClass: '', uptime: '99.5%', uptimeClass: 'green', delta: '+$0.68', deltaClass: 'green' },
  { name: 'Ocean Pool', tag: 'New', tagClass: 'watch', method: 'PPLNS', fee: '2.0%', feeClass: 'best', rate: '$46.40', rateClass: 'warn', luck: '88%', luckClass: 'warn', uptime: '99.2%', uptimeClass: '', delta: '-$0.80', deltaClass: 'danger' },
];

const ALLOCATIONS = [
  { name: 'ViaBTC (PPS+)', pct: '90%', hash: '65.2 PH/s', color: '#1a6b3c' },
  { name: 'Foundry USA (FPPS)', pct: '5%', hash: '3.6 PH/s', color: '#b8860b' },
  { name: 'Braiins Pool (FPPS)', pct: '5%', hash: '3.6 PH/s', color: '#c5c5bc' },
];

const EVENTS = [
  { time: 'Today', type: 'info', title: 'Quarterly fee analysis completed', sub: 'Foundry USA identified as optimal secondary pool · $1,440/mo savings opportunity' },
  { time: 'Mar 5', type: 'luck', title: 'ViaBTC luck recovered to 98% (7D rolling)', sub: 'Was 91% on Feb 28 · Normal variance, no action needed' },
  { time: 'Mar 3', type: 'fee', title: 'Transaction fee spike: 28% of block reward', sub: 'PPS+ captured $840 excess vs PPS baseline · ViaBTC auto-distributed' },
  { time: 'Mar 1', type: 'info', title: 'Monthly earnings report generated', sub: 'February: 2.3140 BTC earned · 0.0964 BTC in fees · Effective rate: $46.80/PH/day' },
  { time: 'Feb 28', type: 'alert', title: 'ViaBTC luck dropped to 91% (7D rolling)', sub: 'Below 95% threshold · Monitoring — no reallocation recommended for PPS+ payout' },
  { time: 'Feb 25', type: 'switch', title: 'Test allocation: 5% hashrate routed to Foundry USA', sub: '3.6 PH/s redirected during planned maintenance window · Monitoring performance' },
];

const EARNINGS_BARS = [62,58,65,70,68,55,52,60,72,78,75,68,62,58,54,50,48,52,58,62,65,60,55,58,62,68,72,70,65,68];

const VIABTC_STATS = [
  { k: 'Payout Method', v: 'PPS+' }, { k: 'Pool Fee', v: '4.0%', cls: 'warn' },
  { k: 'Avg Luck (30D)', v: '99%' }, { k: 'Reject Rate', v: '0.02%', cls: 'green' },
  { k: 'Uptime', v: '99.94%', cls: 'green' }, { k: 'Payout Frequency', v: 'Daily' },
];

const FEE_IMPACT = [
  { k: 'ViaBTC (4.0% PPS)', v: '$3,060/mo', cls: 'warn' },
  { k: 'Foundry (2.0% FPPS)', v: '$1,530/mo', cls: 'green' },
  { k: 'Braiins (2.0% FPPS)', v: '$1,530/mo', cls: 'green' },
  { k: 'Luxor (2.5% FPPS)', v: '$1,912/mo' },
  { k: 'F2Pool (4.0% FPPS)', v: '$3,060/mo', cls: 'warn' },
  { k: 'Ocean (2.0% PPLNS)', v: 'Variable', cls: 'muted' },
];

const AGENT_CFG = [
  { k: 'Mode', v: 'Copilot', cls: 'accent' }, { k: 'Review Cadence', v: 'Quarterly' },
  { k: 'Luck Alert Threshold', v: '95%' }, { k: 'Auto-Switch', v: 'Disabled', cls: 'muted' },
  { k: 'Maintenance Window', v: 'Tue 02:00-04:00' }, { k: 'Min Test Allocation', v: '5%' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const VAL_CLS = {
  green: 'text-[#1a6b3c]', warn: 'text-[#b8860b]', danger: 'text-[#c0392b]',
  best: 'text-[#1a6b3c] font-bold', accent: 'text-[#1a6b3c]', muted: 'text-terminal-muted', '': 'text-terminal-text',
};

const EV_DOTS = { switch: 'bg-[#2563eb]', fee: 'bg-[#b8860b]', luck: 'bg-[#2dd478]', alert: 'bg-[#c0392b]', info: 'bg-[#9a9a92]' };

const SUB_CLS = { green: 'text-[#1a6b3c] font-semibold', warn: 'text-[#b8860b] font-semibold', flat: 'text-terminal-muted' };

function Card({ title, meta, children }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">{title}</span>
        {meta && <span className="text-[11px] text-terminal-muted">{meta}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function KVRow({ label, value, cls = '', last = false }) {
  return (
    <div className={`flex items-center justify-between px-[18px] py-[10px] ${last ? '' : 'border-b border-[#f0eeea]'} text-[13px]`}>
      <span className="text-[#6b6b65]">{label}</span>
      <span className={`font-semibold tabular-nums font-mono text-xs ${VAL_CLS[cls] || 'text-terminal-text'}`}>{value}</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function PoolRoutingDashboard() {
  const [timeRange, setTimeRange] = useState('7D');
  const [poolFilter, setPoolFilter] = useState('All Pools');

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Top bar */}
      <div className="flex items-center justify-end gap-2 mb-5">
        {['1D', '7D', '30D', '90D'].map(r => (
          <button key={r} onClick={() => setTimeRange(r)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
              timeRange === r ? 'bg-terminal-text text-white border-terminal-text' : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
            }`}>{r}</button>
        ))}
        <div className="w-px h-5 bg-terminal-border mx-1" />
        <button onClick={() => alert('Pool analysis running — comparing fee structures, luck variance, and effective rates across all pools.')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-green text-white border border-terminal-green hover:opacity-90 transition-all">
          Run Analysis
        </button>
      </div>

      {/* Ticker */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border border-terminal-border rounded-[14px] overflow-hidden mb-4" style={{ gap: '1px', background: 'var(--t-border)' }}>
        {TICKER.map((t, i) => (
          <div key={i} className="bg-terminal-panel p-[14px_18px]" style={t.highlight ? { background: 'linear-gradient(135deg, var(--t-panel), #edf7f0)' } : {}}>
            <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1">{t.label}</div>
            <div className={`font-bold text-terminal-text tabular-nums leading-none ${t.valueClass === 'sm' ? 'text-[15px]' : 'text-xl font-mono'}`}>
              {t.value}{t.unit && <span className="text-[11px] font-medium text-terminal-muted">{t.unit}</span>}
            </div>
            <div className={`text-[10px] mt-1 ${SUB_CLS[t.subClass]}`}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* Pool Comparison Table */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-4">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Pool Comparison — Live Fee & Performance Analysis</span>
          <div className="flex gap-1">
            {['All Pools', 'FPPS Only', 'PPS+ Only'].map((f) => (
              <button key={f} onClick={() => setPoolFilter(f)} className={`px-3 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                poolFilter === f ? 'bg-terminal-text text-white border-terminal-text' : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
              }`}>{f}</button>
            ))}
          </div>
        </div>
        {/* Header */}
        <div className="grid items-center gap-2 px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
          style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr 100px' }}>
          <div>Pool</div><div>Method</div><div>Fee</div><div>Eff. Rate</div><div>Luck (7D)</div><div>Uptime</div><div>30D Delta</div><div></div>
        </div>
        {/* Rows */}
        {POOLS.filter(p => poolFilter === 'All Pools' || (poolFilter === 'FPPS Only' && p.method === 'FPPS') || (poolFilter === 'PPS+ Only' && p.method === 'PPS+')).map((p, i) => (
          <div key={i}
            className={`grid items-center gap-2 px-[18px] py-[13px] border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors text-[13px] ${p.current ? 'bg-[#edf7f0] border-l-[3px] border-l-[#1a6b3c]' : ''}`}
            style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr 100px' }}>
            <div className="font-semibold text-terminal-text flex items-center gap-2">
              {p.name}
              {p.tag && <span className={`text-[9px] font-bold px-[7px] py-[2px] rounded-[5px] uppercase tracking-[0.3px] ${
                p.tagClass === 'primary' ? 'bg-[#edf7f0] text-[#1a6b3c]' : 'bg-[#fdf6e8] text-[#b8860b]'
              }`}>{p.tag}</span>}
            </div>
            <div className="font-mono text-xs">{p.method}</div>
            <div className={`font-mono text-xs ${VAL_CLS[p.feeClass]}`}>{p.fee}</div>
            <div className={`font-mono text-xs ${VAL_CLS[p.rateClass]}`}>{p.rate}</div>
            <div className={`font-mono text-xs ${VAL_CLS[p.luckClass]}`}>{p.luck}</div>
            <div className={`font-mono text-xs ${VAL_CLS[p.uptimeClass]}`}>{p.uptime}</div>
            <div className={`font-mono text-xs ${VAL_CLS[p.deltaClass]}`}>{p.delta}</div>
            <div>
              <span onClick={() => !p.current && alert(`Simulating switch to ${p.name}...`)} className={`text-[11px] font-semibold px-3 py-1 rounded-md border cursor-pointer transition-all ${
                p.current ? 'bg-[#edf7f0] text-[#1a6b3c] border-[#1a6b3c]' : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
              }`}>{p.current ? 'Connected' : 'Simulate'}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Allocation + Agent Recommendation */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        <Card title="Current Allocation" meta="All hashrate">
          <div className="flex items-center gap-6 p-[24px_18px]">
            {/* Donut */}
            <div className="w-[140px] h-[140px] rounded-full shrink-0 relative"
              style={{ background: 'conic-gradient(#1a6b3c 0deg 324deg, #b8860b 324deg 342deg, #c5c5bc 342deg 360deg)' }}>
              <div className="absolute inset-5 bg-terminal-panel rounded-full flex flex-col items-center justify-center">
                <div className="font-mono text-[22px] font-bold text-terminal-text">72.4</div>
                <div className="text-[10px] text-terminal-muted mt-0.5">PH/s total</div>
              </div>
            </div>
            {/* Legend */}
            <div className="flex-1">
              {ALLOCATIONS.map((a, i) => (
                <div key={i} className="flex items-center gap-2.5 py-2 border-b border-[#f0eeea] last:border-b-0">
                  <div className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: a.color }} />
                  <div className="text-[13px] font-medium text-terminal-text flex-1">{a.name}</div>
                  <div className="font-mono text-[13px] font-semibold text-terminal-text">{a.pct}</div>
                  <div className="font-mono text-[11px] text-terminal-muted min-w-[70px] text-right">{a.hash}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Agent Recommendation" meta="Quarterly Review">
          <div className="p-[18px]">
            <div className="bg-[#fdf6e8] border border-[rgba(184,134,11,0.15)] rounded-[10px] p-[14px_16px] mb-3.5">
              <div className="text-[11px] font-bold text-[#b8860b] uppercase tracking-[0.8px] mb-1.5">Optimization Opportunity</div>
              <div className="text-[13px] text-terminal-text leading-[1.5]">
                Foundry USA and Braiins Pool are both offering FPPS at 2.0% — half of ViaBTC's 4.0% PPS rate.
                At current hashrate, shifting 50% of allocation to Foundry would save approximately{' '}
                <strong className="text-[#1a6b3c]">$1,440/month</strong> in pool fees alone.
              </div>
            </div>
            <KVRow label="Current Monthly Fees" value="$3,060" />
            <KVRow label="Optimized Monthly Fees" value="$1,620" cls="green" />
            <KVRow label="Monthly Savings" value="$1,440" cls="green" />
            <KVRow label="Annual Impact" value="$17,280" cls="green" />
            <KVRow label="Risk Assessment" value="Low — FPPS eliminates variance" cls="accent" last />
          </div>
        </Card>
      </div>

      {/* Earnings + Event Log */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        <Card title="Daily Earnings — 30 Day" meta="BTC">
          <div className="flex items-end gap-[2px] px-[18px] pt-[18px] h-[80px]">
            {EARNINGS_BARS.map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-[#1a6b3c] opacity-70 hover:opacity-100 transition-opacity min-w-[2px]"
                style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="flex justify-between px-[18px] pt-1 pb-3 font-mono text-[8px] text-[#c5c5bc]">
            <span>Feb 5</span><span>Feb 12</span><span>Feb 19</span><span>Feb 26</span><span>Mar 5</span>
          </div>
          <div className="px-[18px] pb-4">
            <KVRow label="30D Total" value="2.4830 BTC" />
            <KVRow label="30D Avg Daily" value="0.0828 BTC" />
            <KVRow label="vs Expected (PPS)" value="+1.2%" cls="green" />
            <KVRow label="Fees Paid (30D)" value="0.1034 BTC" cls="warn" last />
          </div>
        </Card>

        <Card title="Pool Events" meta="Last 7 days">
          {EVENTS.map((ev, i) => (
            <div key={i} className="flex items-start gap-3 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
              <div className="font-mono text-[11px] font-medium text-terminal-muted min-w-[40px] shrink-0 mt-0.5 tabular-nums">{ev.time}</div>
              <div className={`w-1 h-1 rounded-full mt-[7px] shrink-0 ${EV_DOTS[ev.type]}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-terminal-text leading-[1.4]">{ev.title}</div>
                <div className="text-[11px] text-terminal-muted mt-0.5">{ev.sub}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Bottom: ViaBTC Stats + Fee Impact + Agent Config */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card title="ViaBTC Performance" meta="30-day">
          {VIABTC_STATS.map((item, i) => (
            <KVRow key={i} label={item.k} value={item.v} cls={item.cls || ''} last={i === VIABTC_STATS.length - 1} />
          ))}
        </Card>

        <Card title="Fee Impact Analysis" meta="At current hashrate">
          {FEE_IMPACT.map((item, i) => (
            <KVRow key={i} label={item.k} value={item.v} cls={item.cls || ''} last={i === FEE_IMPACT.length - 1} />
          ))}
        </Card>

        <Card title="Agent Config" meta="Pool Routing">
          {AGENT_CFG.map((item, i) => (
            <KVRow key={i} label={item.k} value={item.v} cls={item.cls || ''} last={i === AGENT_CFG.length - 1} />
          ))}
        </Card>
      </div>
    </div>
  );
}
