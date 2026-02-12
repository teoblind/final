import React from 'react';
import { formatTimeAgo } from '../../lib/utils/formatters';

interface DataSourceProps {
  name: string;
  updatedAt?: Date | string | null;
  className?: string;
}

export default function DataSource({ name, updatedAt, className = '' }: DataSourceProps) {
  return (
    <div className={`text-xs text-terminal-muted flex justify-between ${className}`}>
      <span>Source: {name}</span>
      {updatedAt && <span>Updated: {formatTimeAgo(updatedAt)}</span>}
    </div>
  );
}
