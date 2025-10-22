// Command registration for view transactions subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import { ViewTransactionsHandler } from './view-transactions-handler.ts';
import type { TransactionInfo, ViewTransactionsParams, ViewTransactionsResult } from './view-transactions-utils.ts';
import { formatTransactionsListForDisplay } from './view-transactions-utils.ts';
import type { ViewCommandResult } from './view-utils.ts';
import { buildViewMeta } from './view-utils.ts';

/**
 * Extended command options (adds CLI-specific flags).
 */
export interface ExtendedViewTransactionsCommandOptions extends ViewTransactionsParams {
  json?: boolean | undefined;
}

/**
 * Result data for view transactions command (JSON mode).
 */
type ViewTransactionsCommandResult = ViewCommandResult<TransactionInfo[]>;

/**
 * Register the view transactions subcommand.
 */
export function registerViewTransactionsCommand(viewCommand: Command): void {
  viewCommand
    .command('transactions')
    .description('View processed transactions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook view transactions                            # View latest 50 transactions
  $ exitbook view transactions --limit 100                # View latest 100 transactions
  $ exitbook view transactions --asset BTC                # View Bitcoin transactions only
  $ exitbook view transactions --source kraken            # View Kraken transactions
  $ exitbook view transactions --since 2024-01-01         # View transactions from Jan 2024
  $ exitbook view transactions --operation-type trade     # View trades only
  $ exitbook view transactions --no-price                 # Find transactions missing price data

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
    .action(async (options: ExtendedViewTransactionsCommandOptions) => {
      await executeViewTransactionsCommand(options);
    });
}

/**
 * Execute the view transactions command.
 */
async function executeViewTransactionsCommand(options: ExtendedViewTransactionsCommandOptions): Promise<void> {
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

    const database = await initializeDatabase(false);
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
