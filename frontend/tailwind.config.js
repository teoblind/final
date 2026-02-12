/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Bloomberg terminal-inspired colors
        terminal: {
          bg: '#0a0a0a',
          panel: '#111111',
          border: '#1e1e1e',
          text: '#e5e5e5',
          muted: '#666666',
          green: '#00d26a',
          red: '#ff3b30',
          amber: '#ffb800',
          blue: '#007aff',
          cyan: '#00d4ff',
          purple: '#af52de'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', 'monospace'],
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
