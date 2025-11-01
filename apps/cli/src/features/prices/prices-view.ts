// Command registration for view prices subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';
import type { ViewCommandResult } from '../shared/view-utils.ts';
import { buildViewMeta } from '../shared/view-utils.ts';

import { ViewPricesHandler } from './prices-view-handler.ts';
import type { PriceCoverageInfo, ViewPricesParams, ViewPricesResult } from './prices-view-utils.ts';
import { formatPriceCoverageListForDisplay } from './prices-view-utils.ts';

/**
 * Extended command options (adds CLI-specific flags).
 */
export interface ExtendedViewPricesCommandOptions extends ViewPricesParams {
  source?: string | undefined;
  asset?: string | undefined;
  missingOnly?: boolean | undefined;
  json?: boolean | undefined;
}

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
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedViewPricesCommandOptions) => {
      await executeViewPricesCommand(options);
    });
}

/**
 * Execute the view prices command.
 */
async function executeViewPricesCommand(options: ExtendedViewPricesCommandOptions): Promise<void> {
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
    });

    // Initialize repository
    const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');

    const database = await initializeDatabase(false);
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
    console.log(formatPriceCoverageListForDisplay(result));
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

  output.success('view-prices', resultData);
  process.exit(0);
}
