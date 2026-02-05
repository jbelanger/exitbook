// Command registration for gaps view subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { GapsViewCommandOptionsSchema } from '../shared/schemas.js';
import { buildViewMeta, type ViewCommandResult } from '../shared/view-utils.js';

import type { FeeGapAnalysis, GapsViewParams, GapsViewResult, LinkGapAnalysis } from './gaps-view-utils.js';
import { analyzeFeeGaps, analyzeLinkGaps, formatGapsViewResult } from './gaps-view-utils.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof GapsViewCommandOptionsSchema>;

/**
 * Result data for gaps view command (JSON mode).
 */
type GapsViewCommandResult = ViewCommandResult<FeeGapAnalysis | LinkGapAnalysis>;

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
  $ exitbook gaps view --category links     # Find blockchain/exchange movements missing confirmed counterparties
  $ exitbook gaps view --category validation # Find validation errors
  $ exitbook gaps view --json               # Output in JSON format for MCP

Common Usage:
  - Audit fee mappings to ensure fees are in proper fields
  - Identify transactions missing price data before cost basis calculation
  - Find transfer pairs that aren't linked, including unexplained withdrawals
  - Detect data quality issues from import/processing

Gap Categories:
  fees        - Fees in movements vs. fee fields, missing prices on fees
  prices      - Transactions without price data (coming soon)
  links       - Blockchain/exchange inflows/outflows missing confirmed counterparties
  validation  - Schema validation errors (coming soon)
`
    )
    .option('--category <category>', 'Filter by gap category (fees, prices, links, validation)')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeGapsViewCommand(rawOptions);
    });
}

/**
 * Execute the gaps view command.
 */
async function executeGapsViewCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = GapsViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
    output.error(
      'gaps-view',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
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
    const txRepo = new TransactionRepository(database);
    const linkRepo = new TransactionLinkRepository(database);

    // Execute gaps analysis
    let result: GapsViewResult;
    try {
      // Default to fees category if not specified
      const category: string = (params.category ?? 'fees') as string;

      // Fetch all transactions
      const transactionsResult = await txRepo.getTransactions();

      if (transactionsResult.isErr()) {
        await closeDatabase(database);
        resetLoggerContext();
        spinner?.stop('Failed to fetch transactions');
        output.error('gaps-view', transactionsResult.error, ExitCodes.GENERAL_ERROR);
        return;
      }

      const transactions = transactionsResult.value;

      // Analyze based on category
      switch (category) {
        case 'fees': {
          const analysis = analyzeFeeGaps(transactions);
          result = {
            category: 'fees',
            analysis,
          };
          break;
        }
        case 'prices': {
          await closeDatabase(database);
          resetLoggerContext();
          spinner?.stop('Failed to analyze gaps');
          output.error('gaps-view', new Error('Price gap analysis not yet implemented'), ExitCodes.GENERAL_ERROR);
          return;
        }
        case 'links': {
          const linksResult = await linkRepo.findAll();

          if (linksResult.isErr()) {
            await closeDatabase(database);
            resetLoggerContext();
            spinner?.stop('Failed to fetch links');
            output.error('gaps-view', linksResult.error, ExitCodes.GENERAL_ERROR);
            return;
          }

          const analysis = analyzeLinkGaps(transactions, linksResult.value);
          result = {
            category: 'links',
            analysis,
          };
          break;
        }
        case 'validation': {
          await closeDatabase(database);
          resetLoggerContext();
          spinner?.stop('Failed to analyze gaps');
          output.error('gaps-view', new Error('Validation gap analysis not yet implemented'), ExitCodes.GENERAL_ERROR);
          return;
        }
        default: {
          await closeDatabase(database);
          resetLoggerContext();
          spinner?.stop('Failed to analyze gaps');
          output.error('gaps-view', new Error(`Unknown gap category: ${category}`), ExitCodes.GENERAL_ERROR);
          return;
        }
      }
    } catch (error) {
      await closeDatabase(database);
      resetLoggerContext();
      spinner?.stop('Failed to analyze gaps');
      output.error('gaps-view', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
      return;
    }

    await closeDatabase(database);

    resetLoggerContext();

    handleGapsViewSuccess(output, result, params, spinner);
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

  output.json('gaps-view', resultData);
}
