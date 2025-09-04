import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@exitbook/core': './libs/core/src',
      '@exitbook/database': './libs/database/src',
      '@exitbook/import': './libs/import/src',
      '@exitbook/ledger': './libs/ledger/src',
      '@exitbook/providers': './libs/providers/src',
      '@exitbook/shared-logger': './libs/shared/logger/src',
      '@exitbook/shared-utils': './libs/shared/utils/src',
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