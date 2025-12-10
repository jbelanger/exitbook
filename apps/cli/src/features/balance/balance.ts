import { BlockchainProviderManager, loadExplorerConfig } from '@exitbook/blockchain-providers';
import type { ExchangeCredentials } from '@exitbook/core';
import {
  AccountRepository,
  closeDatabase,
  ImportSessionRepository,
  initializeDatabase,
  TokenMetadataRepository,
  TransactionRepository,
  UserRepository,
} from '@exitbook/data';
import { BalanceService, type BalanceVerificationResult } from '@exitbook/ingestion';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { BalanceCommandOptionsSchema } from '../shared/schemas.js';

import { BalanceHandler } from './balance-handler.js';
import type { BalanceCommandResult } from './balance-types.js';
import { findAccountForBalance } from './balance-utils.js';

/**
 * Balance command options validated by Zod at CLI boundary
 */
export type BalanceCommandOptions = z.infer<typeof BalanceCommandOptionsSchema>;

/**
 * Register the balance command.
 */
export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Verify balance by comparing live balance against calculated balance from transactions')
    .option('--exchange <name>', 'Exchange name (e.g., kraken, kucoin)')
    .option('--blockchain <name>', 'Blockchain name (e.g., bitcoin, ethereum, solana)')
    .option('--address <address>', 'Wallet address (required for blockchain sources)')
    .option('--provider <name>', 'Blockchain provider for blockchain sources')
    .option('--api-key <key>', 'API key for exchange (overrides .env)')
    .option('--api-secret <secret>', 'API secret for exchange (overrides .env)')
    .option('--api-passphrase <passphrase>', 'API passphrase for exchange (if required)')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (rawOptions: unknown) => {
      await executeBalanceCommand(rawOptions);
    });
}

/**
 * Execute the balance command.
 */
