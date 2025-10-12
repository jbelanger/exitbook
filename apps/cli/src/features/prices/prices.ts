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
  interactive?: boolean | undefined;
}

/**
 * Result data for prices fetch command (JSON mode).
 */
interface PricesFetchCommandResult {
  stats: {
    failures: number;
    manualEntries: number;
    movementsUpdated: number;
    pricesFetched: number;
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
    .option('--interactive', 'Enable interactive mode for manual price entry when coins are not found')
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
      interactive: options.interactive,
    };

    // Don't use spinner in interactive mode (conflicts with prompts)
    const spinner = options.interactive ? undefined : output.spinner();
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
  const completionMessage = `Price fetch complete - ${stats.movementsUpdated} movements updated, ${stats.failures} failures`;
  spinner?.stop(completionMessage);

  // Display text output
  if (output.isTextMode()) {
    console.log('');
    console.log('Price Fetch Results:');
    console.log('=============================');
    console.log(`Transactions found: ${stats.transactionsFound}`);
    console.log(`Prices fetched: ${stats.pricesFetched}`);
    console.log(`Manual entries: ${stats.manualEntries}`);
    console.log(`Movements updated: ${stats.movementsUpdated}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Failures: ${stats.failures}`);

    // Show granularity breakdown if any prices were fetched
    if (stats.pricesFetched > 0) {
      console.log('');
      console.log('Price Granularity:');
      if (stats.granularity.minute > 0) {
        console.log(`  Minute-level: ${stats.granularity.minute}`);
      }
      if (stats.granularity.hour > 0) {
        console.log(`  Hourly: ${stats.granularity.hour}`);
      }
      if (stats.granularity.day > 0) {
        console.log(`  Daily: ${stats.granularity.day}`);
      }

      // Warn if intraday requests returned only daily data
      const totalIntraday = stats.granularity.minute + stats.granularity.hour;
      if (stats.granularity.day > 0 && totalIntraday > 0) {
        console.log('');
        console.warn(`⚠️  ${stats.granularity.day} prices fetched at daily granularity (intraday not available)`);
      }
    }

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
