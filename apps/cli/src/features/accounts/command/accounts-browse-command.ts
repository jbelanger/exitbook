import { err, ok, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import {
  executePreparedBrowseCommand,
  prepareBrowseCommand,
  runPreparedBrowseRuntimeCommand,
  type PreparedBrowseCommand,
} from '../../../cli/browse-command-scaffold.js';
import { buildBrowseJsonOrStaticCompletion } from '../../../cli/browse-output.js';
import {
  createCliFailure,
  ExitCodes,
  textSuccess,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import {
  buildCliOptionsHelpText,
  parseCliBrowseOptionsResult,
  registerCliOptionDefinitions,
  type CliOptionDefinition,
} from '../../../cli/options.js';
import { type BrowseSurfaceSpec } from '../../../cli/presentation.js';
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
  accountSelector?: string | undefined;
  commandId: string;
  rawOptions: unknown;
  surfaceSpec: BrowseSurfaceSpec;
}

export type PreparedAccountsBrowseCommand = PreparedBrowseCommand<AccountsBrowseParams>;

const ACCOUNTS_BROWSE_OPTION_DEFINITIONS: CliOptionDefinition[] = [
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
  return registerCliOptionDefinitions(command, ACCOUNTS_BROWSE_OPTION_DEFINITIONS);
}

export function buildAccountsBrowseOptionsHelpText(): string {
  return buildCliOptionsHelpText(ACCOUNTS_BROWSE_OPTION_DEFINITIONS);
}

export function prepareAccountsBrowseCommand({
  accountSelector,
  rawOptions,
  surfaceSpec,
}: ExecuteAccountsBrowseCommandInput): Result<PreparedAccountsBrowseCommand, CliFailure> {
  const parsedOptionsResult = parseCliBrowseOptionsResult(rawOptions, AccountsBrowseCommandOptionsSchema, surfaceSpec);
  if (parsedOptionsResult.isErr()) {
    return err(parsedOptionsResult.error);
  }

  const { presentation, options } = parsedOptionsResult.value;
  if (accountSelector && (options.platform || options.type)) {
    return err(
      createCliFailure(
        new Error('Account selector cannot be combined with --platform or --type'),
        ExitCodes.INVALID_ARGS
      )
    );
  }

  return ok(
    prepareBrowseCommand(
      {
        accountSelector,
        includeExplorerDetails: presentation.mode === 'tui' ? true : undefined,
        platformKey: options.platform,
        accountType: options.type,
        showSessions: options.showSessions,
        preselectInExplorer: accountSelector !== undefined && presentation.mode === 'tui' ? true : undefined,
      },
      presentation
    )
  );
}

export async function executePreparedAccountsBrowseCommand(
  ctx: CommandRuntime,
  prepared: PreparedAccountsBrowseCommand
): Promise<CliCommandResult> {
  return executePreparedBrowseCommand({
    prepared,
    loadBrowsePresentation: (params) => buildAccountsBrowsePresentation(ctx, params),
    resolveNavigability: (params, browsePresentation) => ({
      hasNavigableItems: hasNavigableAccounts(browsePresentation.initialState),
      shouldCollapseEmptyExplorer: shouldCollapseAccountsExplorerWhenEmpty(params),
    }),
    buildCompletion: ({ browsePresentation, finalPresentation }) =>
      buildAccountsBrowseCompletion(ctx, browsePresentation, finalPresentation.staticKind, finalPresentation.mode),
  });
}

function buildAccountsBrowseCompletion(
  ctx: CommandRuntime,
  browsePresentation: AccountsBrowsePresentation,
  staticKind: 'list' | 'detail',
  mode: 'json' | 'static' | 'tui'
): Result<CliCompletion, CliFailure> {
  if (mode === 'tui') {
    return ok(
      textSuccess(async () => {
        await ctx.closeDatabaseSession();
        await renderApp((unmount) =>
          React.createElement(AccountsViewApp, {
            initialState: browsePresentation.initialState,
            onQuit: unmount,
          })
        );
      })
    );
  }

  return buildBrowseJsonOrStaticCompletion({
    createMissingDetailJsonError: () =>
      createCliFailure(new Error('Expected a detail JSON result for detail presentation'), ExitCodes.GENERAL_ERROR),
    createMissingSelectedItemError: () =>
      createCliFailure(new Error('Expected a selected account for detail presentation'), ExitCodes.GENERAL_ERROR),
    detailJsonResult: browsePresentation.detailJsonResult,
    listJsonResult: browsePresentation.listJsonResult,
    mode,
    renderStaticDetail: (selectedAccount) => {
      outputAccountStaticDetail(selectedAccount);
    },
    renderStaticList: () => {
      outputAccountsStaticList(browsePresentation.initialState);
    },
    selectedItem: browsePresentation.selectedAccount,
    staticKind,
  });
}

function shouldCollapseAccountsExplorerWhenEmpty(params: AccountsBrowseParams): boolean {
  return params.accountSelector === undefined && params.platformKey === undefined && params.accountType === undefined;
}

export async function runAccountsBrowseCommand(input: ExecuteAccountsBrowseCommandInput): Promise<void> {
  await runPreparedBrowseRuntimeCommand({
    command: input.commandId,
    rawOptions: input.rawOptions,
    prepare: () => prepareAccountsBrowseCommand(input),
    action: async ({ runtime, prepared }) => executePreparedAccountsBrowseCommand(runtime, prepared),
  });
}
