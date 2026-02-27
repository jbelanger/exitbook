// Command registration for accounts view subcommand
import type { AccountType } from '@exitbook/core';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { displayCliError } from '../shared/cli-error.js';
import { renderApp, runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { AccountsViewCommandOptionsSchema } from '../shared/schemas.js';
import type { ViewCommandResult } from '../shared/view-utils.js';
import { buildViewMeta } from '../shared/view-utils.js';

import { AccountsViewHandler, type ViewAccountsParams } from './accounts-view-handler.js';
import { toAccountViewItem } from './accounts-view-utils.js';
import { AccountsViewApp, computeTypeCounts, createAccountsViewState } from './components/index.js';

/**
 * Command options (validated at CLI boundary).
 */
export type CommandOptions = z.infer<typeof AccountsViewCommandOptionsSchema>;

/**
 * Result data for view accounts command (JSON mode).
 */
type ViewAccountsCommandResult = ViewCommandResult<import('./components/accounts-view-state.js').AccountViewItem[]>;

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
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handler = new AccountsViewHandler(database);

      const result = await handler.execute({
        accountId: params.accountId,
        accountType: params.accountType,
        source: params.source,
        showSessions: params.showSessions,
      });

      if (result.isErr()) {
        console.error('\n⚠ Error:', result.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const { accounts, sessions } = result.value;
      const viewItems = accounts.map((account) => toAccountViewItem(account, sessions));
      const typeCounts = computeTypeCounts(viewItems);

      await ctx.closeDatabase();

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

      await renderApp((unmount) =>
        React.createElement(AccountsViewApp, {
          initialState,
          onQuit: unmount,
        })
      );
    });
  } catch (error) {
    displayCliError(
      'view-accounts',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

/**
 * Execute accounts view in JSON mode
 */
async function executeAccountsViewJSON(params: ViewAccountsParams): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handler = new AccountsViewHandler(database);

      const result = await handler.execute({
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

      // Transform to AccountViewItem format with nested sessions and children (same as TUI)
      const viewItems = accounts.map((account) => toAccountViewItem(account, sessions));

      const filters: Record<string, unknown> = {
        ...(params.accountId && { accountId: params.accountId }),
        ...(params.source && { source: params.source }),
        ...(params.accountType && { accountType: params.accountType }),
      };

      const resultData: ViewAccountsCommandResult = {
        data: viewItems,
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
