import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**', 'build/**', '**/node_modules/**'],
    globals: true,
  },
});
