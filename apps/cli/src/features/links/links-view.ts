// Command registration for links view subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';
import { buildViewMeta, type ViewCommandResult } from '../shared/view-utils.ts';

import { LinksViewHandler } from './links-view-handler.ts';
import type { LinkInfo, LinksViewParams, LinksViewResult } from './links-view-utils.ts';
import { formatLinksListForDisplay } from './links-view-utils.ts';

/**
 * Extended command options (adds CLI-specific flags).
 */
export interface ExtendedLinksViewCommandOptions extends LinksViewParams {
  json?: boolean | undefined;
}

/**
 * Result data for links view command (JSON mode).
 */
type LinksViewCommandResult = ViewCommandResult<LinkInfo[]>;

/**
 * Register the links view subcommand.
 */
export function registerLinksViewCommand(linksCommand: Command): void {
  linksCommand
    .command('view')
    .description('View transaction links with confidence scores')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links view                                # View all transaction links
  $ exitbook links view --status suggested             # View AI-suggested links
  $ exitbook links view --status confirmed             # View user-confirmed links
  $ exitbook links view --min-confidence 0.8           # View high-confidence links only
  $ exitbook links view --min-confidence 0.3 --max-confidence 0.7  # Medium confidence range
  $ exitbook links view --verbose                      # Include full transaction details
  $ exitbook links view --limit 20                     # View latest 20 links

Common Usage:
  - Review deposit/withdrawal matching between exchanges and blockchains
  - Validate high-confidence automated matches before confirming
  - Investigate low-confidence matches that need manual review
  - Audit confirmed links for accuracy

Status Values:
  suggested   - Automatically detected by the system
  confirmed   - User-verified as correct
  rejected    - User-verified as incorrect

Confidence Scores:
  1.0  - Exact match (timestamp + amount + asset)
  0.8  - Very likely match (close timestamp, matching amount)
  0.5  - Possible match (similar timing, matching asset)
  <0.3 - Low confidence, needs manual review
`
    )
    .option('--status <status>', 'Filter by status (suggested, confirmed, rejected)')
    .option('--min-confidence <score>', 'Filter by minimum confidence score (0-1)', parseFloat)
    .option('--max-confidence <score>', 'Filter by maximum confidence score (0-1)', parseFloat)
    .option('--limit <number>', 'Maximum number of links to return', parseInt)
    .option('--verbose', 'Include full transaction details (asset, amount, addresses)')
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedLinksViewCommandOptions) => {
      await executeLinksViewCommand(options);
    });
}

/**
 * Execute the links view command.
 */
async function executeLinksViewCommand(options: ExtendedLinksViewCommandOptions): Promise<void> {
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
    const params: LinksViewParams = {
      status: options.status,
      minConfidence: options.minConfidence,
      maxConfidence: options.maxConfidence,
      limit: options.limit ?? 50, // Default limit
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

    const database = await initializeDatabase();
    const linkRepo = new TransactionLinkRepository(database);
    const txRepo = options.verbose ? new TransactionRepository(database) : undefined;

    const handler = new LinksViewHandler(linkRepo, txRepo);

    const result = await handler.execute(params);

    handler.destroy();
    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Failed to fetch links');
      output.error('links-view', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleLinksViewSuccess(output, result.value, params, spinner);
  } catch (error) {
    resetLoggerContext();
    output.error('links-view', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful links view.
 */
function handleLinksViewSuccess(
  output: OutputManager,
  result: LinksViewResult,
  params: LinksViewParams,
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

  const resultData: LinksViewCommandResult = {
    data: links,
    meta: buildViewMeta(count, 0, params.limit || 50, count, filters),
  };

  output.success('links-view', resultData);
  process.exit(0);
}
