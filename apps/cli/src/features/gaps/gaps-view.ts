// Command registration for gaps view subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { buildViewMeta, type ViewCommandResult } from '../shared/view-utils.js';

import { GapsViewHandler } from './gaps-view-handler.js';
import type { FeeGapAnalysis, GapCategory, GapsViewParams, GapsViewResult } from './gaps-view-utils.js';
import { formatGapsViewResult } from './gaps-view-utils.js';

/**
 * Extended command options (adds CLI-specific flags).
 */
export interface ExtendedGapsViewCommandOptions extends GapsViewParams {
  json?: boolean | undefined;
}

/**
 * Result data for gaps view command (JSON mode).
 */
type GapsViewCommandResult = ViewCommandResult<FeeGapAnalysis>;

/**
 * Register the gaps view subcommand.
 */
export function registerGapsViewCommand(gapsCommand: Command): void {
  gapsCommand
    .command('view')
    .description('View data quality gaps and issues by category')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook gaps view                      # View all data quality issues (defaults to fees)
  $ exitbook gaps view --category fees      # Audit fee field mappings
  $ exitbook gaps view --category prices    # Find transactions without prices
  $ exitbook gaps view --category links     # Find unlinked transfers
  $ exitbook gaps view --category validation # Find validation errors
  $ exitbook gaps view --json               # Output in JSON format for MCP

Common Usage:
  - Audit fee mappings to ensure fees are in proper fields
  - Identify transactions missing price data before cost basis calculation
  - Find potential transfer pairs that aren't linked
  - Detect data quality issues from import/processing

Gap Categories:
  fees        - Fees in movements vs. fee fields, missing prices on fees
  prices      - Transactions without price data (coming soon)
  links       - Potential links not yet detected (coming soon)
  validation  - Schema validation errors (coming soon)
`
    )
    .option('--category <category>', 'Filter by gap category (fees, prices, links, validation)', (value: string) => {
      if (!['fees', 'links', 'prices', 'validation'].includes(value)) {
        throw new Error('Invalid category. Must be one of: fees, prices, links, validation');
      }
      return value as GapCategory;
    })
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedGapsViewCommandOptions) => {
      await executeGapsViewCommand(options);
    });
}

/**
 * Execute the gaps view command.
 */
async function executeGapsViewCommand(options: ExtendedGapsViewCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Build params from options
    const params: GapsViewParams = {
      category: options.category,
    };

    const spinner = output.spinner();
    spinner?.start('Analyzing data quality gaps...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
    });

    // Initialize repositories
    const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');

    const database = await initializeDatabase();
    const txRepo = new TransactionRepository(database);

    const handler = new GapsViewHandler(txRepo);

    const result = await handler.execute(params);

    handler.destroy();
    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Failed to analyze gaps');
      output.error('gaps-view', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleGapsViewSuccess(output, result.value, params, spinner);
  } catch (error) {
    resetLoggerContext();
    output.error('gaps-view', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful gaps view.
 */
function handleGapsViewSuccess(
  output: OutputManager,
  result: GapsViewResult,
  params: GapsViewParams,
  spinner: ReturnType<OutputManager['spinner']>
): void {
  const issueCount = result.analysis.summary.total_issues;
  spinner?.stop(`Found ${issueCount} issue${issueCount === 1 ? '' : 's'}`);

  // Display text output
  if (output.isTextMode()) {
    console.log(formatGapsViewResult(result));
  }

  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.category) filters.category = params.category;

  const resultData: GapsViewCommandResult = {
    data: result.analysis,
    meta: buildViewMeta(issueCount, 0, issueCount, issueCount, filters),
  };

  output.success('gaps-view', resultData);
  process.exit(0);
}
