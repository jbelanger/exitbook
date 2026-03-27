import type { AccountType } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';
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
import { buildCliAccountLifecycleService } from '../account-service.js';
import { toAccountViewItem } from '../account-view-projection.js';
import type { AccountViewItem } from '../accounts-view-model.js';
import { AccountQuery, type AccountQueryParams } from '../query/account-query.js';
import { buildAccountQueryPorts } from '../query/build-account-query-ports.js';
import { AccountsViewApp } from '../view/accounts-view-components.jsx';
import { computeTypeCounts, createAccountsViewState } from '../view/accounts-view-state.js';

import { AccountsViewCommandOptionsSchema } from './accounts-option-schemas.js';

interface ViewAccountsParams extends Omit<AccountQueryParams, 'profileId'> {
  accountName?: string | undefined;
}

type ViewAccountsCommandResult = ViewCommandResult<AccountViewItem[]>;

export function registerAccountsViewCommand(accountsCommand: Command): void {
  accountsCommand
    .command('view [name]')
    .alias('list')
    .description('View named accounts')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts view                        # View all named accounts
  $ exitbook accounts list                        # Alias for accounts view
  $ exitbook accounts view kraken-main            # View a specific named account
  $ exitbook accounts view --platform kraken      # View Kraken accounts
  $ exitbook accounts view --account-id 1         # View specific account by ID
  $ exitbook accounts view --type blockchain      # View blockchain accounts only
  $ exitbook accounts view --show-sessions        # Include session details

Common Usage:
  - Monitor account verification status
  - Check last stored balance refresh timestamp
  - Review account activity and import history
  - Identify which platforms have been imported

Account Types:
  blockchain, exchange-api, exchange-csv
`
    )
    .option('--account-id <number>', 'Filter by account ID', parseInt)
    .option('--platform <name>', 'Filter by exchange or blockchain platform')
    .option('--type <type>', 'Filter by account type (blockchain, exchange-api, exchange-csv)')
    .option('--show-sessions', 'Include import session details for each account')
    .option('--json', 'Output results in JSON format')
    .action(async (name: string | undefined, rawOptions: unknown) => {
      await executeViewAccountsCommand(name, rawOptions);
    });
}

async function executeViewAccountsCommand(accountName: string | undefined, rawOptions: unknown): Promise<void> {
  const { format, options } = parseCliCommandOptions('accounts-view', rawOptions, AccountsViewCommandOptionsSchema);

  if (accountName && (options.accountId !== undefined || options.platform || options.type)) {
    displayCliError(
      'accounts-view',
      new Error('Named account lookup cannot be combined with --account-id, --platform, or --type'),
      ExitCodes.INVALID_ARGS,
      format
    );
  }

  const params: ViewAccountsParams = {
    accountName,
    accountId: options.accountId,
    platformKey: options.platform,
    accountType: options.type as AccountType | undefined,
    showSessions: options.showSessions,
  };

  if (format === 'json') {
    await executeAccountsViewJSON(params);
  } else {
    await executeAccountsViewTUI(params);
  }
}

async function executeAccountsViewTUI(params: ViewAccountsParams): Promise<void> {
  await withCliCommandErrorHandling('view-accounts', 'text', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        console.error('\n⚠ Error:', profileResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const accountIdResult = await resolveNamedAccountId(database, profileResult.value.id, params.accountName);
      if (accountIdResult.isErr()) {
        console.error('\n⚠ Error:', accountIdResult.error.message);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const accountQuery = new AccountQuery(buildAccountQueryPorts(database));

      const result = await accountQuery.list({
        profileId: profileResult.value.id,
        accountId: accountIdResult.value ?? params.accountId,
        accountType: params.accountType,
        platformKey: params.platformKey,
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
          platformFilter: params.platformKey,
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

async function executeAccountsViewJSON(params: ViewAccountsParams): Promise<void> {
  await withCliCommandErrorHandling('view-accounts', 'json', async () => {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const profileResult = await resolveCommandProfile(ctx, database);
      if (profileResult.isErr()) {
        displayCliError('view-accounts', profileResult.error, ExitCodes.GENERAL_ERROR, 'json');
        return;
      }

      const accountIdResult = await resolveNamedAccountId(database, profileResult.value.id, params.accountName);
      if (accountIdResult.isErr()) {
        displayCliError('view-accounts', accountIdResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const accountQuery = new AccountQuery(buildAccountQueryPorts(database));

      const result = await accountQuery.list({
        profileId: profileResult.value.id,
        accountId: accountIdResult.value ?? params.accountId,
        accountType: params.accountType,
        platformKey: params.platformKey,
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
            accountName: params.accountName,
            accountId: accountIdResult.value ?? params.accountId,
            platform: params.platformKey,
            accountType: params.accountType,
          })
        ),
      };

      outputSuccess('view-accounts', resultData);
    });
  });
}

async function resolveNamedAccountId(
  database: DataSession,
  profileId: number,
  accountName?: string
): Promise<Result<number | undefined, Error>> {
  if (!accountName) {
    return ok(undefined);
  }

  const accountResult = await buildCliAccountLifecycleService(database).getByName(profileId, accountName);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }
  if (!accountResult.value) {
    return err(new Error(`Account '${accountName.trim().toLowerCase()}' not found`));
  }

  return ok(accountResult.value.id);
}
