import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findExitbookWorkspaceRoot, resolveDefaultDataDir, wrapDataDirCompatibilityError } from '../data-dir.js';

describe('data-dir runtime helpers', () => {
  it('finds the workspace root when running inside the Exitbook repo', () => {
    const workspaceRoot = '/workspace/exitbook';
    const existingPaths = new Set([
      path.join(workspaceRoot, 'pnpm-workspace.yaml'),
      path.join(workspaceRoot, 'apps/cli/package.json'),
    ]);

    const result = findExitbookWorkspaceRoot('/workspace/exitbook/packages/accounting', (candidatePath) =>
      existingPaths.has(candidatePath)
    );

    expect(result).toBe(workspaceRoot);
  });

  it('uses cwd/data as the default data dir', () => {
    const cwd = '/tmp/custom-run-dir';

    const result = resolveDefaultDataDir(cwd);

    expect(result).toBe(path.join(cwd, 'data'));
  });

  it('adds repo guidance for schema mismatch errors from the wrong default data dir', () => {
    const workspaceRoot = '/workspace/exitbook';
    const existingPaths = new Set([
      path.join(workspaceRoot, 'pnpm-workspace.yaml'),
      path.join(workspaceRoot, 'apps/cli/package.json'),
      path.join(workspaceRoot, 'apps/cli/data'),
    ]);

    const wrapped = wrapDataDirCompatibilityError(new Error('no such column: accounts.account_fingerprint'), {
      cwd: workspaceRoot,
      dataDir: path.join(workspaceRoot, 'data'),
      databasePath: path.join(workspaceRoot, 'data/transactions.db'),
      pathExists: (candidatePath) => existingPaths.has(candidatePath),
    });

    expect(wrapped.message).toContain('Selected data directory "/workspace/exitbook/data" is incompatible');
    expect(wrapped.message).toContain('EXITBOOK_DATA_DIR=/workspace/exitbook/apps/cli/data');
  });
});
