import React, { useState, useEffect } from 'react';

/**
 * Heat Rate / Efficiency Hedge - simplified fleet efficiency waterfall.
 * Shows machine class bars with breakeven heights,
 * current energy price line, and a "virtual breakeven" hedge line
 * that animates downward to show the efficiency improvement.
 */
export default function HeatRateHedgeViz() {
  const [hedgeOffset, setHedgeOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setHedgeOffset(1), 400);
    return () => clearTimeout(timer);
  }, []);

  const w = 200;
  const h = 120;
  const padL = 28;
  const padR = 8;
  const padT = 8;
  const padB = 24;
  const plotH = h - padT - padB;

  // Machine classes with breakeven $/kWh
  const machines = [
    { label: 'S21 Pro', efficiency: 15, breakeven: 0.12, color: '#00d26a' },
    { label: 'S19 XP', efficiency: 21, breakeven: 0.085, color: '#00d4ff' },
    { label: 'S19', efficiency: 34, breakeven: 0.052, color: '#ffb800' },
  ];

  const maxBE = 0.14;
  const energyPrice = 0.065; // Current $/kWh
  const hedgedBE = 0.045; // Virtual breakeven after hedge

  const scaleY = (v) => padT + plotH - (v / maxBE) * plotH;
  const barW = 36;
  const gap = 12;
  const startX = padL + 10;

  const energyY = scaleY(energyPrice);
  const hedgedY = scaleY(hedgedBE);
  const actualHedgedY = hedgedY + (energyY - hedgedY) * (1 - hedgeOffset);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[200px]">
      {/* Y axis */}
      <line x1={padL} y1={padT} x2={padL} y2={h - padB} stroke="#333" strokeWidth={0.5} />

      {/* Machine bars */}
      {machines.map((m, i) => {
        const x = startX + i * (barW + gap);
        const barTop = scaleY(m.breakeven);
        const barHeight = h - padB - barTop;
        return (
          <g key={i}>
            <rect x={x} y={barTop} width={barW} height={barHeight} rx={2} fill={m.color} opacity={0.25} />
            <rect x={x} y={barTop} width={barW} height={2} rx={1} fill={m.color} opacity={0.8} />
            <text x={x + barW / 2} y={h - padB + 12} textAnchor="middle" fill="#888" style={{ fontSize: '7px' }}>
              {m.label}
            </text>
          </g>
        );
      })}

      {/* Energy price line */}
      <line x1={padL} y1={energyY} x2={w - padR} y2={energyY} stroke="#ff3b30" strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />
      <text x={padL - 4} y={energyY + 3} textAnchor="end" fill="#ff3b30" style={{ fontSize: '7px' }}>
        ${energyPrice.toFixed(2)}
      </text>

      {/* Virtual breakeven hedge line (animated) */}
      <line
        x1={padL}
        y1={actualHedgedY}
        x2={w - padR}
        y2={actualHedgedY}
        stroke="#00d26a"
        strokeWidth={1.5}
        strokeDasharray="6,3"
        opacity={hedgeOffset}
        className="transition-all duration-1000 ease-out"
      />
      {hedgeOffset > 0 && (
        <text x={w - padR} y={scaleY(hedgedBE) - 4} textAnchor="end" fill="#00d26a" style={{ fontSize: '7px' }} opacity={hedgeOffset} className="transition-opacity duration-1000">
          Hedged BE
        </text>
      )}

      {/* Y axis labels */}
      {[0, 0.05, 0.10].map(v => (
        <text key={v} x={padL - 4} y={scaleY(v) + 3} textAnchor="end" fill="#666" style={{ fontSize: '7px' }}>
          {v.toFixed(2)}
        </text>
      ))}
    </svg>
  );
}
