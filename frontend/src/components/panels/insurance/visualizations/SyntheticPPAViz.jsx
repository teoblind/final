import React from 'react';

/**
 * Synthetic PPA / CfD payoff diagram.
 * Classic hockey-stick shape: below strike → Sangha pays (green),
 * above strike → miner shares upside (subtle red).
 */
export default function SyntheticPPAViz() {
  const w = 200;
  const h = 120;
  const padL = 30;
  const padR = 10;
  const padT = 10;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const zeroY = padT + plotH * 0.55;
  const strikeX = padL + plotW * 0.45;

  // Payoff line: below strike slopes up (Sangha pays), above strike slopes down (miner pays)
  const leftX = padL;
  const leftY = padT + plotH * 0.15;
  const rightX = padL + plotW;
  const rightY = padT + plotH * 0.85;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[200px]">
      {/* Grid line at zero */}
      <line x1={padL} y1={zeroY} x2={rightX} y2={zeroY} stroke="#333" strokeWidth={0.5} />

      {/* Green fill — Sangha pays (below strike, above zero) */}
      <polygon
        points={`${leftX},${leftY} ${strikeX},${zeroY} ${leftX},${zeroY}`}
        fill="#00d26a"
        opacity={0.15}
      />

      {/* Red fill — miner shares upside (above strike, below zero) */}
      <polygon
        points={`${strikeX},${zeroY} ${rightX},${rightY} ${rightX},${zeroY}`}
        fill="#ff3b30"
        opacity={0.08}
      />

      {/* Payoff line */}
      <polyline
        points={`${leftX},${leftY} ${strikeX},${zeroY} ${rightX},${rightY}`}
        fill="none"
        stroke="#00d4ff"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Strike price vertical line */}
      <line x1={strikeX} y1={padT} x2={strikeX} y2={h - padB} stroke="#00d4ff" strokeWidth={1} strokeDasharray="3,3" opacity={0.6} />
      <text x={strikeX} y={h - 8} textAnchor="middle" fill="#00d4ff" style={{ fontSize: '8px' }}>
        Strike
      </text>

      {/* Labels */}
      <text x={padL + 6} y={zeroY - 10} fill="#00d26a" style={{ fontSize: '7px' }}>
        Sangha pays
      </text>
      <text x={rightX - 6} y={zeroY + 14} textAnchor="end" fill="#ff3b30" style={{ fontSize: '7px' }} opacity={0.7}>
        Upside share
      </text>

      {/* Axes labels */}
      <text x={padL + plotW / 2} y={h - 2} textAnchor="middle" fill="#666" style={{ fontSize: '7px' }}>
        Market Hashprice →
      </text>
      <text x={4} y={padT + plotH / 2} fill="#666" style={{ fontSize: '7px' }} transform={`rotate(-90, 8, ${padT + plotH / 2})`} textAnchor="middle">
        Net Payment
      </text>

      {/* Zero label */}
      <text x={padL - 4} y={zeroY + 3} textAnchor="end" fill="#666" style={{ fontSize: '7px' }}>
        $0
      </text>
    </svg>
  );
}
