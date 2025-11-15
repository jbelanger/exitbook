// Command registration for view accounts subcommand

import type { AccountType } from '@exitbook/core';
import { configureLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';

import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import type { ViewCommandResult } from '../shared/view-utils.js';
import { buildViewMeta } from '../shared/view-utils.js';

import { ViewAccountsHandler } from './view-accounts-handler.js';
import type { AccountInfo, ViewAccountsParams, ViewAccountsResult } from './view-accounts-utils.js';
import { formatAccountsListForDisplay } from './view-accounts-utils.js';

/**
 * Extended command options (adds CLI-specific flags).
 */
export interface ExtendedViewAccountsCommandOptions extends ViewAccountsParams {
  json?: boolean | undefined;
  type?: string | undefined;
}

/**
 * Result data for view accounts command (JSON mode).
 */
type ViewAccountsCommandResult = ViewCommandResult<AccountInfo[]>;

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
    .option('--json', 'Output results in JSON format (for AI/MCP tools)')
    .action(async (options: ExtendedViewAccountsCommandOptions) => {
      await executeViewAccountsCommand(options);
    });
}

/**
 * Execute the view accounts command.
 */
async function executeViewAccountsCommand(options: ExtendedViewAccountsCommandOptions): Promise<void> {
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
    spinner?.start('Fetching accounts...');

    configureLogger({
      mode: options.json ? 'json' : 'text',
      spinner: spinner || undefined,
      verbose: false,
    });

    // Initialize repositories
    const { initializeDatabase, closeDatabase, AccountRepository, UserRepository } = await import('@exitbook/data');
    const { DataSourceRepository } = await import('@exitbook/ingestion');

    const database = await initializeDatabase();
    const accountRepo = new AccountRepository(database);
    const dataSourceRepo = new DataSourceRepository(database);
    const userRepo = new UserRepository(database);

    const handler = new ViewAccountsHandler(accountRepo, dataSourceRepo, userRepo);

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
  spinner: ReturnType<OutputManager['spinner']>
): void {
  const { accounts, count, sessions } = result;

  spinner?.stop(`Found ${count} accounts`);

  // Display text output
  if (output.isTextMode()) {
    console.log(formatAccountsListForDisplay(accounts, count, sessions));
  }

  // Prepare result data for JSON mode
  const filters: Record<string, unknown> = {};
  if (params.accountId) filters.accountId = params.accountId;
  if (params.source) filters.source = params.source;
  if (params.accountType) filters.accountType = params.accountType;

  const resultData: ViewAccountsCommandResult = {
    data: accounts,
    meta: buildViewMeta(count, 0, count, count, filters),
  };

  output.success('view-accounts', resultData);
  process.exit(0);
}
