import React, { useState, useEffect } from 'react';

/**
 * Quarq Spread mini visualization - horizontal bars showing
 * Revenue (green) vs Energy Cost (red) with the spread gap
 * and a dashed floor guarantee line.
 */
export default function QuarqSpreadViz() {
  const [pulse, setPulse] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setPulse(p => p === 1 ? 0.92 : 1);
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const w = 200;
  const h = 120;
  const barH = 22;
  const revenue = 140;
  const cost = 75;
  const floor = 45;
  const maxVal = 180;

  const scale = (v) => (v / maxVal) * (w - 40);
  const revenueW = scale(revenue) * pulse;
  const costW = scale(cost);
  const floorX = 20 + scale(floor);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[200px]">
      {/* Revenue bar */}
      <rect x={20} y={20} width={revenueW} height={barH} rx={3} fill="#00d26a" opacity={0.8}>
        <animate attributeName="opacity" values="0.8;0.65;0.8" dur="3s" repeatCount="indefinite" />
      </rect>
      <text x={24} y={34} fill="#0a0a0a" style={{ fontSize: '9px', fontWeight: 600 }}>Revenue</text>

      {/* Energy cost bar */}
      <rect x={20} y={52} width={costW} height={barH} rx={3} fill="#ff3b30" opacity={0.7} />
      <text x={24} y={66} fill="#0a0a0a" style={{ fontSize: '9px', fontWeight: 600 }}>Energy Cost</text>

      {/* Spread annotation */}
      <line x1={20 + costW} y1={44} x2={20 + costW} y2={84} stroke="#666" strokeWidth={0.5} strokeDasharray="2,2" />
      <line x1={20 + revenueW * (1 / pulse)} y1={44} x2={20 + revenueW * (1 / pulse)} y2={84} stroke="#666" strokeWidth={0.5} strokeDasharray="2,2" />

      {/* Spread label */}
      <text x={(20 + costW + 20 + scale(revenue)) / 2} y={96} textAnchor="middle" fill="#00d26a" style={{ fontSize: '9px', fontWeight: 600 }}>
        Spread
      </text>
      <line
        x1={20 + costW + 4}
        y1={90}
        x2={20 + scale(revenue) - 4}
        y2={90}
        stroke="#00d26a"
        strokeWidth={1}
        markerStart="url(#arrowLeft)"
        markerEnd="url(#arrowRight)"
      />

      {/* Floor guarantee line */}
      <line x1={floorX} y1={14} x2={floorX} y2={80} stroke="#00d4ff" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.8} />
      <text x={floorX} y={110} textAnchor="middle" fill="#00d4ff" style={{ fontSize: '8px' }}>
        Floor
      </text>

      {/* Arrow markers */}
      <defs>
        <marker id="arrowLeft" markerWidth="4" markerHeight="4" refX="4" refY="2" orient="auto">
          <path d="M4,0 L0,2 L4,4" fill="#00d26a" />
        </marker>
        <marker id="arrowRight" markerWidth="4" markerHeight="4" refX="0" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4" fill="#00d26a" />
        </marker>
      </defs>
    </svg>
  );
}
