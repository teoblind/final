import React, { memo } from 'react';

export const Desk = memo(function Desk({ x, y }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-50} y={-6} width={100} height={60} rx={6} fill="#dfe5ed" stroke="#c8d0dc" strokeWidth={1} />
      <path d="M -50 54 L -50 60 Q -50 66 -44 66 L 44 66 Q 50 66 50 60 L 50 54" fill="#c8d0dc" opacity={0.6} />
      <rect x={-20} y={4} width={40} height={26} rx={3} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={0.8} />
      <rect x={-16} y={36} width={32} height={12} rx={2} fill="#cbd5e1" opacity={0.6} />
    </g>
  );
});

export const Chair = memo(function Chair({ x, y }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M -12 -14 Q 0 -20 12 -14" fill="none" stroke="#7c8ba0" strokeWidth={4} strokeLinecap="round" />
      <circle r={14} fill="#94a3b8" opacity={0.85} />
    </g>
  );
});

export const Sofa = memo(function Sofa({ x, y, rotation = 0 }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      <rect x={-55} y={-22} width={110} height={44} rx={10} fill="#8494a7" />
      <rect x={-48} y={-16} width={96} height={32} rx={6} fill="#a5b4c8" />
      <circle cx={-30} cy={0} r={8} fill="#c8d5e3" opacity={0.7} />
      <circle cx={30} cy={0} r={8} fill="#c8d5e3" opacity={0.7} />
      <rect x={-52} y={-25} width={104} height={8} rx={4} fill="#8494a7" opacity={0.7} />
    </g>
  );
});

export const MeetingTable = memo(function MeetingTable({ x, y, radius = 80 }) {
  const gradId = `mt-grad-${x}-${y}`;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <defs>
        <radialGradient id={gradId}>
          <stop offset="0%" stopColor="#dbe4ef" />
          <stop offset="100%" stopColor="#bfcbda" />
        </radialGradient>
      </defs>
      <circle r={radius} fill={`url(#${gradId})`} stroke="#94a3b8" strokeWidth={1.5} style={{ filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.10))' }} />
    </g>
  );
});

export const Plant = memo(function Plant({ x, y }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M -8 6 L -10 18 Q -10 22 -6 22 L 6 22 Q 10 22 10 18 L 8 6 Z" fill="#a07050" />
      <ellipse cx={0} cy={-2} rx={12} ry={10} fill="#4ade80" opacity={0.85} />
      <ellipse cx={-6} cy={-8} rx={8} ry={6} fill="#22c55e" opacity={0.7} />
      <ellipse cx={6} cy={-6} rx={7} ry={5} fill="#16a34a" opacity={0.6} />
    </g>
  );
});

export const CoffeeCup = memo(function CoffeeCup({ x, y }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <ellipse cx={0} cy={4} rx={9} ry={3} fill="#d1d5db" opacity={0.5} />
      <rect x={-5} y={-4} width={10} height={10} rx={2} fill="#f5f5f4" stroke="#d1d5db" strokeWidth={0.6} />
      <ellipse cx={0} cy={-2} rx={4} ry={1.5} fill="#92400e" opacity={0.7} />
      <path d="M 5 -1 Q 9 -1 9 3 Q 9 6 5 6" fill="none" stroke="#d1d5db" strokeWidth={1} />
      <path d="M -1 -7 Q 0 -10 1 -7" fill="none" stroke="#94a3b8" strokeWidth={0.5} opacity={0.4} />
    </g>
  );
});
