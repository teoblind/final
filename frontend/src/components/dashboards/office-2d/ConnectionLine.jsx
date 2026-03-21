import React from 'react';

export function ConnectionLine({ x1, y1, x2, y2, strength }) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return null;

  const offset = Math.min(dist * 0.2, 50);
  const cx = midX - (dy / dist) * offset;
  const cy = midY + (dx / dist) * offset;
  const pathData = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

  const isStrong = strength >= 0.5;
  const lineWidth = isStrong ? 3 : 1.5;
  const lineOpacity = Math.max(0.2, strength);

  return (
    <g>
      <path d={pathData} fill="none" stroke="#60a5fa" strokeWidth={lineWidth + 2} opacity={Math.max(0.03, strength * 0.15)} style={{ filter: 'blur(3px)' }} />
      <path
        d={pathData}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={lineWidth}
        strokeDasharray={isStrong ? '12,6' : '6,4'}
        opacity={lineOpacity}
        style={{
          animation: isStrong ? 'connection-pulse 0.8s linear infinite' : 'dash-flow 1.5s linear infinite',
          filter: isStrong ? 'drop-shadow(0 0 4px rgba(96,165,250,0.8))' : undefined,
        }}
      />
    </g>
  );
}
