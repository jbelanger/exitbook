// Command registration for view prices subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { PricesViewCommandOptionsSchema } from '../shared/schemas.js';
import type { ViewCommandResult } from '../shared/view-utils.js';
import { buildViewMeta } from '../shared/view-utils.js';

import { ViewPricesHandler } from './prices-view-handler.js';
import type { PriceCoverageInfo, ViewPricesParams, ViewPricesResult } from './prices-view-utils.js';
import { formatPriceCoverageListForDisplay } from './prices-view-utils.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof PricesViewCommandOptionsSchema>;

/**
 * Result data for view prices command (JSON mode).
 */
type ViewPricesCommandResult = ViewCommandResult<{
  coverage: PriceCoverageInfo[];
  summary: ViewPricesResult['summary'];
}>;

/**
 * Register the prices view subcommand.
 */
export function registerPricesViewCommand(pricesCommand: Command): void {
  pricesCommand
    .command('view')
    .description('View price coverage statistics')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook prices view                    # View price coverage for all assets
  $ exitbook prices view --asset BTC        # View price coverage for Bitcoin only
  $ exitbook prices view --missing-only     # Show only assets missing price data
  $ exitbook prices view --source kraken    # View coverage for Kraken transactions

Common Usage:
  - Identify which assets need price data before generating tax reports
  - Check price coverage percentage per asset
  - Find gaps in historical pricing data
`
    )
    .option('--source <name>', 'Filter by exchange or blockchain name')
    .option('--asset <currency>', 'Filter by specific asset (e.g., BTC, ETH)')
    .option('--missing-only', 'Show only assets with missing price data')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeViewPricesCommand(rawOptions);
    });
}

/**
 * Execute the view prices command.
 */
async function executeViewPricesCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = PricesViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
    output.error(
      'prices-view',
      new Error(parseResult.error.issues[0]?.message || 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Build params from options
    const params: ViewPricesParams = {
      asset: options.asset,
      missingOnly: options.missingOnly,
    };

    const spinner = output.spinner();
    spinner?.start('Analyzing price coverage...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
      sinks: options.json
        ? { ui: false, structured: 'file' }
        : spinner
          ? { ui: true, structured: 'off' }
          : { ui: false, structured: 'stdout' },
    });

    // Initialize repository
    const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');

    const database = await initializeDatabase();
    const txRepo = new TransactionRepository(database);

    const handler = new ViewPricesHandler(txRepo);

    const result = await handler.execute(params);

    handler.destroy();
    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Failed to analyze price coverage');
      output.error('view-prices', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    // Only call handleViewPricesSuccess if result is Ok
    if (result.isOk()) {
      handleViewPricesSuccess(output, result.value, params, spinner);
    }
  } catch (error) {
    resetLoggerContext();
    output.error('view-prices', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful view prices.
 */
function handleViewPricesSuccess(
  output: OutputManager,
  result: ViewPricesResult,
  params: ViewPricesParams,
  spinner: ReturnType<OutputManager['spinner']>
): void {
  const { coverage, summary } = result;

  spinner?.stop(`Analyzed ${summary.total_transactions} transactions across ${coverage.length} assets`);

  // Display text output
  if (output.isTextMode()) {
    console.log(formatPriceCoverageListForDisplay(result, params.missingOnly));
  }

  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.asset) filters.asset = params.asset;
  if (params.missingOnly) filters.missingOnly = params.missingOnly;

  const resultData: ViewPricesCommandResult = {
    data: {
      coverage,
      summary,
    },
    meta: buildViewMeta(coverage.length, 0, coverage.length, coverage.length, filters),
  };

  output.json('view-prices', resultData);
  process.exit(0);
}
