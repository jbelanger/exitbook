// Command registration for view transactions subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { TransactionsViewCommandOptionsSchema } from '../shared/schemas.js';
import type { ViewCommandResult } from '../shared/view-utils.js';
import { buildViewMeta } from '../shared/view-utils.js';

import { ViewTransactionsHandler } from './transactions-view-handler.js';
import type { TransactionInfo, ViewTransactionsParams, ViewTransactionsResult } from './transactions-view-utils.js';
import { formatTransactionsListForDisplay } from './transactions-view-utils.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof TransactionsViewCommandOptionsSchema>;

/**
 * Result data for view transactions command (JSON mode).
 */
type ViewTransactionsCommandResult = ViewCommandResult<TransactionInfo[]>;

/**
 * Register the transactions view subcommand.
 */
export function registerTransactionsViewCommand(transactionsCommand: Command): void {
  transactionsCommand
    .command('view')
    .description('View processed transactions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook transactions view                            # View latest 50 transactions
  $ exitbook transactions view --limit 100                # View latest 100 transactions
  $ exitbook transactions view --asset BTC                # View Bitcoin transactions only
  $ exitbook transactions view --source kraken            # View Kraken transactions
  $ exitbook transactions view --since 2024-01-01         # View transactions from Jan 2024
  $ exitbook transactions view --operation-type trade     # View trades only
  $ exitbook transactions view --no-price                 # Find transactions missing price data

Common Usage:
  - Review recent trading activity across all exchanges
  - Audit specific assets or date ranges
  - Identify transactions that need price data
  - Verify imported data accuracy
`
    )
    .option('--source <name>', 'Filter by exchange or blockchain name')
    .option('--asset <currency>', 'Filter by asset (e.g., BTC, ETH)')
    .option('--since <date>', 'Filter by date (ISO 8601 format, e.g., 2024-01-01)')
    .option('--until <date>', 'Filter by date (ISO 8601 format, e.g., 2024-12-31)')
    .option('--operation-type <type>', 'Filter by operation type')
    .option('--no-price', 'Show only transactions without price data')
    .option('--limit <number>', 'Maximum number of transactions to return', parseInt)
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (rawOptions: unknown) => {
      await executeViewTransactionsCommand(rawOptions);
    });
}

/**
 * Execute the view transactions command.
 */
async function executeViewTransactionsCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = TransactionsViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
    output.error(
      'transactions-view',
      new Error(parseResult.error.issues[0]?.message || 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Build params from options
    const params: ViewTransactionsParams = {
      source: options.source,
      asset: options.asset,
      since: options.since,
      until: options.until,
      operationType: options.operationType,
      noPrice: options.noPrice,
      limit: options.limit || 50, // Default limit
    };

    const spinner = output.spinner();
    spinner?.start('Fetching transactions...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
    });

    // Initialize repository
    const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');

    const database = await initializeDatabase();
    const txRepo = new TransactionRepository(database);

    const handler = new ViewTransactionsHandler(txRepo);

    const result = await handler.execute(params);

    handler.destroy();
    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Failed to fetch transactions');
      output.error('view-transactions', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleViewTransactionsSuccess(output, result.value, params, spinner);
  } catch (error) {
    resetLoggerContext();
    output.error(
      'view-transactions',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR
    );
  }
}

/**
 * Handle successful view transactions.
 */
function handleViewTransactionsSuccess(
  output: OutputManager,
  result: ViewTransactionsResult,
  params: ViewTransactionsParams,
  spinner: ReturnType<OutputManager['spinner']>
): void {
  const { transactions, count } = result;

  spinner?.stop(`Found ${count} transactions`);

  // Display text output
  if (output.isTextMode()) {
    console.log(formatTransactionsListForDisplay(transactions, count));
  }

  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.source) filters.source = params.source;
  if (params.asset) filters.asset = params.asset;
  if (params.since) filters.since = params.since;
  if (params.until) filters.until = params.until;
  if (params.operationType) filters.operationType = params.operationType;
  if (params.noPrice) filters.noPrice = params.noPrice;

  const resultData: ViewTransactionsCommandResult = {
    data: transactions,
    meta: buildViewMeta(count, 0, params.limit || 50, count, filters),
  };

  output.success('view-transactions', resultData);
  process.exit(0);
}
