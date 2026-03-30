import type { AccountType } from '@exitbook/core';
import type { Command } from 'commander';
import React from 'react';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliBrowseOptions, withCliCommandErrorHandling } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import {
  collapseEmptyExplorerToStatic,
  explorerDetailSurfaceSpec,
  explorerListSurfaceSpec,
  type BrowseSurfaceSpec,
  type ResolvedBrowsePresentation,
} from '../../shared/presentation/browse-surface.js';
import { toCliOutputFormat } from '../../shared/presentation/presentation-mode.js';
import { outputAccountStaticDetail, outputAccountsStaticList } from '../view/accounts-static-renderer.js';
import { AccountsViewApp } from '../view/accounts-view-components.jsx';

import {
  buildAccountsBrowsePresentation,
  hasNavigableAccounts,
  type AccountsBrowseParams,
  type AccountsBrowsePresentation,
} from './accounts-browse-support.js';
import { AccountsViewCommandOptionsSchema } from './accounts-option-schemas.js';

type ViewAccountsParams = AccountsBrowseParams;

const ACCOUNTS_VIEW_COMMAND_ID = 'accounts-view';

export function registerAccountsViewCommand(accountsCommand: Command): void {
  accountsCommand
    .command('view [name]')
    .alias('list')
    .description('View accounts')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook accounts view                        # View all accounts
  $ exitbook accounts list                        # Alias for accounts view
  $ exitbook accounts view kraken-main            # Open the explorer focused on a specific account
  $ exitbook accounts view --platform kraken      # View Kraken accounts
  $ exitbook accounts view --account-id 1         # View specific account by ID
  $ exitbook accounts view --type blockchain      # View blockchain accounts only
  $ exitbook accounts view --show-sessions        # Include session details
  $ exitbook accounts view --json                 # Output JSON

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
  const surfaceSpec = selectAccountsViewSurfaceSpec(accountName);
  const { presentation, options } = parseCliBrowseOptions(
    ACCOUNTS_VIEW_COMMAND_ID,
    rawOptions,
    AccountsViewCommandOptionsSchema,
    surfaceSpec
  );

  if (accountName && (options.accountId !== undefined || options.platform || options.type)) {
    displayCliError(
      ACCOUNTS_VIEW_COMMAND_ID,
      new Error('Account name lookup cannot be combined with --account-id, --platform, or --type'),
      ExitCodes.INVALID_ARGS,
      toCliOutputFormat(presentation.mode)
    );
  }

  const params: ViewAccountsParams = {
    accountName,
    accountId: options.accountId,
    platformKey: options.platform,
    accountType: options.type as AccountType | undefined,
    showSessions: options.showSessions,
    selectorMode: accountName && presentation.mode === 'tui' ? 'preselect' : 'filter',
  };

  await executeAccountsView(params, presentation);
}

function selectAccountsViewSurfaceSpec(accountName: string | undefined): BrowseSurfaceSpec {
  return accountName
    ? explorerDetailSurfaceSpec(ACCOUNTS_VIEW_COMMAND_ID)
    : explorerListSurfaceSpec(ACCOUNTS_VIEW_COMMAND_ID);
}

async function executeAccountsView(
  params: ViewAccountsParams,
  initialPresentation: ResolvedBrowsePresentation
): Promise<void> {
  await withCliCommandErrorHandling(ACCOUNTS_VIEW_COMMAND_ID, toCliOutputFormat(initialPresentation.mode), async () => {
    await runCommand(async (ctx) => {
      const browsePresentation = await buildAccountsBrowsePresentation(ctx, params);
      const finalPresentation = collapseEmptyExplorerToStatic(initialPresentation, {
        hasNavigableItems: hasNavigableAccounts(browsePresentation.initialState),
      });

      if (finalPresentation.mode === 'tui') {
        await ctx.closeDatabase();
      }

      await presentAccountsView(browsePresentation, finalPresentation);
    });
  });
}

async function presentAccountsView(
  browsePresentation: AccountsBrowsePresentation,
  presentation: ResolvedBrowsePresentation
): Promise<void> {
  switch (presentation.mode) {
    case 'json':
      outputSuccess(
        ACCOUNTS_VIEW_COMMAND_ID,
        presentation.staticKind === 'detail'
          ? getSelectedAccountJsonResult(browsePresentation)
          : browsePresentation.listJsonResult
      );
      return;
    case 'static':
      if (presentation.staticKind === 'detail') {
        outputAccountStaticDetail(getSelectedAccount(browsePresentation));
      } else {
        outputAccountsStaticList(browsePresentation.initialState);
      }
      return;
    case 'tui':
      await renderApp((unmount) =>
        React.createElement(AccountsViewApp, {
          initialState: browsePresentation.initialState,
          onQuit: unmount,
        })
      );
      return;
  }

  const exhaustiveCheck: never = presentation.mode;
  return exhaustiveCheck;
}

function getSelectedAccount(presentation: AccountsBrowsePresentation) {
  if (!presentation.selectedAccount) {
    throw new Error('Expected a selected account for detail presentation');
  }

  return presentation.selectedAccount;
}

function getSelectedAccountJsonResult(presentation: AccountsBrowsePresentation) {
  if (!presentation.detailJsonResult) {
    throw new Error('Expected a detail JSON result for detail presentation');
  }

  return presentation.detailJsonResult;
}
