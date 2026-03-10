/**
 * DACP Mobile Design System
 * Light editorial theme — warm whites, serif accents, Swiss precision
 */

export const colors = {
  // Base
  bg: '#fafaf8',
  surface: '#ffffff',
  surfaceInset: '#f5f4f0',
  border: '#e8e6e1',
  borderLight: '#f0eeea',

  // Text
  text: '#111110',
  textSecondary: '#333330',
  textMuted: '#6b6b65',
  textTertiary: '#9a9a92',
  textFaint: '#c5c5bc',

  // Brand
  accent: '#1e3a5f',
  accentLight: '#2a5080',
  accentBg: '#eef3f9',
  accentDot: '#3b82f6',

  // Semantic
  green: '#1a6b3c',
  greenBg: '#edf7f0',
  greenDot: '#2dd478',
  warm: '#b8860b',
  warmBg: '#fdf6e8',
  danger: '#c0392b',
  dangerBg: '#fbeae8',
  purple: '#7c3aed',
  purpleBg: '#f3f0ff',

  // Status
  success: '#1a6b3c',
  warning: '#b8860b',
  info: '#1e3a5f',

  // Agent colors
  agents: {
    hivemind: { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', label: 'DACP Agent' },
    estimating: { color: '#1e3a5f', bg: '#eef3f9', label: 'Estimating' },
    documents: { color: '#7c3aed', bg: '#f3f0ff', label: 'Documents' },
    meetings: { color: '#1a6b3c', bg: '#edf7f0', label: 'Meetings' },
    email: { color: '#b8860b', bg: '#fdf6e8', label: 'Email' },
  },
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32, '4xl': 40,
};

export const radius = {
  sm: 5, md: 9, lg: 14, xl: 20, full: 9999,
};

export const fontSize = {
  xs: 10, sm: 12, base: 14, lg: 17, xl: 20, '2xl': 24, '3xl': 28, '4xl': 36,
};

export const shadows = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  lg: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
};
