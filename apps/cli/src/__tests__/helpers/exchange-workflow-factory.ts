import { beforeAll, describe, expect, it } from 'vitest';

import type {
  AccountsRefreshCommandResult,
  AccountsRefreshVerificationBalance,
  ImportCommandResult,
  ReprocessCommandResult,
} from './e2e-test-types.js';
import {
  canBindUnixSocket,
  cleanupTestDatabase,
  executeCLI,
  getSampleDir,
  hasSampleData,
  loadAccountsBrowseItems,
  toAccountsRefreshSelector,
} from './e2e-test-utils.js';

interface ExchangeConfig {
  /**
   * Exchange name (e.g., 'kucoin', 'kraken')
   */
  name: string;

  /**
   * Display name for test descriptions
   */
  displayName: string;

  /**
   * Environment variables required for API access
   */
  requiredEnvVars: string[];

  /**
   * CLI arguments that persist provider credentials on the imported account
   * so `accounts refresh` can verify live balances without command-line overrides.
   */
  importCredentialArgs?: (envVars: Record<string, string>) => string[];

  /**
   * Minimum match rate for balance verification (0-1)
   * @default 0.8
   */
  minMatchRate?: number;

  /**
   * Timeout for full workflow test in milliseconds
   * @default 300000 (5 minutes)
   */
  workflowTimeout?: number;

  /**
   * Timeout for combined import+process test in milliseconds
   * @default 120000 (2 minutes)
   */
  combinedWorkflowTimeout?: number;
}

/**
 * Creates a test suite for an exchange workflow
 */
