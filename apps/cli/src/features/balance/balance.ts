import { BlockchainProviderManager, loadExplorerConfig } from '@exitbook/blockchain-providers';
import type { ExchangeCredentials } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import {
  AccountRepository,
  closeDatabase,
  ImportSessionRepository,
  initializeDatabase,
  TokenMetadataRepository,
  TransactionRepository,
} from '@exitbook/data';
import { BalanceService, type BalanceVerificationResult } from '@exitbook/ingestion';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { BalanceCommandOptionsSchema } from '../shared/schemas.js';

import { buildBalanceMismatchExplanation } from './balance-explain.js';
import { BalanceHandler } from './balance-handler.js';
import type { BalanceCommandResult } from './balance-types.js';

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
    .description('Verify balance for a specific account by ID')
    .requiredOption('--account-id <id>', 'Account ID to verify')
    .option('--api-key <key>', 'API key for exchange (overrides .env)')
    .option('--api-secret <secret>', 'API secret for exchange (overrides .env)')
    .option('--api-passphrase <passphrase>', 'API passphrase for exchange (if required)')
    .option('--explain', 'Print diagnostic breakdown for mismatches')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook balance --account-id 5                          # blockchain or exchange-csv account (no creds)
  $ exitbook balance --account-id 7 --api-key KEY --api-secret SECRET   # exchange-api or exchange-csv with live API fetch
  $ exitbook balance --account-id 5 --explain                # show mismatch diagnostics

Notes:
  - API credentials are accepted for exchange-api and exchange-csv accounts to fetch live balances from the exchange.
  - Use "exitbook accounts view" to list account IDs and types.
