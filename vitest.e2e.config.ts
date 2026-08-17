import { defineConfig } from 'vitest/config';

export default defineConfig({
  assetsInclude: ['**/*.md'],
  plugins: [
    {
      name: 'raw-md',
      transform(code, id) {
        if (id.endsWith('.md')) {
          return {
            code: `export default ${JSON.stringify(code)};`,
            map: null,
          };
        }
      },
    },
  ],
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/e2e/**/*.spec.ts'],
    exclude: [], // Include everything since we're in E2E config
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
