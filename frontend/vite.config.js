import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    // Do not ship source maps to production (they expose full source).
    // Set to 'hidden' if you upload maps to an error tracker instead.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into their own long-cached chunks so an
        // app-code change doesn't force users to re-download React + charts.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'chart-vendor': ['chart.js', 'react-chartjs-2', 'recharts'],
        },
      },
    },
  },
});
