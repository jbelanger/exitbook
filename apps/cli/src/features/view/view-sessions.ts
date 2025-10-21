// Command registration for view sessions subcommand

import { configureLogger, resetLoggerContext } from '@exitbook/shared-logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.ts';
import { OutputManager } from '../shared/output.ts';

import { ViewSessionsHandler } from './view-sessions-handler.ts';
import type { SessionInfo, ViewSessionsParams, ViewSessionsResult } from './view-sessions-utils.ts';
import { formatSessionsListForDisplay } from './view-sessions-utils.ts';
import type { ViewCommandResult } from './view-utils.ts';
import { buildViewMeta } from './view-utils.ts';

/**
 * Extended command options (adds CLI-specific flags).
 */
export interface ExtendedViewSessionsCommandOptions extends ViewSessionsParams {
  json?: boolean | undefined;
}

/**
 * Result data for view sessions command (JSON mode).
 */
type ViewSessionsCommandResult = ViewCommandResult<SessionInfo[]>;

/**
 * Register the view sessions subcommand.
 */
export function registerViewSessionsCommand(viewCommand: Command): void {
  viewCommand
    .command('sessions')
    .description('View import sessions')
    .option('--source <name>', 'Filter by exchange or blockchain name')
    .option('--status <status>', 'Filter by status (started, completed, failed, cancelled)')
    .option('--limit <number>', 'Maximum number of sessions to return', parseInt)
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedViewSessionsCommandOptions) => {
      await executeViewSessionsCommand(options);
    });
}

/**
 * Execute the view sessions command.
 */
async function executeViewSessionsCommand(options: ExtendedViewSessionsCommandOptions): Promise<void> {
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Build params from options
    const params: ViewSessionsParams = {
      source: options.source,
      status: options.status,
      limit: options.limit || 50, // Default limit
    };

    const spinner = output.spinner();
    spinner?.start('Fetching sessions...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
    });

    // Initialize repository
    const { initializeDatabase, closeDatabase } = await import('@exitbook/data');
    const { DataSourceRepository } = await import('@exitbook/ingestion');

    const database = await initializeDatabase(false);
    const sessionRepo = new DataSourceRepository(database);

    const handler = new ViewSessionsHandler(sessionRepo);

    const result = await handler.execute(params);

    handler.destroy();
    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Failed to fetch sessions');
      output.error('view-sessions', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleViewSessionsSuccess(output, result.value, params, spinner);
  } catch (error) {
    resetLoggerContext();
    output.error('view-sessions', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful view sessions.
 */
function handleViewSessionsSuccess(
  output: OutputManager,
  result: ViewSessionsResult,
  params: ViewSessionsParams,
  spinner: ReturnType<OutputManager['spinner']>
): void {
  const { sessions, count } = result;

  spinner?.stop(`Found ${count} sessions`);

  // Display text output
  if (output.isTextMode()) {
    console.log(formatSessionsListForDisplay(sessions, count));
  }

  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.source) filters.source = params.source;
  if (params.status) filters.status = params.status;

  const resultData: ViewSessionsCommandResult = {
    data: sessions,
    meta: buildViewMeta(count, 0, params.limit || 50, count, filters),
  };

  output.success('view-sessions', resultData);
  process.exit(0);
}
