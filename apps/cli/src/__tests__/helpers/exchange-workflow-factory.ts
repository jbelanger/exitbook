import { beforeAll, describe, expect, it } from 'vitest';

import type { BalanceCommandResult, ImportCommandResult, ProcessCommandResult } from './e2e-test-types.js';
import { canBindUnixSocket, cleanupTestDatabase, executeCLI, getSampleDir, hasSampleData } from './e2e-test-utils.js';

export interface ExchangeConfig {
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
   * Additional CLI arguments for balance command (e.g., ['--api-passphrase', value])
   * Optional - for exchanges that need extra params beyond key/secret
   */
  extraBalanceArgs?: (envVars: Record<string, string>) => string[];

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
    extraBalanceArgs,
    minMatchRate = 0.8,
    workflowTimeout = 300000,
    combinedWorkflowTimeout = 120000,
  } = config;

  describe(`${displayName} E2E Workflow`, () => {
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
    const shouldSkip = !hasCredentials || !hasSamples;
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

        const importResult = executeCLI(['import', '--exchange', name, '--csv-dir', sampleDir]);

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

        // Fetch the imported account id dynamically
        const accountsResult = executeCLI(['accounts', 'view', '--source', name, '--json']);
        expect(accountsResult.success).toBe(true);

        // Type assertion needed because CLI response has deeply nested structure
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- acceptable for tests
        const accounts = ((accountsResult.data as any)?.data?.accounts ?? []) as {
          accountType: string;
          id: number;
          identifier: string;
          sourceName: string;
        }[];
        expect(accounts.length).toBeGreaterThan(0);
        const accountId = accounts[0]?.id;
        expect(Number(accountId)).toBeGreaterThan(0);

        // Build balance command arguments
        const balanceArgs = ['balance', '--account-id', String(accountId)];

        // Add required credentials (assuming first two are key/secret pattern)
        const [apiKeyVar, apiSecretVar] = requiredEnvVars;
        if (apiKeyVar && apiSecretVar) {
          balanceArgs.push('--api-key', credentials[apiKeyVar]!);
          balanceArgs.push('--api-secret', credentials[apiSecretVar]!);
        }

        // Add any extra arguments specific to this exchange
        if (extraBalanceArgs) {
          balanceArgs.push(...extraBalanceArgs(credentials));
        }

        const balanceResult = executeCLI(balanceArgs);

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

        // Show sample comparisons
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
        expect(['success', 'warning']).toContain(balanceData.status);
        expect(balanceData.summary.totalCurrencies).toBeGreaterThan(0);

        // Verify minimum match rate
        const matchRate = balanceData.summary.matches / balanceData.summary.totalCurrencies;
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

        const importResult = executeCLI(['import', '--exchange', name, '--csv-dir', sampleDir, '--process']);

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
  });
}