async function executeBalanceCommand(rawOptions: unknown): Promise<void> {
  // Check for --json flag early (even before validation) to determine output format
  const isJsonMode =
    typeof rawOptions === 'object' && rawOptions !== null && 'json' in rawOptions && rawOptions.json === true;

  // Validate options at CLI boundary with Zod
  const validationResult = BalanceCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const output = new OutputManager(isJsonMode ? 'json' : 'text');
    const firstError = validationResult.error.issues[0];
    output.error('balance', new Error(firstError?.message ?? 'Invalid options'), ExitCodes.GENERAL_ERROR);
    return;
  }

  const options = validationResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  // Configure logger for JSON mode
  if (options.json) {
    configureLogger({
      mode: 'json',
      verbose: false,
      sinks: { ui: false, structured: 'file' },
    });
  }

  // Initialize database
  const database = await initializeDatabase();

  // Initialize repositories
  const transactionRepository = new TransactionRepository(database);
  const sessionRepository = new ImportSessionRepository(database);
  const accountRepository = new AccountRepository(database);
  const tokenMetadataRepository = new TokenMetadataRepository(database);
  const userRepository = new UserRepository(database);

  // Initialize provider manager
  const config = loadExplorerConfig();
  const providerManager = new BlockchainProviderManager(config);

  // Create service with repositories
  const balanceService = new BalanceService(
    accountRepository,
    transactionRepository,
    sessionRepository,
    tokenMetadataRepository,
    providerManager
  );

  // Create handler with service
  const handler = new BalanceHandler(balanceService);

  try {
    // Find account based on CLI options
    const accountResult = await findAccountForBalance(options, accountRepository, userRepository);
    if (accountResult.isErr()) {
      output.error('balance', accountResult.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    const account = accountResult.value;

    const spinner = output.spinner();
    spinner?.start(`Fetching and verifying balance for ${account.sourceName} (account ${account.id})...`);

    // Build credentials if provided
    let credentials: ExchangeCredentials | undefined;
    if (options.apiKey && options.apiSecret) {
      credentials = {
        apiKey: options.apiKey,
        apiSecret: options.apiSecret,
        ...(options.apiPassphrase && { apiPassphrase: options.apiPassphrase }),
      };
    }

    const result = await handler.execute({ accountId: account.id, credentials: credentials });

    spinner?.stop();

    if (result.isErr()) {
      output.error('balance', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    // Display results
    await handleBalanceSuccess(output, result.value, accountRepository);
  } catch (error) {
    resetLoggerContext();
    output.error('balance', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  } finally {
    handler.destroy();
    await closeDatabase(database);
    resetLoggerContext();
  }
}

/**
 * Handle successful balance verification.
 */
async function handleBalanceSuccess(
  output: OutputManager,
  verificationResult: BalanceVerificationResult,
  accountRepository: AccountRepository
) {
  const account = verificationResult.account;

  // Display results in text mode
  if (output.isTextMode()) {
    // Display account info
    console.log('');
    console.log('Account Information:');
    console.log(`  Account ID: ${account.id}`);
    console.log(`  Source: ${account.sourceName}`);
    console.log(`  Type: ${account.accountType}`);
    if (account.accountType === 'blockchain') {
      console.log(`  Address: ${account.identifier}`);

      // Check if this account has children (xpub wallet)
      const childAccountsResult = await accountRepository.findByParent(account.id);
      if (childAccountsResult.isOk() && childAccountsResult.value.length > 0) {
        console.log(`  Extended Public Key: Yes (${childAccountsResult.value.length} derived addresses)`);
        console.log(`  Note: Balance aggregated from all derived addresses`);
      }
    } else {
      console.log(`  Identifier: ${account.identifier || 'N/A'}`);
    }
    if (account.providerName) {
      console.log(`  Provider: ${account.providerName}`);
    }
    console.log('');

    const statusSymbol =
      verificationResult.status === 'success' ? '✓' : verificationResult.status === 'warning' ? '⚠' : '✗';
    output.outro(
      `${statusSymbol} Balance verification ${verificationResult.status.toUpperCase()} for ${account.sourceName}`
    );
    console.log('');

    // Summary
    console.log('Summary:');
    console.log(`  Total currencies: ${verificationResult.summary.totalCurrencies}`);
    console.log(`  Matches: ${verificationResult.summary.matches}`);
    console.log(`  Warnings: ${verificationResult.summary.warnings}`);
    console.log(`  Mismatches: ${verificationResult.summary.mismatches}`);
    console.log('');

    // Show details for each currency
    if (verificationResult.comparisons.length > 0) {
      console.log('Balance Details:');
      for (const comparison of verificationResult.comparisons) {
        const statusIcon = comparison.status === 'match' ? '✓' : comparison.status === 'warning' ? '⚠' : '✗';
        console.log(`  ${statusIcon} ${comparison.currency}:`);
        console.log(`    Live:       ${comparison.liveBalance}`);
        console.log(`    Calculated: ${comparison.calculatedBalance}`);
        if (comparison.status !== 'match') {
          console.log(`    Difference: ${comparison.difference} (${comparison.percentageDiff.toFixed(2)}%)`);
        }
      }
      console.log('');
    }

    // Show suggestion if available
    if (verificationResult.suggestion) {
      console.log(`Suggestion: ${verificationResult.suggestion}`);
      console.log('');
    }
  }

  // Prepare result data for JSON mode
  const isExchange = account.accountType === 'exchange-api' || account.accountType === 'exchange-csv';
  const resultData: BalanceCommandResult = {
    status: verificationResult.status,
    liveBalances: Object.fromEntries(verificationResult.comparisons.map((c) => [c.currency, c.liveBalance])),
    calculatedBalances: Object.fromEntries(
      verificationResult.comparisons.map((c) => [c.currency, c.calculatedBalance])
    ),
    comparisons: verificationResult.comparisons.map((c) => ({
      currency: c.currency,
      liveBalance: c.liveBalance,
      calculatedBalance: c.calculatedBalance,
      difference: c.difference,
      status: c.status,
    })),
    summary: verificationResult.summary,
    source: {
      type: isExchange ? 'exchange' : 'blockchain',
      name: account.sourceName,
      address: isExchange ? undefined : account.identifier,
    },
    account: {
      id: account.id,
      type: account.accountType,
      sourceName: account.sourceName,
      identifier: account.identifier,
      providerName: account.providerName,
    },
    meta: {
      timestamp: new Date(verificationResult.timestamp).toISOString(),
    },
    suggestion: verificationResult.suggestion,
  };

  output.success('balance', resultData);
  // Balance verification is informational - exit with 0 even on mismatches
  process.exit(0);
}
