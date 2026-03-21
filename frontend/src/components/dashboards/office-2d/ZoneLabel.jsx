import React from 'react';

export function ZoneLabel({ zone }) {
  return (
    <text
      x={zone.x + 14}
      y={zone.y + 22}
      fill="#94a3b8"
      fontSize={11}
      fontWeight={600}
      fontFamily="system-ui, sans-serif"
      letterSpacing="0.05em"
    >
      {zone.label}
    </text>
  );
}
