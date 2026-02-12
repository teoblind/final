import { format, formatDistanceToNow, parseISO } from 'date-fns';

// Number formatters
export function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

export function formatCurrency(num, currency = 'USD', decimals = 2) {
  if (num === null || num === undefined) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num);
}

export function formatCompact(num) {
  if (num === null || num === undefined) return '-';
  const formatter = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1
  });
  return formatter.format(num);
}

export function formatPercent(num, decimals = 2) {
  if (num === null || num === undefined) return '-';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(decimals)}%`;
}

export function formatBTC(num, decimals = 4) {
  if (num === null || num === undefined) return '-';
  return `${num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })} BTC`;
}

// Date formatters
export function formatDate(dateStr, formatStr = 'MMM d, yyyy') {
  if (!dateStr) return '-';
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
    return format(date, formatStr);
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr) {
  return formatDate(dateStr, 'MMM d, yyyy HH:mm');
}

export function formatTimeAgo(dateStr) {
  if (!dateStr) return '-';
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return dateStr;
  }
}

export function formatShortDate(dateStr) {
  return formatDate(dateStr, 'MM/dd');
}

// Trend indicators
export function getTrendColor(value, neutral = 0) {
  if (value === null || value === undefined) return 'text-terminal-muted';
  if (value > neutral) return 'text-terminal-green';
  if (value < neutral) return 'text-terminal-red';
  return 'text-terminal-amber';
}

export function getTrendArrow(value) {
  if (value === null || value === undefined) return '';
  if (value > 0) return '↑';
  if (value < 0) return '↓';
  return '→';
}

// PMI color coding
export function getPMIColor(value) {
  if (value === null || value === undefined) return 'bg-terminal-muted/20';
  if (value > 52) return 'bg-terminal-green/20 text-terminal-green';
  if (value >= 48) return 'bg-terminal-amber/20 text-terminal-amber';
  return 'bg-terminal-red/20 text-terminal-red';
}

// Correlation strength
export function getCorrelationColor(value) {
  if (value === null || value === undefined) return 'bg-terminal-muted/20';
  const absVal = Math.abs(value);
  if (absVal > 0.7) return value > 0 ? 'bg-terminal-green/30' : 'bg-terminal-red/30';
  if (absVal > 0.3) return value > 0 ? 'bg-terminal-green/15' : 'bg-terminal-red/15';
  return 'bg-terminal-muted/10';
}

// Chart data helpers
export function prepareChartData(data, xKey = 'date', yKey = 'value') {
  if (!Array.isArray(data)) return [];
  return data.map(item => ({
    x: item[xKey],
    y: typeof item[yKey] === 'number' ? item[yKey] : parseFloat(item[yKey])
  })).filter(item => !isNaN(item.y));
}

// Export helpers
export function exportToCSV(data, filename) {
  if (!data || !data.length) return;

  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(header => row[header]));
  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
