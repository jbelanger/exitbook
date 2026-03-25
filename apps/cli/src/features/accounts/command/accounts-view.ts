// Command registration for accounts view subcommand
import type { AccountType } from '@exitbook/core';
import type { Command } from 'commander';
import React from 'react';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions, withCliCommandErrorHandling } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import type { ViewCommandResult } from '../../shared/view-utils.js';
import { buildDefinedFilters, buildViewMeta } from '../../shared/view-utils.js';
import { toAccountViewItem } from '../account-view-projection.js';
import type { AccountViewItem } from '../accounts-view-model.js';
import { AccountQuery, type AccountQueryParams } from '../query/account-query.js';
import { buildAccountQueryPorts } from '../query/build-account-query-ports.js';
import { AccountsViewApp } from '../view/accounts-view-components.jsx';
import { computeTypeCounts, createAccountsViewState } from '../view/accounts-view-state.js';

import { AccountsViewCommandOptionsSchema } from './accounts-option-schemas.js';

interface ViewAccountsParams extends Omit<AccountQueryParams, 'profileId'> {
  profile?: string | undefined;
}

/**
 * Result data for view accounts command (JSON mode).
 */
type ViewAccountsCommandResult = ViewCommandResult<AccountViewItem[]>;

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
  - Check last stored balance refresh timestamp
  - Review account activity and import history
  - Identify which sources have been imported

Account Types:
  blockchain, exchange-api, exchange-csv
`
    )
    .option('--account-id <number>', 'Filter by account ID', parseInt)
    .option('--profile <name>', 'Use a specific profile instead of the active profile')
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
  const { format, options } = parseCliCommandOptions('accounts-view', rawOptions, AccountsViewCommandOptionsSchema);
  const params: ViewAccountsParams = {
    accountId: options.accountId,
    profile: options.profile,
    source: options.source,
    accountType: options.type as AccountType | undefined,
    showSessions: options.showSessions,
  };

  if (format === 'json') {
    await executeAccountsViewJSON(params);
  } else {
    await executeAccountsViewTUI(params);
  }
}

/**
 * Execute accounts view in TUI mode
 */
async function executeAccountsViewTUI(params: ViewAccountsParams): Promise<void> {
  await withCliCommandErrorHandling('view-accounts', 'text', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database, params.profile);
      if (profileResult.isErr()) {
        console.error('\n⚠ Error:', profileResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const accountQuery = new AccountQuery(buildAccountQueryPorts(database));

      const result = await accountQuery.list({
        profileId: profileResult.value.id,
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
  });
}

/**
 * Execute accounts view in JSON mode
 */
async function executeAccountsViewJSON(params: ViewAccountsParams): Promise<void> {
  await withCliCommandErrorHandling('view-accounts', 'json', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database, params.profile);
      if (profileResult.isErr()) {
        displayCliError('view-accounts', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const accountQuery = new AccountQuery(buildAccountQueryPorts(database));

      const result = await accountQuery.list({
        profileId: profileResult.value.id,
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
      const viewItems = accounts.map((account) => toAccountViewItem(account, sessions));

      const resultData: ViewAccountsCommandResult = {
        data: viewItems,
        meta: buildViewMeta(
          count,
          0,
          count,
          count,
          buildDefinedFilters({
            accountId: params.accountId,
            profile: params.profile,
            source: params.source,
            accountType: params.accountType,
          })
        ),
      };

      outputSuccess('view-accounts', resultData);
    });
  });
}
