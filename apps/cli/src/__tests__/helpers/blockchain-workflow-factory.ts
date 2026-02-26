import { beforeAll, describe, expect, it } from 'vitest';

import type { BalanceCommandResult, ImportCommandResult, ReprocessCommandResult } from './e2e-test-types.js';
import { canBindUnixSocket, cleanupTestDatabase, executeCLI } from './e2e-test-utils.js';

export interface BlockchainTestCase {
  /**
   * Blockchain name (e.g., 'bitcoin', 'ethereum')
   */
  blockchain: string;

  /**
   * Wallet address to test
   */
  address: string;

  /**
   * Description for this test case
   */
  description?: string;
}

export interface BlockchainConfig {
  /**
   * Blockchain name (e.g., 'bitcoin', 'ethereum')
   */
  name: string;

  /**
   * Display name for test descriptions
   */
  displayName: string;

  /**
   * Test cases with addresses to test
   * Can provide multiple addresses to test different scenarios
   */
  testCases: BlockchainTestCase[];

  /**
   * Environment variables required for API access (optional)
   */
  requiredEnvVars?: string[];

  /**
   * Minimum match rate for balance verification (0-1)
   * @default 0.95 (blockchains typically have exact matches)
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
 * Creates a test suite for a blockchain workflow
 */
export function createBlockchainWorkflowTests(config: BlockchainConfig): void {
  const {
    displayName,
    testCases,
    requiredEnvVars = [],
    minMatchRate = 0.95,
    workflowTimeout = 300000,
    combinedWorkflowTimeout = 120000,
  } = config;

  describe(`${displayName} E2E Workflow`, () => {
    const liveTestsEnabled = process.env['LIVE_TESTS'] === '1';
    // Check credentials if required
    const hasCredentials = requiredEnvVars.length === 0 || requiredEnvVars.every((envVar) => !!process.env[envVar]);

    const shouldSkip = !liveTestsEnabled || !hasCredentials || testCases.length === 0;
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

    // Create a test for each test case
    testCases.forEach((testCase) => {
      const { blockchain, address, description } = testCase;
      const testDescription = description || `address ${address.slice(0, 10)}...`;

      it.skipIf(shouldSkip)(
        `should import, process, and verify balance for ${displayName} ${testDescription}`,
        () => {
          if (skipImportTests) {
            console.warn('Skipping test: import IPC not permitted in this environment.');
            return;
          }

          console.log(`\nTesting ${displayName} workflow for ${testDescription}\n`);

          // Step 1: Import blockchain data
          console.log('Step 1: Importing blockchain data...');

          const importResult = executeCLI(['import', '--blockchain', blockchain, '--address', address]);

          expect(importResult.success).toBe(true);
          expect(importResult.command).toBe('import');

          const importData = importResult.data as ImportCommandResult;
          expect(importData).toBeDefined();
          expect(importData.import.counts.imported).toBeGreaterThan(0);

          console.log(
            `\nTotal imported: ${importData.import.counts.imported}, skipped: ${importData.import.counts.skipped}\n`
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
          const accountsResult = executeCLI(['accounts', 'view', '--source', blockchain, '--json']);
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

          // Find the account matching this address
          const account = accounts.find((acc) => acc.identifier === address);
          expect(account).toBeDefined();
          const accountId = account?.id;
          expect(Number(accountId)).toBeGreaterThan(0);

          const balanceArgs = ['balance', '--account-id', String(accountId)];

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

          // Verify minimum match rate (blockchain imports typically have exact matches)
          const matchRate = balanceData.summary.matches / balanceData.summary.totalCurrencies;
          expect(matchRate).toBeGreaterThan(minMatchRate);
        },
        workflowTimeout
      );

      it.skipIf(shouldSkip)(
        `should support combined import+process workflow for ${displayName} ${testDescription}`,
        () => {
          if (skipImportTests) {
            console.warn('Skipping test: import IPC not permitted in this environment.');
            return;
          }

          console.log(`\nTesting combined import+process workflow for ${displayName} ${testDescription}\n`);

          // Clean database for fresh test
          cleanupTestDatabase();

          console.log(`Importing and processing ${blockchain} address ${address}...`);

          const importResult = executeCLI(['import', '--blockchain', blockchain, '--address', address]);

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
    });

    // Helpful error messages when prerequisites are missing
    it('should provide helpful error when test cases are missing', () => {
      if (testCases.length > 0) {
        console.log(`${displayName} test cases exist - skipping missing test cases warning`);
        return;
      }

      console.log(`\nNo ${displayName} test cases configured`);
      console.log('Please add test cases with blockchain addresses to test the workflow');
    });

    it('should provide helpful error when credentials are missing', () => {
      if (hasCredentials || requiredEnvVars.length === 0) {
        console.log(`${displayName} credentials exist or not required - skipping missing credentials test`);
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
      console.log('\nLive blockchain workflow tests are disabled.');
      console.log('Set LIVE_TESTS=1 to enable import/process/balance workflows.');
    });
  });
}
