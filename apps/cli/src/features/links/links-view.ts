// Command registration for links view subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { LinksViewCommandOptionsSchema } from '../shared/schemas.js';
import { buildViewMeta, type ViewCommandResult } from '../shared/view-utils.js';

import { LinksViewHandler } from './links-view-handler.js';
import type { LinkInfo, LinksViewParams, LinksViewResult } from './links-view-utils.js';
import { formatLinksListForDisplay } from './links-view-utils.js';

/**
 * Command options validated by Zod at CLI boundary
 */
export type LinksViewCommandOptions = z.infer<typeof LinksViewCommandOptionsSchema>;

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
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksViewCommand(rawOptions);
    });
}

/**
 * Execute the links view command.
 */
async function executeLinksViewCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = LinksViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
    output.error(
      'links-view',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Build params from validated options - no additional validation needed
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
      verbose: options.verbose ?? false,
      sinks: options.json
        ? { ui: false, structured: 'file' }
        : spinner
          ? { ui: true, structured: 'off' }
          : { ui: false, structured: 'stdout' },
    });

    // Initialize repositories
    const { initializeDatabase, closeDatabase, TransactionRepository } = await import('@exitbook/data');
    const { TransactionLinkRepository } = await import('@exitbook/accounting');

    const database = await initializeDatabase();
    const linkRepo = new TransactionLinkRepository(database);
    // Always initialize txRepo to fetch timestamps and amounts
    const txRepo = new TransactionRepository(database);

    const handler = new LinksViewHandler(linkRepo, txRepo);

    const result = await handler.execute(params);

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

  output.json('links-view', resultData);
}
