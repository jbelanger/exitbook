import type { Command } from 'commander';
import React from 'react';

import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliBrowseOptions, withCliCommandErrorHandling } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { collapseEmptyExplorerToStatic, type BrowseSurfaceSpec } from '../../shared/presentation/browse-surface.js';
import { toCliOutputFormat } from '../../shared/presentation/presentation-mode.js';
import { outputAccountStaticDetail, outputAccountsStaticList } from '../view/accounts-static-renderer.js';
import { AccountsViewApp } from '../view/accounts-view-components.jsx';

import {
  buildAccountsBrowsePresentation,
  hasNavigableAccounts,
  type AccountsBrowseParams,
  type AccountsBrowsePresentation,
} from './accounts-browse-support.js';
import { AccountsBrowseCommandOptionsSchema } from './accounts-option-schemas.js';

interface ExecuteAccountsBrowseCommandInput {
  accountName?: string | undefined;
  commandId: string;
  rawOptions: unknown;
  surfaceSpec: BrowseSurfaceSpec;
}

interface AccountsBrowseOptionDefinition {
  description: string;
  flags: string;
  parser?: ((value: string) => unknown) | undefined;
}

const ACCOUNTS_BROWSE_OPTION_DEFINITIONS: AccountsBrowseOptionDefinition[] = [
  {
    flags: '--account-id <number>',
    description: 'Filter by account ID',
    parser: parseInt,
  },
  {
    flags: '--platform <name>',
    description: 'Filter by exchange or blockchain platform',
  },
  {
    flags: '--type <type>',
    description: 'Filter by account type (blockchain, exchange-api, exchange-csv)',
  },
  {
    flags: '--show-sessions',
    description: 'Include import session details for each account',
  },
  {
    flags: '--json',
    description: 'Output JSON format',
  },
];

export function registerAccountsBrowseOptions(command: Command): Command {
  for (const option of ACCOUNTS_BROWSE_OPTION_DEFINITIONS) {
    if (option.parser) {
      command.option(option.flags, option.description, option.parser);
    } else {
      command.option(option.flags, option.description);
    }
  }

  return command;
}

export function buildAccountsBrowseOptionsHelpText(): string {
  const flagsColumnWidth =
    ACCOUNTS_BROWSE_OPTION_DEFINITIONS.reduce((maxWidth, option) => Math.max(maxWidth, option.flags.length), 0) + 2;

  return ACCOUNTS_BROWSE_OPTION_DEFINITIONS.map((option) => {
    return `  ${option.flags.padEnd(flagsColumnWidth)}${option.description}`;
  }).join('\n');
}

export async function executeAccountsBrowseCommand({
  accountName,
  commandId,
  rawOptions,
  surfaceSpec,
}: ExecuteAccountsBrowseCommandInput): Promise<void> {
  const { presentation, options } = parseCliBrowseOptions(
    commandId,
    rawOptions,
    AccountsBrowseCommandOptionsSchema,
    surfaceSpec
  );

  if (accountName && (options.accountId !== undefined || options.platform || options.type)) {
    displayCliError(
      commandId,
      new Error('Account name lookup cannot be combined with --account-id, --platform, or --type'),
      ExitCodes.INVALID_ARGS,
      toCliOutputFormat(presentation.mode)
    );
  }

  const params: AccountsBrowseParams = {
    accountName,
    accountId: options.accountId,
    platformKey: options.platform,
    accountType: options.type,
    showSessions: options.showSessions,
    selectorMode: accountName && presentation.mode === 'tui' ? 'preselect' : 'filter',
  };

  await withCliCommandErrorHandling(commandId, toCliOutputFormat(presentation.mode), async () => {
    await runCommand(async (ctx) => {
      const browsePresentation = await buildAccountsBrowsePresentation(ctx, params);
      const finalPresentation = collapseEmptyExplorerToStatic(presentation, {
        hasNavigableItems: hasNavigableAccounts(browsePresentation.initialState),
      });

      if (finalPresentation.mode === 'tui') {
        await ctx.closeDatabase();
      }

      await presentAccountsBrowseCommand(
        commandId,
        browsePresentation,
        finalPresentation.staticKind,
        finalPresentation.mode
      );
    });
  });
}

async function presentAccountsBrowseCommand(
  commandId: string,
  browsePresentation: AccountsBrowsePresentation,
  staticKind: 'list' | 'detail',
  mode: 'json' | 'static' | 'tui'
): Promise<void> {
  switch (mode) {
    case 'json':
      outputSuccess(
        commandId,
        staticKind === 'detail' ? getSelectedAccountJsonResult(browsePresentation) : browsePresentation.listJsonResult
      );
      return;
    case 'static':
      if (staticKind === 'detail') {
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

  const exhaustiveCheck: never = mode;
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
