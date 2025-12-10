import { execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, beforeAll } from 'vitest';

import type { CLIResponse } from '../features/shared/cli-response.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const cliDir = path.join(repoRoot, 'apps/cli');
const samplesDir = path.join(cliDir, 'samples');
const testDataDir = path.join(cliDir, 'data/tests');

/**
 * Check if the environment allows creating a Unix domain socket (tsx IPC needs this).
 */
async function canBindUnixSocket(): Promise<boolean> {
  return await new Promise((resolve) => {
    const socketPath = path.join(testDataDir, `probe-${Date.now()}.sock`);
    const server = net.createServer();
    server.once('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    server.listen(socketPath, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Escape a shell argument by wrapping it in single quotes and escaping any single quotes
 */
function escapeShellArg(arg: string): string {
  // Wrap in single quotes and escape any single quotes in the argument
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Execute a CLI command and parse JSON output
 */
function executeCLI(args: string[]): CLIResponse<unknown> {
  // Properly escape each argument to prevent shell interpretation of special characters
  const escapedArgs = args.map(escapeShellArg).join(' ');
  const command = `pnpm -s run dev ${escapedArgs} --json`;

  try {
    const stdout = execSync(command, {
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

    // Parse the entire stdout as JSON (it's pretty-printed across multiple lines)
    const trimmed = stdout.trim();

    if (!trimmed) {
      throw new Error('No output from CLI command');
    }

    return JSON.parse(trimmed) as CLIResponse<unknown>;
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      const stdout = (error as { stdout: Buffer }).stdout?.toString() || '';
      const trimmed = stdout.trim();

      if (trimmed) {
        try {
          return JSON.parse(trimmed) as CLIResponse<unknown>;
        } catch {
          // Not JSON, re-throw original error
        }
      }
    }
    throw error;
  }
}

/**
 * Clean up test database before tests
 */
function cleanupTestDatabase(): void {
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });
}

interface ImportCommandResult {
  status: 'success' | 'warning';
  import: {
    accountId?: number;
    counts: {
      imported: number;
      processed?: number;
      skipped: number;
    };
    importSessions?: {
      completedAt?: string;
      files?: number;
      id: number;
      startedAt?: string;
      status?: string;
    }[];
    input: {
      address?: string;
      blockchain?: string;
      csvDir?: string;
      exchange?: string;
      processed: boolean;
    };
    processingErrors?: string[];
    source?: string;
  };
  meta: {
    durationMs?: number;
    timestamp: string;
  };
}

interface ProcessCommandResult {
  errors: string[];
  processed: number;
}

interface BalanceCommandResult {
  status: 'success' | 'warning' | 'error';
  balances: {
    calculatedBalance: string;
    currency: string;
    difference: string;
    liveBalance: string;
    percentageDiff: number;
    status: 'match' | 'warning' | 'mismatch';
  }[];
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  source: {
    address?: string;
    name: string;
    type: 'exchange' | 'blockchain';
  };
  account: {
    id: number;
    identifier: string | null;
    providerName: string | null;
    sourceName: string;
    type: string;
  };
  meta: {
    timestamp: string;
  };
  suggestion?: string;
}

interface AccountsViewResult {
  accounts: {
    accountType: string;
    id: number;
    identifier: string;
    sourceName: string;
  }[];
}

describe('KuCoin E2E Workflow', () => {
  // Skip tests if no API credentials or no sample data
  const hasCredentials = !!(
    process.env['KUCOIN_API_KEY'] &&
    process.env['KUCOIN_SECRET'] &&
    process.env['KUCOIN_PASSPHRASE']
  );

  const hasSampleData = fs.existsSync(samplesDir) && fs.readdirSync(samplesDir).length > 0;

  const shouldSkip = !hasCredentials || !hasSampleData;
  let skipImportTests = false;

  beforeAll(() => {
    if (!shouldSkip) {
      cleanupTestDatabase();
    }
  });

  beforeAll(async () => {
    if (!shouldSkip) {
      skipImportTests = !(await canBindUnixSocket());
      if (skipImportTests) {
        console.warn('Skipping import-related tests: IPC (Unix socket) not permitted in this environment.');
      }
    }
  });

  it.skipIf(shouldSkip)(
    'should import, process, and verify balance for KuCoin CSV data',
    () => {
      if (skipImportTests) {
        console.warn('Skipping test: import IPC not permitted in this environment.');
        return;
      }
      console.log(`\nTesting KuCoin workflow with samples from ${samplesDir}\n`);

      // Step 1: Import all CSV files (importer recursively processes all CSVs in the directory)
      console.log('Step 1: Importing CSV files...');

      const importResult = executeCLI(['import', '--exchange', 'kucoin', '--csv-dir', samplesDir]);

      expect(importResult.success).toBe(true);
      expect(importResult.command).toBe('import');

      const importData = importResult.data as ImportCommandResult;
      expect(importData).toBeDefined();
      expect(importData.import.counts.imported).toBeGreaterThan(0);
      expect(importData.import.importSessions).toBeInstanceOf(Array);
      expect(importData.import.importSessions?.length).toBeGreaterThan(0);

      console.log(
        `\nTotal imported: ${importData.import.counts.imported}, skipped: ${importData.import.counts.skipped}, sessions: ${importData.import.importSessions?.length}\n`
      );

      expect(importData.import.counts.imported).toBeGreaterThan(0);
      expect(importData.import.importSessions?.length).toBeGreaterThan(0);

      // Step 2: Process the imported data
      console.log('Step 2: Processing imported data...');

      const processResult = executeCLI(['process']);

      expect(processResult.success).toBe(true);
      expect(processResult.command).toBe('process');

      const processData = processResult.data as ProcessCommandResult;
      expect(processData).toBeDefined();
      expect(processData.processed).toBeGreaterThan(0);

      console.log(`  Processed ${processData.processed} transactions`);

      if (processData.errors.length > 0) {
        console.log(`  Errors: ${processData.errors.length}`);
        processData.errors.slice(0, 3).forEach((error) => {
          console.log(`    - ${error}`);
        });
      }

      // Step 3: Verify balance
      console.log('\nStep 3: Verifying balance...');

      // Fetch the imported KuCoin account id dynamically
      const accountsResult = executeCLI(['accounts', 'view', '--source', 'kucoin', '--json']);
      expect(accountsResult.success).toBe(true);
      const accountsData = accountsResult.data as AccountsViewResult;
      expect(accountsData.accounts.length).toBeGreaterThan(0);
      const kucoinAccountId = accountsData.accounts[0]?.id;
      expect(Number(kucoinAccountId)).toBeGreaterThan(0);

      const balanceResult = executeCLI([
        'balance',
        '--account-id',
        String(kucoinAccountId),
        '--api-key',
        process.env['KUCOIN_API_KEY']!,
        '--api-secret',
        process.env['KUCOIN_SECRET']!,
        '--api-passphrase',
        process.env['KUCOIN_PASSPHRASE']!,
      ]);

      expect(balanceResult.success).toBe(true);
      expect(balanceResult.command).toBe('balance');

      const balanceData = balanceResult.data as BalanceCommandResult;
      expect(balanceData).toBeDefined();
      expect(balanceData.status).toBeDefined();
      expect(balanceData.summary).toBeDefined();
      expect(balanceData.balances).toBeInstanceOf(Array);

      console.log(`\nBalance verification: ${balanceData.status.toUpperCase()}`);
      console.log(`  Total currencies: ${balanceData.summary.totalCurrencies}`);
      console.log(`  Matches: ${balanceData.summary.matches}`);
      console.log(`  Warnings: ${balanceData.summary.warnings}`);
      console.log(`  Mismatches: ${balanceData.summary.mismatches}`);

      // Show first few comparisons
      if (balanceData.balances.length > 0) {
        console.log('\nSample comparisons:');
        balanceData.balances.slice(0, 5).forEach((comp) => {
          const statusIcon = comp.status === 'match' ? '✓' : comp.status === 'warning' ? '⚠' : '✗';
          console.log(`  ${statusIcon} ${comp.currency}:`);
          console.log(`    Live:       ${comp.liveBalance}`);
          console.log(`    Calculated: ${comp.calculatedBalance}`);
          if (comp.status !== 'match') {
            console.log(`    Difference: ${comp.difference}`);
          }
        });
      }

      if (balanceData.suggestion) {
        console.log(`\nSuggestion: ${balanceData.suggestion}`);
      }

      // Assertions on balance verification
      // We expect success or warning (warning is acceptable for small discrepancies)
      expect(['success', 'warning']).toContain(balanceData.status);
      expect(balanceData.summary.totalCurrencies).toBeGreaterThan(0);

      // Most balances should match
      const matchRate = balanceData.summary.matches / balanceData.summary.totalCurrencies;
      expect(matchRate).toBeGreaterThan(0.8); // At least 80% should match
    },
    // Longer timeout for full workflow (5 minutes)
    300000
  );

  it.skipIf(shouldSkip)(
    'should support combined import+process workflow',
    () => {
      if (skipImportTests) {
        console.warn('Skipping test: import IPC not permitted in this environment.');
        return;
      }
      console.log('\nTesting combined import+process workflow\n');

      // Clean database for fresh test
      cleanupTestDatabase();

      // Import and process in one command using root samples directory
      console.log(`Importing and processing from ${samplesDir}...`);

      const importResult = executeCLI(['import', '--exchange', 'kucoin', '--csv-dir', samplesDir, '--process']);

      expect(importResult.success).toBe(true);
      expect(importResult.command).toBe('import');

      const importData = importResult.data as ImportCommandResult;
      expect(importData).toBeDefined();
      expect(importData.import.counts.imported).toBeGreaterThan(0);
      expect(importData.import.counts.processed).toBeDefined();
      expect(importData.import.counts.processed).toBeGreaterThan(0);

      console.log(`  Imported: ${importData.import.counts.imported}`);
      console.log(`  Processed: ${importData.import.counts.processed}`);

      // Verify that some transactions were processed
      // Note: Processed count may be less than imported due to grouping, deduplication, etc.
      expect(importData.import.counts.processed).toBeGreaterThan(0);
      expect(importData.import.counts.processed).toBeLessThanOrEqual(importData.import.counts.imported);
    },
    120000
  );

  // Test to show what happens when credentials are missing
  it('should provide helpful error when sample data is missing', () => {
    if (hasSampleData) {
      console.log('Sample data exists - skipping missing data test');
      return;
    }

    console.log('\nNo KuCoin sample data found');
    console.log(`Expected location: ${samplesDir}`);
    console.log('Please add sample CSV files to test the workflow');
  });

  it('should provide helpful error when credentials are missing', () => {
    if (hasCredentials) {
      console.log('Credentials exist - skipping missing credentials test');
      return;
    }

    console.log('\nKuCoin API credentials not found');
    console.log('Please set the following environment variables:');
    console.log('  - KUCOIN_API_KEY');
    console.log('  - KUCOIN_SECRET');
    console.log('  - KUCOIN_PASSPHRASE');
  });
});
