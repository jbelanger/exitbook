import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliValue,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliBrowseOptionsResult } from '../../../cli/options.js';
import {
  collapseEmptyExplorerToStatic,
  type BrowseSurfaceSpec,
  type ResolvedBrowsePresentation,
} from '../../../cli/presentation.js';
import { renderApp, type CommandRuntime } from '../../../runtime/command-runtime.js';
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

export interface PreparedAccountsBrowseCommand {
  params: AccountsBrowseParams;
  presentation: ResolvedBrowsePresentation;
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

export function prepareAccountsBrowseCommand({
  accountName,
  rawOptions,
  surfaceSpec,
}: ExecuteAccountsBrowseCommandInput): Result<PreparedAccountsBrowseCommand, CliFailure> {
  const parsedOptionsResult = parseCliBrowseOptionsResult(rawOptions, AccountsBrowseCommandOptionsSchema, surfaceSpec);
  if (parsedOptionsResult.isErr()) {
    return err(parsedOptionsResult.error);
  }

  const { presentation, options } = parsedOptionsResult.value;
  if (accountName && (options.accountId !== undefined || options.platform || options.type)) {
    return err(
      createCliFailure(
        new Error('Account name lookup cannot be combined with --account-id, --platform, or --type'),
        ExitCodes.INVALID_ARGS
      )
    );
  }

  return ok({
    params: {
      accountName,
      accountId: options.accountId,
      platformKey: options.platform,
      accountType: options.type,
      showSessions: options.showSessions,
      preselectInExplorer: accountName && presentation.mode === 'tui' ? true : undefined,
    },
    presentation,
  });
}

export async function executePreparedAccountsBrowseCommand(
  ctx: CommandRuntime,
  prepared: PreparedAccountsBrowseCommand
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const browsePresentation = yield* await buildAccountsBrowsePresentation(ctx, prepared.params);
    const finalPresentation = collapseEmptyExplorerToStatic(prepared.presentation, {
      hasNavigableItems: hasNavigableAccounts(browsePresentation.initialState),
      shouldCollapseEmptyExplorer: shouldCollapseAccountsExplorerWhenEmpty(prepared.params),
    });

    if (finalPresentation.mode === 'tui') {
      await ctx.closeDatabase();
    }

    return yield* buildAccountsBrowseCompletion(
      browsePresentation,
      finalPresentation.staticKind,
      finalPresentation.mode
    );
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

export async function runAccountsBrowseCommand(input: ExecuteAccountsBrowseCommandInput): Promise<void> {
  await runCliRuntimeCommand({
    command: input.commandId,
    format: detectCliOutputFormat(input.rawOptions),
    prepare: async () => prepareAccountsBrowseCommand(input),
    action: async (context) => executePreparedAccountsBrowseCommand(context.runtime, context.prepared),
  });
}
