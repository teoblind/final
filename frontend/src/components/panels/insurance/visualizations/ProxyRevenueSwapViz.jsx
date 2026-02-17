import React from 'react';

/**
 * Proxy Revenue Swap — 2x2 scenario grid.
 * BTC Price (columns) x Difficulty (rows).
 * Top-left = no hedge needed, other 3 cells show coverage.
 */
export default function ProxyRevenueSwapViz() {
  const w = 200;
  const h = 120;
  const padL = 50;
  const padT = 20;
  const cellW = (w - padL - 8) / 2;
  const cellH = (h - padT - 8) / 2;

  const cells = [
    { row: 0, col: 0, label: 'No hedge\nneeded', color: '#00d26a', opacity: 0.2, textColor: '#00d26a' },
    { row: 0, col: 1, label: 'Price\ncovered', color: '#00d4ff', opacity: 0.15, textColor: '#00d4ff' },
    { row: 1, col: 0, label: 'Volume\ncovered', color: '#00d4ff', opacity: 0.15, textColor: '#00d4ff' },
    { row: 1, col: 1, label: 'Both\ncovered', color: '#ffb800', opacity: 0.2, textColor: '#ffb800' },
  ];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[200px]">
      {/* Column headers */}
      <text x={padL + cellW / 2 + 1} y={12} textAnchor="middle" fill="#888" style={{ fontSize: '7px' }}>
        BTC Up
      </text>
      <text x={padL + cellW + 4 + cellW / 2} y={12} textAnchor="middle" fill="#888" style={{ fontSize: '7px' }}>
        BTC Down
      </text>

      {/* Row headers */}
      <text x={padL - 6} y={padT + cellH / 2 + 2} textAnchor="end" fill="#888" style={{ fontSize: '7px' }}>
        Diff. Flat
      </text>
      <text x={padL - 6} y={padT + cellH + 4 + cellH / 2 + 2} textAnchor="end" fill="#888" style={{ fontSize: '7px' }}>
        Diff. Spike
      </text>

      {/* Cells */}
      {cells.map((cell, i) => {
        const x = padL + cell.col * (cellW + 4);
        const y = padT + cell.row * (cellH + 4);
        const lines = cell.label.split('\n');
        return (
          <g key={i}>
            <rect x={x} y={y} width={cellW} height={cellH} rx={4} fill={cell.color} opacity={cell.opacity} stroke={cell.color} strokeWidth={0.5} strokeOpacity={0.3} />
            {lines.map((line, li) => (
              <text
                key={li}
                x={x + cellW / 2}
                y={y + cellH / 2 + (li - (lines.length - 1) / 2) * 11}
                textAnchor="middle"
                dominantBaseline="central"
                fill={cell.textColor}
                style={{ fontSize: '8px', fontWeight: 600 }}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
