// Command registration for view accounts subcommand

import type { AccountType } from '@exitbook/core';
import type { Spinner } from '@exitbook/logger';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import type { z } from 'zod';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { AccountsViewCommandOptionsSchema } from '../shared/schemas.js';
import type { ViewCommandResult } from '../shared/view-utils.js';
import { buildViewMeta } from '../shared/view-utils.js';

import { ViewAccountsHandler } from './view-accounts-handler.js';
import type { AccountInfo, SessionSummary, ViewAccountsParams, ViewAccountsResult } from './view-accounts-utils.js';
import { formatAccountsListForDisplay } from './view-accounts-utils.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof AccountsViewCommandOptionsSchema>;

/**
 * Result data for view accounts command (JSON mode).
 */
interface ViewAccountsCommandResultData {
  accounts: AccountInfo[];
  sessions?: Record<string, SessionSummary[]> | undefined;
}

type ViewAccountsCommandResult = ViewCommandResult<ViewAccountsCommandResultData>;

/**
 * Register the accounts view subcommand.
 */
export function registerAccountsViewCommand(accountsCommand: Command): void {
  accountsCommand
    .command('view')
    .description('View accounts')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts view                        # View all accounts
  $ exitbook accounts view --source kraken        # View Kraken accounts
  $ exitbook accounts view --account-id 1         # View specific account
  $ exitbook accounts view --type blockchain      # View blockchain accounts only
  $ exitbook accounts view --show-sessions        # Include session details

Common Usage:
  - Monitor account verification status
  - Check last balance verification timestamp
  - Review account activity and import history
  - Identify which sources have been imported

Account Types:
  blockchain, exchange-api, exchange-csv
`
    )
    .option('--account-id <number>', 'Filter by account ID', parseInt)
    .option('--source <name>', 'Filter by exchange or blockchain name')
    .option('--type <type>', 'Filter by account type (blockchain, exchange-api, exchange-csv)')
    .option('--show-sessions', 'Include import session details for each account')
    .option('--json', 'Output results in JSON format')
    .action(async (rawOptions: unknown) => {
      await executeViewAccountsCommand(rawOptions);
    });
}

/**
 * Execute the view accounts command.
 */
async function executeViewAccountsCommand(rawOptions: unknown): Promise<void> {
  // Validate options at CLI boundary
  const parseResult = AccountsViewCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const output = new OutputManager('text');
    output.error(
      'view-accounts',
      new Error(parseResult.error.issues[0]?.message || 'Invalid options'),
      ExitCodes.INVALID_ARGS
    );
    return;
  }

  const options = parseResult.data;
  const output = new OutputManager(options.json ? 'json' : 'text');

  try {
    // Build params from options
    const params: ViewAccountsParams = {
      accountId: options.accountId,
      source: options.source,
      accountType: options.type as AccountType | undefined,
      showSessions: options.showSessions,
    };

    const spinner = output.spinner();
    output.intro('Viewing accounts...');
    spinner?.start('Fetching accounts...');

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

    // Initialize repositories and service
    const { initializeDatabase, closeDatabase, AccountRepository, UserRepository, ImportSessionRepository } =
      await import('@exitbook/data');
    const { AccountService } = await import('@exitbook/ingestion');

    const database = await initializeDatabase();
    const accountRepo = new AccountRepository(database);
    const sessionRepo = new ImportSessionRepository(database);
    const userRepo = new UserRepository(database);

    const accountService = new AccountService(accountRepo, sessionRepo, userRepo);
    const handler = new ViewAccountsHandler(accountService);

    const result = await handler.execute(params);

    handler.destroy();
    await closeDatabase(database);

    resetLoggerContext();

    if (result.isErr()) {
      spinner?.stop('Failed to fetch accounts');
      output.error('view-accounts', result.error, ExitCodes.GENERAL_ERROR);
      return;
    }

    handleViewAccountsSuccess(output, result.value, params, spinner);
  } catch (error) {
    resetLoggerContext();
    output.error('view-accounts', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

/**
 * Handle successful view accounts.
 */
function handleViewAccountsSuccess(
  output: OutputManager,
  result: ViewAccountsResult,
  params: ViewAccountsParams,
  spinner: Spinner | undefined
): void {
  const { accounts, count, sessions } = result;

  spinner?.stop();

  // Display text output
  if (output.isTextMode()) {
    formatAccountsListForDisplay(output, accounts, sessions);
    output.outro(`Found ${count} accounts.`);
    return;
  }

  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.accountId) filters.accountId = params.accountId;
  if (params.source) filters.source = params.source;
  if (params.accountType) filters.accountType = params.accountType;

  // Convert sessions Map to Record for JSON serialization (if requested)
  const sessionsRecord: Record<string, SessionSummary[]> | undefined = sessions
    ? Object.fromEntries(Array.from(sessions.entries()).map(([key, value]) => [key.toString(), value]))
    : undefined;

  const data: ViewAccountsCommandResultData = {
    accounts,
    sessions: params.showSessions ? sessionsRecord : undefined,
  };

  const resultData: ViewAccountsCommandResult = {
    data,
    meta: buildViewMeta(count, 0, count, count, filters),
  };

  output.json('view-accounts', resultData);
}