`
    )
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
    // Load the account by ID
    const accountResult = await accountRepository.findById(options.accountId);
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

    // Guard: credentials only make sense for exchange-backed accounts (api or csv with API fetch for live balance)
    const allowsCredentials = account.accountType === 'exchange-api' || account.accountType === 'exchange-csv';
    if (!allowsCredentials && credentials) {
      output.error(
        'balance',
        new Error('Credentials can only be provided for exchange API accounts'),
        ExitCodes.GENERAL_ERROR
      );
      return;
    }

    const result = await handler.execute({ accountId: account.id, credentials: credentials });

    spinner?.stop();

    if (result.isErr()) {
      output.error('balance', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    // Display results
    await handleBalanceSuccess(output, result.value, accountRepository, transactionRepository, options.explain);
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
  accountRepository: AccountRepository,
  transactionRepository: TransactionRepository,
  explain?: boolean
) {
  const account = verificationResult.account;

  // Check beacon withdrawal status using cursor state (no DB query needed)
  // Flagged early during import via cursor metadata
  let beaconStatus: {
    beaconWithdrawalsSkippedReason?: 'no-provider-support' | 'api-error' | 'unsupported-chain';
    includesBeaconWithdrawals?: boolean;
  } = {};

  const isExchange = account.accountType === 'exchange-api' || account.accountType === 'exchange-csv';
  if (!isExchange) {
    if (account.sourceName.toLowerCase() === 'ethereum') {
      const cursor = account.lastCursor?.['beacon_withdrawal'];
      if (cursor?.metadata?.fetchStatus === 'failed') {
        beaconStatus = { includesBeaconWithdrawals: false, beaconWithdrawalsSkippedReason: 'api-error' };
      } else if (!cursor || cursor?.metadata?.fetchStatus === 'skipped') {
        beaconStatus = { includesBeaconWithdrawals: false, beaconWithdrawalsSkippedReason: 'no-provider-support' };
      } else if (cursor.totalFetched > 0) {
        beaconStatus = { includesBeaconWithdrawals: true };
      }
    } else {
      beaconStatus = { beaconWithdrawalsSkippedReason: 'unsupported-chain' };
    }
  }

  // Display results in text mode
  if (output.isTextMode()) {
    //output.info(`Balance verification completed for account ${account.id} (${account.sourceName})`);

    // Display account info using clack-styled logs for consistent formatting
    output.info('Account Information:');
    output.log(`  Account ID: ${account.id}`);
    output.log(`  Source: ${account.sourceName}`);
    output.log(`  Type: ${account.accountType}`);
    if (account.accountType === 'blockchain') {
      output.log(`  Address: ${account.identifier}`);

      // Check if this account has children (xpub wallet)
      const childAccountsResult = await accountRepository.findByParent(account.id);
      if (childAccountsResult.isOk() && childAccountsResult.value.length > 0) {
        output.log(`  Extended Public Key: Yes (${childAccountsResult.value.length} derived addresses)`);
        output.log(`  Note: Balance aggregated from all derived addresses`);
      }
    } else {
      output.log(`  Identifier: ${account.identifier || 'N/A'}`);
    }
    if (account.providerName) {
      output.log(`  Provider: ${account.providerName}`);
    }

    // Beacon withdrawal status for Ethereum accounts
    if (beaconStatus.includesBeaconWithdrawals !== undefined) {
      output.log(`  Beacon Withdrawals: ${beaconStatus.includesBeaconWithdrawals ? 'Included' : 'Not Found'}`);
      if (!beaconStatus.includesBeaconWithdrawals && beaconStatus.beaconWithdrawalsSkippedReason) {
        const reason =
          beaconStatus.beaconWithdrawalsSkippedReason === 'no-provider-support'
            ? 'Provider does not support beacon withdrawals'
            : beaconStatus.beaconWithdrawalsSkippedReason === 'api-error'
              ? 'Beacon withdrawal fetch failed (check API key/provider)'
              : 'Chain does not support beacon withdrawals';
        output.log(`    Note: ${reason}`);
      }
    }

    // Summary
    output.info('Summary:');
    output.log(`  Total currencies: ${verificationResult.summary.totalCurrencies}`);
    output.log(`  Matches: ${verificationResult.summary.matches}`);
    output.log(`  Warnings: ${verificationResult.summary.warnings}`);
    output.log(`  Mismatches: ${verificationResult.summary.mismatches}`);

    // Show details for each currency
    if (verificationResult.comparisons.length > 0) {
      output.info('Balance Details:');
      for (const comparison of verificationResult.comparisons) {
        const statusIcon = comparison.status === 'match' ? '✓' : comparison.status === 'warning' ? '⚠' : '✗';
        output.log(`  ${statusIcon} ${comparison.currency}:`);
        output.log(`    Live:       ${comparison.liveBalance}`);
        output.log(`    Calculated: ${comparison.calculatedBalance}`);
        if (comparison.status !== 'match') {
          output.log(`    Difference: ${comparison.difference} (${comparison.percentageDiff.toFixed(2)}%)`);
        }
      }
    }

    // Show suggestion if available
    if (verificationResult.suggestion) {
      output.warn(`Suggestion: ${verificationResult.suggestion}`);
    }

    // Optional diagnostics for mismatches
    if (explain && verificationResult.summary.mismatches > 0) {
      const childAccountsResult = await accountRepository.findByParent(account.id);
      if (childAccountsResult.isErr()) {
        output.warn(`Explain: failed to load child accounts: ${childAccountsResult.error.message}`);
      } else {
        const accountIds = [account.id, ...childAccountsResult.value.map((child) => child.id)];
        const txResult = await transactionRepository.getTransactions({ accountIds });
        if (txResult.isErr()) {
          output.warn(`Explain: failed to load transactions: ${txResult.error.message}`);
        } else {
          const mismatches = verificationResult.comparisons.filter((c) => c.status === 'mismatch');
          const explainData = buildBalanceMismatchExplanation({
            accountIdentifier: account.identifier,
            transactions: txResult.value,
            mismatches: mismatches.map((m) => ({
              currency: m.currency,
              live: parseDecimal(m.liveBalance),
              calculated: parseDecimal(m.calculatedBalance),
            })),
          });

          if (explainData.isErr()) {
            output.warn(`Explain: ${explainData.error.message}`);
          } else if (explainData.value.lines.length > 0) {
            output.info('Explain:');
            for (const line of explainData.value.lines) {
              output.log(`  ${line}`);
            }
          }
        }
      }
    }

    // Outro after all details
    output.outro(`Balance verification completed`);
    return;
  }

  // Prepare result data for JSON mode

  const resultData: BalanceCommandResult = {
    status: verificationResult.status,
    balances: verificationResult.comparisons.map((c) => ({
      currency: c.currency,
      liveBalance: c.liveBalance,
      calculatedBalance: c.calculatedBalance,
      difference: c.difference,
      percentageDiff: c.percentageDiff,
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
      includesBeaconWithdrawals: beaconStatus.includesBeaconWithdrawals,
      beaconWithdrawalsSkippedReason: beaconStatus.beaconWithdrawalsSkippedReason,
    },
    suggestion: verificationResult.suggestion,
  };

  output.json('balance', resultData);
}
