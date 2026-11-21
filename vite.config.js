import { defineConfig } from 'vite';

// Relative base so `dist/` works on GitHub Pages project sites and local file opens via preview.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    include: ['src/**/*.test.js', 'tests/**/*.test.js'],
    environment: 'node',
  },
});
