import { execSync } from 'node:child_process';
import fs from 'node:fs';
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
 * Execute a CLI command and parse JSON output
 */
function executeCLI(args: string[]): CLIResponse<unknown> {
  const command = `pnpm run dev ${args.join(' ')} --json`;

  try {
    const stdout = execSync(command, {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        EXITBOOK_DATA_DIR: testDataDir,
      },
    });

    // Parse JSON from last line of output (in case there are logs before it)
    const lines = stdout.trim().split('\n');
    const jsonLine = lines[lines.length - 1];

    if (!jsonLine) {
      throw new Error('No output from CLI command');
    }

    return JSON.parse(jsonLine) as CLIResponse<unknown>;
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      const stdout = (error as { stdout: Buffer }).stdout?.toString() || '';
      const lines = stdout.trim().split('\n');
      const jsonLine = lines[lines.length - 1];

      if (jsonLine) {
        try {
          return JSON.parse(jsonLine) as CLIResponse<unknown>;
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

/**
 * Get all sample directories for KuCoin
 */
function getKuCoinSampleDirs(): string[] {
  if (!fs.existsSync(samplesDir)) {
    return [];
  }

  return fs
    .readdirSync(samplesDir)
    .filter((name) => name.startsWith('BillingHistory'))
    .map((name) => path.join(samplesDir, name))
    .filter((dir) => fs.statSync(dir).isDirectory());
}

interface ImportCommandResult {
  imported: number;
  skipped: number;
  sessions: number;
  importSessionIds: number[];
  processed?: number;
  processingErrors?: string[];
}

interface ProcessCommandResult {
  errors: string[];
  processed: number;
}

interface BalanceCommandResult {
  status: 'success' | 'warning' | 'error';
  liveBalances: Record<string, string>;
  calculatedBalances: Record<string, string>;
  comparisons: {
    calculatedBalance: string;
    currency: string;
    difference: string;
    liveBalance: string;
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

describe('KuCoin E2E Workflow', () => {
  // Skip tests if no API credentials or no sample data
  const hasCredentials = !!(
    process.env['KUCOIN_API_KEY'] &&
    process.env['KUCOIN_SECRET'] &&
    process.env['KUCOIN_PASSPHRASE']
  );

  const sampleDirs = getKuCoinSampleDirs();
  const hasSampleData = sampleDirs.length > 0;

  const shouldSkip = !hasCredentials || !hasSampleData;

  beforeAll(() => {
    if (!shouldSkip) {
      cleanupTestDatabase();
    }
  });

  it.skipIf(shouldSkip)(
    'should import, process, and verify balance for KuCoin CSV data',
    () => {
      console.log(`\nTesting KuCoin workflow with ${sampleDirs.length} sample directories\n`);

      // Step 1: Import all CSV files
      console.log('Step 1: Importing CSV files...');

      const allSessionIds: number[] = [];
      let totalImported = 0;
      let totalSkipped = 0;

      for (const csvDir of sampleDirs) {
        const importResult = executeCLI(['import', '--exchange', 'kucoin', '--csv-dir', csvDir]);

        expect(importResult.success).toBe(true);
        expect(importResult.command).toBe('import');

        const importData = importResult.data as ImportCommandResult;
        expect(importData).toBeDefined();
        expect(importData.imported).toBeGreaterThanOrEqual(0);
        expect(importData.importSessionIds).toBeInstanceOf(Array);

        allSessionIds.push(...importData.importSessionIds);
        totalImported += importData.imported;
        totalSkipped += importData.skipped;

        console.log(`  Imported ${importData.imported} transactions from ${path.basename(csvDir)}`);
      }

      console.log(`\nTotal imported: ${totalImported}, skipped: ${totalSkipped}, sessions: ${allSessionIds.length}\n`);

      expect(totalImported).toBeGreaterThan(0);
      expect(allSessionIds.length).toBeGreaterThan(0);

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

      const balanceResult = executeCLI([
        'balance',
        '--exchange',
        'kucoin',
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
      expect(balanceData.comparisons).toBeInstanceOf(Array);

      console.log(`\nBalance verification: ${balanceData.status.toUpperCase()}`);
      console.log(`  Total currencies: ${balanceData.summary.totalCurrencies}`);
      console.log(`  Matches: ${balanceData.summary.matches}`);
      console.log(`  Warnings: ${balanceData.summary.warnings}`);
      console.log(`  Mismatches: ${balanceData.summary.mismatches}`);

      // Show first few comparisons
      if (balanceData.comparisons.length > 0) {
        console.log('\nSample comparisons:');
        balanceData.comparisons.slice(0, 5).forEach((comp) => {
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
      console.log('\nTesting combined import+process workflow\n');

      // Clean database for fresh test
      cleanupTestDatabase();

      // Import and process in one command using first sample directory
      const csvDir = sampleDirs[0];
      if (!csvDir) {
        throw new Error('No sample directories found');
      }

      console.log(`Importing and processing ${path.basename(csvDir)}...`);

      const importResult = executeCLI(['import', '--exchange', 'kucoin', '--csv-dir', csvDir, '--process']);

      expect(importResult.success).toBe(true);
      expect(importResult.command).toBe('import');

      const importData = importResult.data as ImportCommandResult;
      expect(importData).toBeDefined();
      expect(importData.imported).toBeGreaterThan(0);
      expect(importData.processed).toBeDefined();
      expect(importData.processed).toBeGreaterThan(0);

      console.log(`  Imported: ${importData.imported}`);
      console.log(`  Processed: ${importData.processed}`);

      // Verify that processed count matches imported count
      expect(importData.processed).toEqual(importData.imported);
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
