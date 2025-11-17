import { BlockchainProviderManager, loadExplorerConfig } from '@exitbook/blockchain-providers';
import type { SourceType } from '@exitbook/core';
import {
  AccountRepository,
  closeDatabase,
  initializeDatabase,
  TokenMetadataRepository,
  TransactionRepository,
  UserRepository,
} from '@exitbook/data';
import { DataSourceRepository, BalanceService, type BalanceVerificationResult } from '@exitbook/ingestion';
import type { Command } from 'commander';

import { unwrapResult } from '../shared/command-execution.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';

import { BalanceHandler } from './balance-handler.js';
import type { BalanceCommandResult, ExtendedBalanceCommandOptions } from './balance-types.js';
import { buildBalanceParamsFromFlags } from './balance-utils.js';

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
    .action(async (options: ExtendedBalanceCommandOptions) => {
      await executeBalanceCommand(options);
    });
}

/**
 * Execute the balance command.
 */
async function executeBalanceCommand(options: ExtendedBalanceCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  // Initialize database
  const database = await initializeDatabase();

  // Initialize repositories
  const transactionRepository = new TransactionRepository(database);
  const sessionRepository = new DataSourceRepository(database);
  const accountRepository = new AccountRepository(database);
  const tokenMetadataRepository = new TokenMetadataRepository(database);
  const userRepository = new UserRepository(database);

  // Initialize provider manager
  const config = loadExplorerConfig();
  const providerManager = new BlockchainProviderManager(config);

  // Create service with repositories
  const balanceService = new BalanceService(
    userRepository,
    accountRepository,
    transactionRepository,
    sessionRepository,
    tokenMetadataRepository,
    providerManager
  );

  // Create handler with service
  const handler = new BalanceHandler(balanceService);

  try {
    // Build params from flags (no interactive mode for balance command)
    const params = unwrapResult(buildBalanceParamsFromFlags(options));

    const spinner = output.spinner();
    spinner?.start(`Fetching and verifying balance for ${params.sourceName}...`);

    const result = await handler.execute(params);

    spinner?.stop();

    if (result.isErr()) {
      output.error('balance', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    // Account is now included in the verification result
    handleBalanceSuccess(output, result.value, params.sourceName, params.sourceType, params.address);
  } catch (error) {
    output.error('balance', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  } finally {
    handler.destroy();
    await closeDatabase(database);
  }
}

/**
 * Handle successful balance verification.
 */
function handleBalanceSuccess(
  output: OutputManager,
  verificationResult: BalanceVerificationResult,
  sourceName: string,
  sourceType: SourceType,
  address?: string
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
    } else {
      console.log(`  Identifier: ${account.identifier || 'N/A'}`);
    }
    if (account.providerName) {
      console.log(`  Provider: ${account.providerName}`);
    }
    console.log('');

    const statusSymbol =
      verificationResult.status === 'success' ? '✓' : verificationResult.status === 'warning' ? '⚠' : '✗';
    output.outro(`${statusSymbol} Balance verification ${verificationResult.status.toUpperCase()} for ${sourceName}`);
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
      type: sourceType,
      name: sourceName,
      address,
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
  // Map status to exit codes: success=0, warning=0, failed=1
  const statusExitCodeMap: Record<string, number> = {
    success: 0,
    warning: 0,
    failed: 1,
  };
  process.exit(statusExitCodeMap[verificationResult.status] ?? 1);
}
