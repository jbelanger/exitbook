// Command registration for view transactions subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import { ViewTransactionsHandler } from './view-transactions-handler.ts';
import type { TransactionInfo, ViewTransactionsParams, ViewTransactionsResult } from './view-transactions-utils.ts';
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
    console.log('');
    console.log('Transactions:');
    console.log('=============================');
    console.log('');

    if (transactions.length === 0) {
      console.log('No transactions found.');
    } else {
      for (const tx of transactions) {
        const priceInfo = tx.price ? `${tx.price} ${tx.price_currency || ''}` : 'No price';
        const operationLabel =
          tx.operation_category && tx.operation_type ? `${tx.operation_category}/${tx.operation_type}` : 'Unknown';

        console.log(`Transaction #${tx.id}`);
        console.log(`   Source: ${tx.source_id} (${tx.source_type})`);
        console.log(`   Date: ${tx.transaction_datetime}`);
        console.log(`   Operation: ${operationLabel}`);

        if (tx.movements_primary_asset) {
          const direction = tx.movements_primary_direction || 'unknown';
          const directionIcon = direction === 'in' ? '←' : direction === 'out' ? '→' : '↔';
          console.log(
            `   Movement: ${directionIcon} ${tx.movements_primary_amount || '?'} ${tx.movements_primary_asset}`
          );
        }

        console.log(`   Price: ${priceInfo}`);

        if (tx.blockchain_transaction_hash) {
          console.log(`   Hash: ${tx.blockchain_transaction_hash}`);
        }

        if (tx.from_address || tx.to_address) {
          if (tx.from_address) console.log(`   From: ${tx.from_address}`);
          if (tx.to_address) console.log(`   To: ${tx.to_address}`);
        }

        console.log('');
      }
    }

    console.log('=============================');
    console.log(`Total: ${count} transactions`);
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
