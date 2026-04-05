import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CliResponse } from '../../cli/response.js';

import type { AccountsBrowseCommandResult, AccountsBrowseItem } from './e2e-test-types.js';

/**
 * Paths for e2e testing
 */
function getTestPaths() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '../../../../..');
  const cliDir = path.join(repoRoot, 'apps/cli');
  const samplesDir = path.join(cliDir, 'samples');
  const testDataDir = path.join(cliDir, 'data/tests');

  return {
    __dirname,
    repoRoot,
    cliDir,
    samplesDir,
    testDataDir,
  };
}

/**
 * Check if the environment allows creating a Unix domain socket (tsx IPC needs this).
 */
export async function canBindUnixSocket(): Promise<boolean> {
  return await new Promise((resolve) => {
    const { testDataDir } = getTestPaths();
    const socketPath = path.join(testDataDir, `probe-${Date.now()}.sock`);
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(socketPath, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Execute a CLI command and parse JSON output
 */
export function executeCLI(args: string[]): CliResponse<unknown> {
  const { repoRoot, testDataDir } = getTestPaths();
  const pnpmArgs = ['-s', 'run', 'dev', ...args, '--json'];

  try {
    const stdout = execFileSync('pnpm', pnpmArgs, {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        EXITBOOK_DATA_DIR: testDataDir,
        // Force tmpdir into repo workspace to avoid sandbox IPC permission issues
        TMPDIR: testDataDir,
      },
    });

    const trimmed = stdout.trim();

    if (!trimmed) {
      throw new Error('No output from CLI command');
    }

    return JSON.parse(trimmed) as CliResponse<unknown>;
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      const stdout = (error as { stdout: Buffer }).stdout?.toString() ?? '';
      const trimmed = stdout.trim();

      if (trimmed) {
        try {
          return JSON.parse(trimmed) as CliResponse<unknown>;
        } catch {
          // Not JSON, re-throw original error
        }
      }
    }
    throw error;
  }
}

export function loadAccountsBrowseItems(params: {
  accountType?: string | undefined;
  platformKey: string;
}): AccountsBrowseItem[] {
  const args = ['accounts', '--platform', params.platformKey];
  if (params.accountType) {
    args.push('--type', params.accountType);
  }

  const response = executeCLI(args);
  if (!response.success) {
    throw new Error(`Failed to load accounts for ${params.platformKey}: ${response.error?.message ?? 'unknown error'}`);
  }

  const result = response.data as AccountsBrowseCommandResult | undefined;
  if (!result || !Array.isArray(result.data)) {
    throw new Error(`Accounts browse response for ${params.platformKey} was not list-shaped JSON`);
  }

  return result.data;
}

export function toAccountsRefreshSelector(account: Pick<AccountsBrowseItem, 'accountFingerprint' | 'name'>): string {
  return account.name ?? account.accountFingerprint.slice(0, 8);
}

/**
 * Clean up test database before tests
 */
export function cleanupTestDatabase(): void {
  const { testDataDir } = getTestPaths();
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });
}

/**
 * Check if sample data exists for a given source
 */
export function hasSampleData(platformKey: string): boolean {
  const sourceDir = getSampleDir(platformKey);
  return fs.existsSync(sourceDir) && fs.readdirSync(sourceDir).length > 0;
}

/**
 * Get sample directory for a source
 */
export function getSampleDir(platformKey: string): string {
  const { samplesDir } = getTestPaths();
  if (platformKey === 'kucoin') {
    const candidates = fs
      .readdirSync(samplesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('BillingHistory'))
      .map((entry) => entry.name)
      .sort();

    const latest = candidates.at(-1);
    if (latest) {
      return path.join(samplesDir, latest);
    }
  }
  return path.join(samplesDir, platformKey);
}
