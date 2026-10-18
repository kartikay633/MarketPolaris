// ROADMAP: Section 22 — Phase 0 (Vite Configuration)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Proxy API requests to Express backend (API_PROXY_TARGET overrides, e.g. a second API on another port)
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@app': path.resolve(__dirname, './src/app'),
      '@intro': path.resolve(__dirname, './src/intro'),
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['lightweight-charts'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-three': ['three'],
        },
      },
    },
  },
});
