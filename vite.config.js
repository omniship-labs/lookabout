import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative, so the build works at a domain root and under a GitHub Pages
  // sub-path alike (routes are in the hash).
  base: './',
  plugins: [react()],
  build: {
    target: ['es2021', 'safari15'],
    outDir: 'dist',
  },
});
