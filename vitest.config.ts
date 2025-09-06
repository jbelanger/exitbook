import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@exitbook/core': new URL('./libs/core/src', import.meta.url).pathname,
      '@exitbook/database': new URL('./libs/database/src', import.meta.url).pathname,
      '@exitbook/import': new URL('./libs/import/src', import.meta.url).pathname,
      '@exitbook/ledger': new URL('./libs/ledger/src', import.meta.url).pathname,
      '@exitbook/providers': new URL('./libs/providers/src', import.meta.url).pathname,
      '@exitbook/shared-logger': new URL('./libs/shared/logger/src', import.meta.url).pathname,
      '@exitbook/shared-utils': new URL('./libs/shared/utils/src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // Support for NestJS testing
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: ['./vitest.setup.ts'],
  },
});
