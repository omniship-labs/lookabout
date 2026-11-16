import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative, so the build works at a domain root and under a GitHub Pages
  // sub-path alike (routes are in the hash).
  base: './',
  plugins: [react()],
  server: {
    // The hub sends no CORS headers: in development the page and the hub share an origin through this proxy.
    // LOOKABOUT_HUB=http://raspberrypi.local:8787 npm run dev
    proxy: { '/api': process.env.LOOKABOUT_HUB || 'http://localhost:8787' },
  },
  build: {
    target: ['es2021', 'safari15'],
    outDir: 'dist',
  },
});
