/**
 * Ampera Theme Configuration
 *
 * Minimal dark theme — white, black, dark grey.
 * Font: Exo 2.
 */

export const theme = {
  colors: {
    bg: '#0a0a0a',
    panel: '#111111',
    border: '#1e1e1e',
    borderHover: '#333333',
    text: '#e5e5e5',
    muted: '#777777',
    green: '#ffffff',
    red: '#ff3b30',
    amber: '#999999',
    blue: '#cccccc',
    cyan: '#bbbbbb',
    purple: '#999999',
  },

  fonts: {
    sans: "'Exo 2', system-ui, -apple-system, sans-serif",
  },

  fontSizes: {
    xs: '0.75rem',     // 12px
    sm: '0.875rem',    // 14px
    base: '1rem',      // 16px
    lg: '1.125rem',    // 18px
    xl: '1.25rem',     // 20px
    '2xl': '1.5rem',   // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem',  // 36px
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
      green: '0 0 10px rgba(255, 255, 255, 0.15)',
      red: '0 0 10px rgba(255, 59, 48, 0.3)',
      amber: '0 0 10px rgba(153, 153, 153, 0.2)',
    },
  },

  chart: {
    colors: {
      primary: '#ffffff',
      secondary: '#999999',
      tertiary: '#cccccc',
      quaternary: '#666666',
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
      stroke: '#777777',
      fontSize: 10,
    },
  },
} as const;

export type Theme = typeof theme;
export default theme;
