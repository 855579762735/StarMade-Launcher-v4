import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['electron/**/*.ts', 'utils/**/*.{ts,tsx}'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `original-fs` is an Electron-only module (un-patched Node fs).
      // In the test environment (plain Node) it doesn't exist, so alias
      // it to the standard `fs` module.
      'original-fs': 'fs',
    },
  },
});
