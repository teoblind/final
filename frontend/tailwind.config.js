/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: 'var(--t-bg)',
          panel: 'var(--t-panel)',
          border: 'var(--t-border)',
          text: 'var(--t-text)',
          muted: 'var(--t-muted)',
          green: 'var(--t-accent)',
          red: 'var(--t-red)',
          amber: 'var(--t-amber)',
          blue: 'var(--t-blue)',
          cyan: 'var(--t-cyan)',
          purple: 'var(--t-purple)',
        }
      },
      borderRadius: {
        'lg': '1rem',
        'xl': '1.25rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Bebas Neue', 'sans-serif'],
        heading: ['Syne', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flash': 'flash 0.5s ease-in-out'
      },
      keyframes: {
        flash: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 }
        }
      }
    },
  },
  plugins: [],
}
