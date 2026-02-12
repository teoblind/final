import React from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  size?: 'default' | 'large';
  className?: string;
}

export default function MetricCard({ label, value, change, changeLabel, size = 'default', className = '' }: MetricCardProps) {
  const changeColor =
    change !== undefined
      ? change > 0
        ? 'text-terminal-green'
        : change < 0
        ? 'text-terminal-red'
        : 'text-terminal-muted'
      : '';

  return (
    <div className={`${size === 'large' ? 'text-center' : ''} ${className}`}>
      <p className="text-terminal-muted text-xs uppercase tracking-wider">{label}</p>
      <p className={`font-bold ${size === 'large' ? 'text-3xl text-terminal-green' : 'text-xl'}`}>
        {value}
      </p>
      {change !== undefined && (
        <p className={`text-xs ${changeColor}`}>
          {change > 0 ? '+' : ''}
          {typeof change === 'number' ? change.toFixed(2) : change}
          {changeLabel ? ` ${changeLabel}` : ''}
        </p>
      )}
    </div>
  );
}
