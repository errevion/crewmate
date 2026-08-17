import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  loader: {
    '.md': 'text',
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Output .mjs extension for ES modules
  outExtension: () => ({ js: '.mjs' }),
});
