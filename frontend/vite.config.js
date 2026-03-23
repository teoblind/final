import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        // Keep changeOrigin false so the original Host header (e.g. dacp.localhost:5173)
        // is forwarded to the backend, allowing tenant resolver to pick up the subdomain
        changeOrigin: false,
      }
    }
  }
});
