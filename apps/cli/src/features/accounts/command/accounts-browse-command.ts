import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import { renderApp } from '../../../runtime/command-runtime.js';
import { captureCliRuntimeResult, runCliCommandBoundary } from '../../shared/cli-boundary.js';
import {
  cliErr,
  jsonSuccess,
  textSuccess,
  toCliValue,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../shared/cli-contract.js';
import { detectCliOutputFormat } from '../../shared/cli-output-format.js';
import { parseCliBrowseOptionsResult } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { collapseEmptyExplorerToStatic, type BrowseSurfaceSpec } from '../../shared/presentation/browse-surface.js';
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
}: ExecuteAccountsBrowseCommandInput): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const { presentation, options } = yield* parseCliBrowseOptionsResult(
      rawOptions,
      AccountsBrowseCommandOptionsSchema,
      surfaceSpec
    );

    if (accountName && (options.accountId !== undefined || options.platform || options.type)) {
      return yield* cliErr(
        'Account name lookup cannot be combined with --account-id, --platform, or --type',
        ExitCodes.INVALID_ARGS
      );
    }

    const params: AccountsBrowseParams = {
      accountName,
      accountId: options.accountId,
      platformKey: options.platform,
      accountType: options.type,
      showSessions: options.showSessions,
      preselectInExplorer: accountName && presentation.mode === 'tui' ? true : undefined,
    };

    return yield* await captureCliRuntimeResult({
      command: commandId,
      action: async (ctx) =>
        resultDoAsync(async function* () {
          const browsePresentation = yield* await buildAccountsBrowsePresentation(ctx, params);
          const finalPresentation = collapseEmptyExplorerToStatic(presentation, {
            hasNavigableItems: hasNavigableAccounts(browsePresentation.initialState),
            shouldCollapseEmptyExplorer: shouldCollapseAccountsExplorerWhenEmpty(params),
          });

          if (finalPresentation.mode === 'tui') {
            await ctx.closeDatabase();
          }

          return yield* buildAccountsBrowseCompletion(
            browsePresentation,
            finalPresentation.staticKind,
            finalPresentation.mode
          );
        }),
    });
  });
}

function buildAccountsBrowseCompletion(
  browsePresentation: AccountsBrowsePresentation,
  staticKind: 'list' | 'detail',
  mode: 'json' | 'static' | 'tui'
): Result<CliCompletion, CliFailure> {
  switch (mode) {
    case 'json': {
      if (staticKind === 'detail') {
        const selectedDetailResult = toCliValue(
          browsePresentation.detailJsonResult,
          new Error('Expected a detail JSON result for detail presentation'),
          ExitCodes.GENERAL_ERROR
        );

        if (selectedDetailResult.isErr()) {
          return err(selectedDetailResult.error);
        }

        return ok(jsonSuccess(selectedDetailResult.value));
      }

      return ok(jsonSuccess(browsePresentation.listJsonResult));
    }
    case 'static': {
      if (staticKind === 'detail') {
        const selectedAccountResult = toCliValue(
          browsePresentation.selectedAccount,
          new Error('Expected a selected account for detail presentation'),
          ExitCodes.GENERAL_ERROR
        );

        if (selectedAccountResult.isErr()) {
          return err(selectedAccountResult.error);
        }

        return ok(
          textSuccess(() => {
            outputAccountStaticDetail(selectedAccountResult.value);
          })
        );
      }

      return ok(
        textSuccess(() => {
          outputAccountsStaticList(browsePresentation.initialState);
        })
      );
    }
    case 'tui':
      return ok(
        textSuccess(async () =>
          renderApp((unmount) =>
            React.createElement(AccountsViewApp, {
              initialState: browsePresentation.initialState,
              onQuit: unmount,
            })
          )
        )
      );
  }

  const exhaustiveCheck: never = mode;
  return exhaustiveCheck;
}

function shouldCollapseAccountsExplorerWhenEmpty(params: AccountsBrowseParams): boolean {
  return (
    params.accountName === undefined &&
    params.accountId === undefined &&
    params.platformKey === undefined &&
    params.accountType === undefined
  );
}

export function runAccountsBrowseCommandBoundary(
  command: string,
  rawOptions: unknown,
  action: () => Promise<CliCommandResult>
): Promise<void> {
  return runCliCommandBoundary({
    command,
    format: detectCliOutputFormat(rawOptions),
    action,
  });
}
