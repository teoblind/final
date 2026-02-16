/**
 * Sangha Ampera Theme Configuration
 *
 * Centralizes all design tokens for visual consistency across all phases.
 * Based on the Bloomberg terminal-inspired dark aesthetic from the original dashboard.
 */

export const theme = {
  colors: {
    bg: '#0a0a0a',
    panel: '#111111',
    border: '#1e1e1e',
    borderHover: '#333333',
    text: '#e5e5e5',
    muted: '#666666',
    green: '#00d26a',
    red: '#ff3b30',
    amber: '#ffb800',
    blue: '#007aff',
    cyan: '#00d4ff',
    purple: '#af52de',
  },

  fonts: {
    mono: "'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace",
  },

  fontSizes: {
    xs: '0.75rem',     // 12px — labels, attribution, timestamps
    sm: '0.875rem',    // 14px — body text, nav items
    base: '1rem',      // 16px — default
    lg: '1.125rem',    // 18px — panel titles, header
    xl: '1.25rem',     // 20px — secondary metrics
    '2xl': '1.5rem',   // 24px — important values
    '3xl': '1.875rem', // 30px — big metric numbers
    '4xl': '2.25rem',  // 36px — hero metrics
  },

  spacing: {
    panelPadding: '1rem',
    panelGap: '1rem',
    headerHeight: '3.5rem',
    footerHeight: '2rem',
  },

  borderRadius: {
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.75rem',
  },

  shadows: {
    glow: {
      green: '0 0 10px rgba(0, 210, 106, 0.3)',
      red: '0 0 10px rgba(255, 59, 48, 0.3)',
      amber: '0 0 10px rgba(255, 184, 0, 0.3)',
    },
  },

  chart: {
    colors: {
      primary: '#00d26a',
      secondary: '#ffb800',
      tertiary: '#007aff',
      quaternary: '#af52de',
      negative: '#ff3b30',
    },
    tooltip: {
      backgroundColor: '#111111',
      border: '1px solid #333333',
      borderRadius: '4px',
    },
    grid: {
      stroke: '#1e1e1e',
    },
    axis: {
      stroke: '#666666',
      fontSize: 10,
    },
  },
} as const;

export type Theme = typeof theme;
export default theme;
