import path from 'node:path';

import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(import.meta.dirname);
process.env.EXITBOOK_DATA_DIR = path.join(repoRoot, 'apps/cli/data/tests');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60000,
  },
});
