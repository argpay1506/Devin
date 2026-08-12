import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/, not the domain root.
  base: process.env.BASE_PATH ?? '/',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
