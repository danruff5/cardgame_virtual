import { defineConfig } from 'vite';

// Relative base so `dist/` works on GitHub Pages project sites and local file opens via preview.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
