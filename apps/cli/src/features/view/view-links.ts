// Command registration for view links subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import { ViewLinksHandler } from './view-links-handler.ts';
import type { LinkInfo, ViewLinksParams, ViewLinksResult } from './view-links-utils.ts';
import { formatLinksListForDisplay } from './view-links-utils.ts';
import type { ViewCommandResult } from './view-utils.ts';
import { buildViewMeta } from './view-utils.ts';

/**
 * Extended command options (adds CLI-specific flags).
 */
export interface ExtendedViewLinksCommandOptions extends ViewLinksParams {
  json?: boolean | undefined;
}

/**
 * Result data for view links command (JSON mode).
 */
type ViewLinksCommandResult = ViewCommandResult<LinkInfo[]>;

/**
 * Register the view links subcommand.
 */
export function registerViewLinksCommand(viewCommand: Command): void {
  viewCommand
    .command('links')
    .description('View transaction links with confidence scores')
    .option('--status <status>', 'Filter by status (suggested, confirmed, rejected)')
    .option('--min-confidence <score>', 'Filter by minimum confidence score (0-1)', parseFloat)
    .option('--max-confidence <score>', 'Filter by maximum confidence score (0-1)', parseFloat)
    .option('--limit <number>', 'Maximum number of links to return', parseInt)
    .option('--verbose', 'Include full transaction details (asset, amount, addresses)')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedViewLinksCommandOptions) => {
      await executeViewLinksCommand(options);
    });
}

/**
 * Execute the view links command.
 */
async function executeViewLinksCommand(options: ExtendedViewLinksCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Validate status option if provided
    if (options.status && !['confirmed', 'rejected', 'suggested'].includes(options.status)) {
      throw new Error('Invalid status. Must be one of: suggested, confirmed, rejected');
    }

    // Validate confidence ranges
    if (options.minConfidence !== undefined && (options.minConfidence < 0 || options.minConfidence > 1)) {
      throw new Error('min-confidence must be between 0 and 1');
    }
    if (options.maxConfidence !== undefined && (options.maxConfidence < 0 || options.maxConfidence > 1)) {
      throw new Error('max-confidence must be between 0 and 1');
    }
    if (
      options.minConfidence !== undefined &&
      options.maxConfidence !== undefined &&
      options.minConfidence > options.maxConfidence
    ) {
      throw new Error('min-confidence must be less than or equal to max-confidence');
    }

    // Build params from options
    const params: ViewLinksParams = {
      status: options.status,
      minConfidence: options.minConfidence,
      maxConfidence: options.maxConfidence,
      limit: options.limit || 50, // Default limit
      verbose: options.verbose,
    };

    const spinner = output.spinner();
    spinner?.start('Fetching transaction links...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
    });

    // Initialize repositories
    const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');
    const { TransactionLinkRepository } = await import('@exitbook/accounting');

    const database = await initializeDatabase(false);
    const linkRepo = new TransactionLinkRepository(database);
    const txRepo = options.verbose ? new TransactionRepository(database) : undefined;

    const handler = new ViewLinksHandler(linkRepo, txRepo);

    const result = await handler.execute(params);

    handler.destroy();
    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Failed to fetch links');
      output.error('view-links', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleViewLinksSuccess(output, result.value, params, spinner);
  } catch (error) {
    resetLoggerContext();
    output.error('view-links', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful view links.
 */
function handleViewLinksSuccess(
  output: OutputManager,
  result: ViewLinksResult,
  params: ViewLinksParams,
  spinner: ReturnType<OutputManager['spinner']>
): void {
  const { links, count } = result;

  spinner?.stop(`Found ${count} links`);

  // Display text output
  if (output.isTextMode()) {
    console.log(formatLinksListForDisplay(links, count));
  }

  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.status) filters.status = params.status;
  if (params.minConfidence !== undefined) filters.min_confidence = params.minConfidence;
  if (params.maxConfidence !== undefined) filters.max_confidence = params.maxConfidence;

  const resultData: ViewLinksCommandResult = {
    data: links,
    meta: buildViewMeta(count, 0, params.limit || 50, count, filters),
  };

  output.success('view-links', resultData);
  process.exit(0);
}
