// Command registration for prices commands
// Orchestrates CLI interaction and handler execution

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { withDatabaseAndHandler } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import { PricesFetchHandler } from './prices-handler.ts';
import type { PricesFetchCommandOptions, PricesFetchResult } from './prices-utils.ts';

/**
 * Extended command options (adds CLI-specific flags).
 */
export interface ExtendedPricesFetchCommandOptions extends PricesFetchCommandOptions {
  json?: boolean | undefined;
  clearDb?: boolean | undefined;
}

/**
 * Result data for prices fetch command (JSON mode).
 */
interface PricesFetchCommandResult {
  stats: {
    failures: number;
    pricesFetched: number;
    pricesUpdated: number;
    skipped: number;
    transactionsFound: number;
  };
  errors: string[];
}

/**
 * Register the prices command with subcommands.
 */
export function registerPricesCommand(program: Command): void {
  const prices = program.command('prices').description('Manage cryptocurrency prices');

  // Fetch subcommand
  prices
    .command('fetch')
    .description('Fetch prices for transactions missing price data')
    .option('--asset <currency>', 'Filter by asset (e.g., BTC, ETH). Can be specified multiple times.', collect, [])
    .option('--batch-size <number>', 'Number of transactions to process in each batch', parseInt, 50)
    .option('--clear-db', 'Clear and reinitialize database before fetching')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedPricesFetchCommandOptions) => {
      await executePricesFetchCommand(options);
    });
}

/**
 * Helper to collect multiple option values
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Execute the prices fetch command.
 */
async function executePricesFetchCommand(options: ExtendedPricesFetchCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Build params from options
    const params: PricesFetchCommandOptions = {
      asset: options.asset,
      batchSize: options.batchSize,
    };

    const spinner = output.spinner();
    spinner?.start('Fetching prices...');

    // Configure logger to route logs to spinner
    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false, // TODO: Add --verbose flag support
    });

    const result = await withDatabaseAndHandler({ clearDb: options.clearDb }, PricesFetchHandler, params);

    // Reset logger context after command completes
    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Price fetch failed');
      output.error('prices-fetch', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handlePricesFetchSuccess(output, result.value, spinner);
  } catch (error) {
    output.error('prices-fetch', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful prices fetch.
 */
function handlePricesFetchSuccess(
  output: OutputManager,
  result: PricesFetchResult,
  spinner: ReturnType<OutputManager['spinner']>
) {
  const { stats, errors } = result;

  // Stop spinner with completion message
  const completionMessage = `Price fetch complete - ${stats.pricesUpdated} transactions updated, ${stats.failures} failures`;
  spinner?.stop(completionMessage);

  // Display text output
  if (output.isTextMode()) {
    console.log('');
    console.log('Price Fetch Results:');
    console.log('=============================');
    console.log(`Transactions found: ${stats.transactionsFound}`);
    console.log(`Prices fetched: ${stats.pricesFetched}`);
    console.log(`Transactions updated: ${stats.pricesUpdated}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Failures: ${stats.failures}`);

    if (errors.length > 0) {
      console.log('');
      console.warn(`⚠️  ${errors.length} errors occurred (showing first 5):`);
      for (const error of errors.slice(0, 5)) {
        console.warn(`  - ${error}`);
      }
    }
  }

  // Prepare result data for JSON mode
  const resultData: PricesFetchCommandResult = {
    stats,
    errors: errors.slice(0, 10), // First 10 errors
  };

  // Output success
  output.success('prices-fetch', resultData);
  process.exit(0);
}
