/**
 * Command registration for prices enrich subcommand
 *
 * Unified price enrichment pipeline with three sequential stages:
 * 1. Normalize - Convert non-USD fiat prices to USD using FX providers
 * 2. Derive - Extract prices from USD trades and propagate via links
 * 3. Fetch - Fetch missing crypto prices from external providers
 */

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { withDatabaseAndHandler } from '../shared/command-execution.ts';
import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import { PricesEnrichHandler } from './prices-enrich-handler.ts';
import type { PricesEnrichOptions, PricesEnrichResult } from './prices-enrich-handler.ts';

/**
 * Extended command options (adds CLI-specific flags)
 */
export interface ExtendedPricesEnrichCommandOptions extends PricesEnrichOptions {
  json?: boolean | undefined;
}

/**
 * Result data for prices enrich command (JSON mode)
 */
interface PricesEnrichCommandResult {
  normalize?:
    | {
        errors: string[];
        failures: number;
        movementsNormalized: number;
        movementsSkipped: number;
      }
    | undefined;
  derive?:
    | {
        transactionsUpdated: number;
      }
    | undefined;
  fetch?:
    | {
        errors: string[];
        stats: {
          failures: number;
          granularity: {
            day: number;
            hour: number;
            minute: number;
          };
          manualEntries: number;
          movementsUpdated: number;
          pricesFetched: number;
          skipped: number;
          transactionsFound: number;
        };
      }
    | undefined;
}

/**
 * Register the prices enrich subcommand
 */
export function registerPricesEnrichCommand(pricesCommand: Command): void {
  pricesCommand
    .command('enrich')
    .description('Enrich prices via normalize → derive → fetch pipeline')
    .option('--asset <currency>', 'Filter by asset (e.g., BTC, ETH). Can be specified multiple times.', collect, [])
    .option('--interactive', 'Enable interactive mode for manual entry when prices/FX rates unavailable')
    .option('--normalize-only', 'Only run normalization stage (FX conversion)')
    .option('--derive-only', 'Only run derivation stage (extract from USD trades)')
    .option('--fetch-only', 'Only run fetch stage (external providers)')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedPricesEnrichCommandOptions) => {
      await executePricesEnrichCommand(options);
    });
}

/**
 * Helper to collect multiple option values
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Execute the prices enrich command
 */
async function executePricesEnrichCommand(options: ExtendedPricesEnrichCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Build params from options
    const params: PricesEnrichOptions = {
      asset: options.asset,
      interactive: options.interactive,
      normalizeOnly: options.normalizeOnly,
      deriveOnly: options.deriveOnly,
      fetchOnly: options.fetchOnly,
    };

    // Don't use spinner in interactive mode (conflicts with prompts)
    const spinner = options.interactive ? undefined : output.spinner();
    spinner?.start('Running price enrichment pipeline...');

    // Configure logger to route logs to spinner
    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false, // TODO: Add --verbose flag support
    });

    const result = await withDatabaseAndHandler(PricesEnrichHandler, params);

    // Reset logger context after command completes
    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Price enrichment failed');
      output.error('prices-enrich', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handlePricesEnrichSuccess(output, result.value, spinner);
  } catch (error) {
    output.error('prices-enrich', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful prices enrich
 */
function handlePricesEnrichSuccess(
  output: OutputManager,
  result: PricesEnrichResult,
  spinner: ReturnType<OutputManager['spinner']>
) {
  // Stop spinner with completion message
  const completionMessage = buildCompletionMessage(result);
  spinner?.stop(completionMessage);

  // Display text output
  if (output.isTextMode()) {
    console.log('');
    console.log('Price Enrichment Results:');
    console.log('=============================');

    // Stage 1: Normalize
    if (result.normalize) {
      console.log('');
      console.log('Stage 1: Normalize (FX Conversion)');
      console.log(`  Movements normalized: ${result.normalize.movementsNormalized}`);
      console.log(`  Movements skipped: ${result.normalize.movementsSkipped}`);
      console.log(`  Failures: ${result.normalize.failures}`);

      if (result.normalize.errors.length > 0) {
        console.log('');
        console.warn(`  ⚠️  ${result.normalize.errors.length} errors occurred (showing first 5):`);
        for (const error of result.normalize.errors.slice(0, 5)) {
          console.warn(`    - ${error}`);
        }
      }
    }

    // Stage 2: Derive
    if (result.derive) {
      console.log('');
      console.log('Stage 2: Derive (USD Trades)');
      console.log(`  Transactions updated: ${result.derive.transactionsUpdated}`);
    }

    // Stage 3: Fetch
    if (result.fetch) {
      console.log('');
      console.log('Stage 3: Fetch (External Providers)');
      console.log(`  Transactions found: ${result.fetch.stats.transactionsFound}`);
      console.log(`  Prices fetched: ${result.fetch.stats.pricesFetched}`);
      console.log(`  Manual entries: ${result.fetch.stats.manualEntries}`);
      console.log(`  Movements updated: ${result.fetch.stats.movementsUpdated}`);
      console.log(`  Skipped: ${result.fetch.stats.skipped}`);
      console.log(`  Failures: ${result.fetch.stats.failures}`);

      // Show granularity breakdown if any prices were fetched
      if (result.fetch.stats.pricesFetched > 0) {
        console.log('');
        console.log('  Price Granularity:');
        if (result.fetch.stats.granularity.minute > 0) {
          console.log(`    Minute-level: ${result.fetch.stats.granularity.minute}`);
        }
        if (result.fetch.stats.granularity.hour > 0) {
          console.log(`    Hourly: ${result.fetch.stats.granularity.hour}`);
        }
        if (result.fetch.stats.granularity.day > 0) {
          console.log(`    Daily: ${result.fetch.stats.granularity.day}`);
        }
      }

      if (result.fetch.errors.length > 0) {
        console.log('');
        console.warn(`  ⚠️  ${result.fetch.errors.length} errors occurred (showing first 5):`);
        for (const error of result.fetch.errors.slice(0, 5)) {
          console.warn(`    - ${error}`);
        }
      }
    }
  }

  // Prepare result data for JSON mode
  const resultData: PricesEnrichCommandResult = {
    normalize: result.normalize,
    derive: result.derive,
    fetch: result.fetch,
  };

  // Output success
  output.success('prices-enrich', resultData);
  process.exit(0);
}

/**
 * Build completion message for spinner
 */
function buildCompletionMessage(result: PricesEnrichResult): string {
  const parts: string[] = [];

  if (result.normalize) {
    parts.push(`${result.normalize.movementsNormalized} normalized`);
  }

  if (result.derive) {
    parts.push(`${result.derive.transactionsUpdated} derived`);
  }

  if (result.fetch) {
    parts.push(`${result.fetch.stats.movementsUpdated} fetched`);
  }

  return `Price enrichment complete - ${parts.join(', ')}`;
}
