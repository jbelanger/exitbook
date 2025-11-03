import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Set data directory for E2E tests to ensure consistent database location
const repoRoot = path.resolve(import.meta.dirname);
process.env.EXITBOOK_DATA_DIR = path.join(repoRoot, 'apps/cli/data/tests');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.e2e.test.ts', '**/*e2e*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60000,
  },
});
