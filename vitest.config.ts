import { defineConfig } from 'vitest/config';

export default defineConfig({
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
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/e2e/**'],
    testTimeout: 30000,
  },
});