export function createExchangeWorkflowTests(config: ExchangeConfig): void {
  const {
    name,
    displayName,
    requiredEnvVars,
    importCredentialArgs,
    minMatchRate = 0.8,
    workflowTimeout = 300000,
    combinedWorkflowTimeout = 120000,
  } = config;

  describe(`${displayName} E2E Workflow`, () => {
    const liveTestsEnabled = process.env['LIVE_TESTS'] === '1';
    // Check credentials
    const credentials: Record<string, string> = {};
    const hasCredentials = requiredEnvVars.every((envVar) => {
      const value = process.env[envVar];
      if (value) {
        credentials[envVar] = value;
        return true;
      }
      return false;
    });

    const hasSamples = hasSampleData(name);
    const shouldSkip = !liveTestsEnabled || !hasCredentials || !hasSamples;
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
      `should import, process, and verify balance for ${displayName} CSV data`,
      () => {
        if (skipImportTests) {
          console.warn('Skipping test: import IPC not permitted in this environment.');
          return;
        }

        const sampleDir = getSampleDir(name);
        console.log(`\nTesting ${displayName} workflow with samples from ${sampleDir}\n`);

        // Step 1: Import CSV files
        console.log('Step 1: Importing CSV files...');

        const importArgs = ['import', '--exchange', name, '--csv-dir', sampleDir];
        if (importCredentialArgs) {
          importArgs.push(...importCredentialArgs(credentials));
        }

        const importResult = executeCLI(importArgs);

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

        // Step 2: Process the imported data
        console.log('Step 2: Processing imported data...');

        const processResult = executeCLI(['reprocess']);

        expect(processResult.success).toBe(true);
        expect(processResult.command).toBe('reprocess');

        const processData = processResult.data as ReprocessCommandResult;
        expect(processData).toBeDefined();
        expect(processData.reprocess.counts.processed).toBeGreaterThan(0);

        console.log(`  Processed ${processData.reprocess.counts.processed} transactions`);

        const errors = processData.reprocess.processingErrors ?? [];
        if (errors.length > 0) {
          console.log(`  Errors: ${errors.length}`);
          errors.slice(0, 3).forEach((error) => {
            console.log(`    - ${error}`);
          });
        }

        // Step 3: Verify balance
        console.log('\nStep 3: Verifying balance...');

        // Fetch the imported account id dynamically
        const accounts = loadAccountsBrowseItems({ platformKey: name });
        expect(accounts.length).toBeGreaterThan(0);
        const account = accounts[0];
        expect(account).toBeDefined();

        const refreshArgs = ['accounts', 'refresh', toAccountsRefreshSelector(account!)];
        const refreshResult = executeCLI(refreshArgs);

        expect(refreshResult.success).toBe(true);
        expect(refreshResult.command).toBe('accounts-refresh');

        const refreshData = refreshResult.data as AccountsRefreshCommandResult;
        expect(refreshData).toBeDefined();
        expect(refreshData.mode).toBe('verification');
        expect(refreshData.status).toBeDefined();
        expect(refreshData.summary).toBeDefined();
        expect(refreshData.balances).toBeInstanceOf(Array);
        const comparisons = refreshData.balances as AccountsRefreshVerificationBalance[];

        console.log(`\nBalance verification: ${refreshData.status.toUpperCase()}`);
        console.log(`  Total assets: ${refreshData.summary.totalCurrencies}`);
        console.log(`  Matches: ${refreshData.summary.matches}`);
        console.log(`  Warnings: ${refreshData.summary.warnings}`);
        console.log(`  Mismatches: ${refreshData.summary.mismatches}`);

        // Show sample comparisons
        if (comparisons.length > 0) {
          console.log('\nSample comparisons:');
          comparisons.slice(0, 5).forEach((comp) => {
            const statusIcon = comp.status === 'match' ? '✓' : comp.status === 'warning' ? '⚠' : '✗';
            console.log(`  ${statusIcon} ${comp.assetSymbol}:`);
            console.log(`    Live:       ${comp.liveBalance}`);
            console.log(`    Calculated: ${comp.calculatedBalance}`);
            if (comp.status !== 'match') {
              console.log(`    Difference: ${comp.difference}`);
            }
          });
        }

        if (refreshData.suggestion) {
          console.log(`\nSuggestion: ${refreshData.suggestion}`);
        }

        // Assertions on balance verification
        expect(['success', 'warning']).toContain(refreshData.status);
        expect(refreshData.summary.totalCurrencies).toBeGreaterThan(0);

        // Verify minimum match rate
        const matchRate = refreshData.summary.matches / refreshData.summary.totalCurrencies;
        expect(matchRate).toBeGreaterThan(minMatchRate);
      },
      workflowTimeout
    );

    it.skipIf(shouldSkip)(
      `should support combined import+process workflow for ${displayName}`,
      () => {
        if (skipImportTests) {
          console.warn('Skipping test: import IPC not permitted in this environment.');
          return;
        }

        console.log(`\nTesting combined import+process workflow for ${displayName}\n`);

        // Clean database for fresh test
        cleanupTestDatabase();

        const sampleDir = getSampleDir(name);
        console.log(`Importing and processing from ${sampleDir}...`);

        const importArgs = ['import', '--exchange', name, '--csv-dir', sampleDir];
        if (importCredentialArgs) {
          importArgs.push(...importCredentialArgs(credentials));
        }

        const importResult = executeCLI(importArgs);

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
        expect(importData.import.counts.processed).toBeGreaterThan(0);
        expect(importData.import.counts.processed).toBeLessThanOrEqual(importData.import.counts.imported);
      },
      combinedWorkflowTimeout
    );

    // Helpful error messages when prerequisites are missing
    it('should provide helpful error when sample data is missing', () => {
      if (hasSamples) {
        console.log(`${displayName} sample data exists - skipping missing data test`);
        return;
      }

      const sampleDir = getSampleDir(name);
      console.log(`\nNo ${displayName} sample data found`);
      console.log(`Expected location: ${sampleDir}`);
      console.log('Please add sample CSV files to test the workflow');
    });

    it('should provide helpful error when credentials are missing', () => {
      if (hasCredentials) {
        console.log(`${displayName} credentials exist - skipping missing credentials test`);
        return;
      }

      console.log(`\n${displayName} API credentials not found`);
      console.log('Please set the following environment variables:');
      requiredEnvVars.forEach((envVar) => {
        console.log(`  - ${envVar}`);
      });
    });

    it('should provide helpful message when LIVE_TESTS is not enabled', () => {
      if (liveTestsEnabled) {
        return;
      }
      console.log('\nLive exchange workflow tests are disabled.');
      console.log('Set LIVE_TESTS=1 to enable import/process/accounts refresh workflows.');
    });
  });
}
