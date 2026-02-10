import path from 'node:path';

// Command registration for view accounts subcommand
import type { AccountType } from '@exitbook/core';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { getDataDir } from '../shared/data-dir.js';
import { withDatabase } from '../shared/database-utils.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { AccountsViewCommandOptionsSchema } from '../shared/schemas.js';
import type { ViewCommandResult } from '../shared/view-utils.js';
import { buildViewMeta } from '../shared/view-utils.js';

import { AccountsViewApp, computeTypeCounts, createAccountsViewState } from './components/index.js';
import type { AccountInfo, SessionSummary, ViewAccountsParams } from './view-accounts-utils.js';
import { toAccountViewItem } from './view-accounts-utils.js';

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
    displayCliError(
      'accounts-view',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      'text'
    );
  }

  const options = parseResult.data;
  const isJsonMode = options.json ?? false;

  // Build params from options
  const params: ViewAccountsParams = {
    accountId: options.accountId,
    source: options.source,
    accountType: options.type as AccountType | undefined,
    showSessions: options.showSessions,
  };

  if (isJsonMode) {
    await executeAccountsViewJSON(params);
  } else {
    await executeAccountsViewTUI(params);
  }
}

/**
 * Execute accounts view in TUI mode
 */
async function executeAccountsViewTUI(params: ViewAccountsParams): Promise<void> {
  const { initializeDatabase, closeDatabase, AccountRepository, UserRepository, ImportSessionRepository } =
    await import('@exitbook/data');
  const { AccountService } = await import('@exitbook/ingestion');

  let database: Awaited<ReturnType<typeof initializeDatabase>> | undefined;
  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;
  let exitCode = 0;

  try {
    const dataDir = getDataDir();

    database = await initializeDatabase(path.join(dataDir, 'transactions.db'));
    const accountRepo = new AccountRepository(database);
    const sessionRepo = new ImportSessionRepository(database);
    const userRepo = new UserRepository(database);

    const accountService = new AccountService(accountRepo, sessionRepo, userRepo);

    const result = await accountService.viewAccounts({
      accountId: params.accountId,
      accountType: params.accountType,
      source: params.source,
      showSessions: params.showSessions,
    });

    if (result.isErr()) {
      console.error('\n⚠ Error:', result.error.message);
      exitCode = ExitCodes.GENERAL_ERROR;
      return;
    }

    const { accounts, sessions } = result.value;

    // Transform to view items
    const viewItems = accounts.map((account) => toAccountViewItem(account, sessions));

    // Compute type counts
    const typeCounts = computeTypeCounts(viewItems);

    // Close DB (read-only, no connection needed during browsing)
    await closeDatabase(database);
    database = undefined;

    // Create initial state
    const initialState = createAccountsViewState(
      viewItems,
      {
        sourceFilter: params.source,
        typeFilter: params.accountType,
        showSessions: params.showSessions ?? false,
      },
      viewItems.length,
      typeCounts
    );

    // Render TUI
    await new Promise<void>((resolve, reject) => {
      inkInstance = render(
        React.createElement(AccountsViewApp, {
          initialState,
          onQuit: () => {
            if (inkInstance) {
              inkInstance.unmount();
            }
          },
        })
      );

      inkInstance.waitUntilExit().then(resolve).catch(reject);
    });
  } catch (error) {
    console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));
    exitCode = ExitCodes.GENERAL_ERROR;
  } finally {
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        /* ignore unmount errors */
      }
    }
    if (database) {
      await closeDatabase(database);
    }

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }
}

/**
 * Execute accounts view in JSON mode
 */
async function executeAccountsViewJSON(params: ViewAccountsParams): Promise<void> {
  const { AccountRepository, UserRepository, ImportSessionRepository } = await import('@exitbook/data');
  const { AccountService } = await import('@exitbook/ingestion');

  try {
    await withDatabase(async (database) => {
      const accountRepo = new AccountRepository(database);
      const sessionRepo = new ImportSessionRepository(database);
      const userRepo = new UserRepository(database);

      const accountService = new AccountService(accountRepo, sessionRepo, userRepo);

      const result = await accountService.viewAccounts({
        accountId: params.accountId,
        accountType: params.accountType,
        source: params.source,
        showSessions: params.showSessions,
      });

      if (result.isErr()) {
        displayCliError('view-accounts', result.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const { accounts, count, sessions } = result.value;

      // Prepare result data for JSON mode
      const filters: Record<string, unknown> = {
        ...(params.accountId && { accountId: params.accountId }),
        ...(params.source && { source: params.source }),
        ...(params.accountType && { accountType: params.accountType }),
      };

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

      outputSuccess('view-accounts', resultData);
    });
  } catch (error) {
    displayCliError(
      'view-accounts',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}
