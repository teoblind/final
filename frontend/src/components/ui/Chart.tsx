import React from 'react';
import { ResponsiveContainer } from 'recharts';

interface ChartProps {
  height?: number | string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable chart wrapper providing consistent sizing and ResponsiveContainer.
 */
export default function Chart({ height = 200, children, className = '' }: ChartProps) {
  return (
    <div className={`chart-container ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Standard tooltip style matching the terminal theme.
 */
export const chartTooltipStyle = {
  backgroundColor: '#111',
  border: '1px solid #333',
  borderRadius: '4px',
};
