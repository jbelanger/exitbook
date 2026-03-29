import type { AccountType } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import { renderApp, runCommand, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { CliCommandError } from '../../shared/cli-command-error.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliPresentationOptions, withCliCommandErrorHandling } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import {
  explorerPresentationSpec,
  type CommandPresentationSpec,
} from '../../shared/presentation/command-presentation.js';
import type { PresentationMode } from '../../shared/presentation/presentation-mode.js';
import { toCliOutputFormat } from '../../shared/presentation/presentation-mode.js';
import { addPresentationOptions } from '../../shared/presentation/presentation-options.js';
import type { ViewCommandResult } from '../../shared/view-utils.js';
import { buildDefinedFilters, buildViewMeta } from '../../shared/view-utils.js';
import { buildCliAccountLifecycleService } from '../account-service.js';
import { toAccountViewItem } from '../account-view-projection.js';
import type { AccountViewItem } from '../accounts-view-model.js';
import { AccountQuery, type AccountQueryParams } from '../query/account-query.js';
import { buildAccountQueryPorts } from '../query/build-account-query-ports.js';
import { outputAccountsTextSnapshot } from '../view/accounts-text-renderer.js';
import { AccountsViewApp } from '../view/accounts-view-components.jsx';
import { computeTypeCounts, createAccountsViewState, type AccountsViewState } from '../view/accounts-view-state.js';

import { AccountsViewCommandOptionsSchema } from './accounts-option-schemas.js';

interface ViewAccountsParams extends Omit<AccountQueryParams, 'profileId'> {
  accountName?: string | undefined;
}

type ViewAccountsCommandResult = ViewCommandResult<AccountViewItem[]>;

export const AccountsViewPresentationSpec: CommandPresentationSpec = explorerPresentationSpec('accounts-view');

interface AccountsViewPresentation {
  initialState: AccountsViewState;
  jsonResult: ViewAccountsCommandResult;
}

export function registerAccountsViewCommand(accountsCommand: Command): void {
  const viewCommand = accountsCommand
    .command('view [name]')
    .alias('list')
    .description('View accounts')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts view                        # View all accounts
  $ exitbook accounts list                        # Alias for accounts view
  $ exitbook accounts view kraken-main            # View a specific account
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
    .option('--show-sessions', 'Include import session details for each account');

  addPresentationOptions(viewCommand, {
    textDescription: 'Force the static text snapshot instead of the Ink explorer',
    tuiDescription: 'Force the Ink explorer',
  });

  viewCommand.action(async (name: string | undefined, rawOptions: unknown) => {
    await executeViewAccountsCommand(name, rawOptions);
  });
}

async function executeViewAccountsCommand(accountName: string | undefined, rawOptions: unknown): Promise<void> {
  const { mode, options } = parseCliPresentationOptions(
    'accounts-view',
    rawOptions,
    AccountsViewCommandOptionsSchema,
    AccountsViewPresentationSpec
  );

  if (accountName && (options.accountId !== undefined || options.platform || options.type)) {
    displayCliError(
      'accounts-view',
      new Error('Account name lookup cannot be combined with --account-id, --platform, or --type'),
      ExitCodes.INVALID_ARGS,
      toCliOutputFormat(mode)
    );
  }

  const params: ViewAccountsParams = {
    accountName,
    accountId: options.accountId,
    platformKey: options.platform,
    accountType: options.type as AccountType | undefined,
    showSessions: options.showSessions,
  };

  await executeAccountsView(params, mode);
}

async function executeAccountsView(params: ViewAccountsParams, mode: PresentationMode): Promise<void> {
  await withCliCommandErrorHandling('view-accounts', toCliOutputFormat(mode), async () => {
    await runCommand(async (ctx) => {
      const presentation = await buildAccountsViewPresentation(ctx, params);

      if (mode === 'tui') {
        await ctx.closeDatabase();
      }

      await presentAccountsView(presentation, mode);
    });
  });
}

async function buildAccountsViewPresentation(
  ctx: CommandRuntime,
  params: ViewAccountsParams
): Promise<AccountsViewPresentation> {
  const database = await ctx.database();
  const profileResult = await resolveCommandProfile(ctx, database);
  if (profileResult.isErr()) {
    throw new CliCommandError(profileResult.error.message, ExitCodes.GENERAL_ERROR, { cause: profileResult.error });
  }

  const accountIdResult = await resolveAccountIdByName(database, profileResult.value.id, params.accountName);
  if (accountIdResult.isErr()) {
    throw new CliCommandError(accountIdResult.error.message, ExitCodes.NOT_FOUND, { cause: accountIdResult.error });
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
    throw new CliCommandError(result.error.message, ExitCodes.GENERAL_ERROR, { cause: result.error });
  }

  const { accounts, count, sessions } = result.value;
  const viewItems = accounts.map((account) => toAccountViewItem(account, sessions));
  const filters = {
    platformFilter: params.platformKey,
    typeFilter: params.accountType,
    showSessions: params.showSessions ?? false,
  };

  return {
    initialState: createAccountsViewState(viewItems, filters, count, computeTypeCounts(viewItems)),
    jsonResult: {
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
    },
  };
}

async function presentAccountsView(presentation: AccountsViewPresentation, mode: PresentationMode): Promise<void> {
  switch (mode) {
    case 'json':
      outputSuccess('view-accounts', presentation.jsonResult);
      return;
    case 'text':
      outputAccountsTextSnapshot(presentation.initialState);
      return;
    case 'tui':
      await renderApp((unmount) =>
        React.createElement(AccountsViewApp, {
          initialState: presentation.initialState,
          onQuit: unmount,
        })
      );
      return;
    case 'text-progress':
      throw new Error('Accounts view does not support text-progress presentation');
  }

  const exhaustiveCheck: never = mode;
  return exhaustiveCheck;
}

async function resolveAccountIdByName(
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
