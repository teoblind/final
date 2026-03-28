import React from 'react';

/**
 * Coppice logo mark - orbital rings with dynamic background color.
 * PNG used for favicon/PWA. This SVG component used in-app for color adaptation.
 *
 * @param {string} color - Background fill color (default: navy)
 * @param {number} size  - Outer container size in px (default 32)
 */
export default function CoppiceLogo({ color = '#1e3a5f', size = 32 }) {
  const uid = React.useId().replace(/:/g, '');

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className="shrink-0"
      role="img"
      aria-label="Coppice"
      style={{ borderRadius: size * 0.22, display: 'block', background: color }}
    >
      <defs>
        <linearGradient id={`${uid}o`} x1="0.1" y1="0.9" x2="0.9" y2="0.1">
          <stop offset="0%" stopColor="white" stopOpacity="0.18" />
          <stop offset="100%" stopColor="white" stopOpacity="0.32" />
        </linearGradient>
        <linearGradient id={`${uid}m`} x1="0.1" y1="0.9" x2="0.9" y2="0.1">
          <stop offset="0%" stopColor="white" stopOpacity="0.22" />
          <stop offset="100%" stopColor="white" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={`${uid}i`} x1="0.1" y1="0.9" x2="0.9" y2="0.1">
          <stop offset="0%" stopColor="white" stopOpacity="0.30" />
          <stop offset="100%" stopColor="white" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      <rect width="100" height="100" fill={color} />

      {/* Outer ring */}
      <circle cx="50" cy="50" r="29" fill="none" stroke={`url(#${uid}o)`} strokeWidth="3" />
      {/* Middle ring */}
      <circle cx="50" cy="50" r="20" fill="none" stroke={`url(#${uid}m)`} strokeWidth="4" />
      {/* Inner ring */}
      <circle cx="50" cy="50" r="11.5" fill="none" stroke={`url(#${uid}i)`} strokeWidth="3" />

      {/* Orbital dot - outer ring ~9 o'clock */}
      <circle cx="21.5" cy="45" r="2.2" fill="rgba(255,255,255,0.38)" />
      {/* Orbital dot - middle ring ~12 o'clock */}
      <circle cx="53" cy="30.5" r="2" fill="rgba(255,255,255,0.50)" />
      {/* Orbital dot - inner ring ~3 o'clock */}
      <circle cx="61" cy="51.5" r="1.8" fill="rgba(255,255,255,0.65)" />

      {/* Center dot */}
      <circle cx="50" cy="50" r="5" fill="white" />
    </svg>
  );
}
