import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  toCliValue,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from '../../../cli/command.js';
import {
  detectCliOutputFormat,
  detectCliTokenOutputFormat,
  parseCliBrowseRootInvocationResult,
  parseCliCommandOptionsWithOverridesResult,
} from '../../../cli/options.js';
import {
  collapseEmptyExplorerToStatic,
  explorerDetailSurfaceSpec,
  explorerListSurfaceSpec,
  resolveBrowsePresentation,
  staticDetailSurfaceSpec,
  staticListSurfaceSpec,
  type BrowseSurfaceSpec,
  type ResolvedBrowsePresentation,
} from '../../../cli/presentation.js';
import { renderApp, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { outputBalanceStaticDetail, outputBalanceStaticList } from '../view/balance-static-renderer.js';
import { BalanceApp } from '../view/balance-view-components.jsx';

import {
  buildBalanceBrowsePresentation,
  getAccountSelectorErrorExitCode,
  hasNavigableBalances,
  type BalanceBrowsePresentation,
  type BalanceBrowseParams,
} from './balance-browse-support.js';
import { withBalanceCommandScope } from './balance-command-scope.js';
import { BalanceViewCommandOptionsSchema } from './balance-option-schemas.js';

const BALANCE_BROWSE_COMMAND_ID = 'balance';
const BALANCE_VIEW_COMMAND_ID = 'balance-view';
const BALANCE_LIST_ALIAS = 'list';

interface ExecuteBalanceBrowseCommandInput {
  accountSelector?: string | undefined;
  rawOptions: unknown;
  surfaceSpec: BrowseSurfaceSpec;
}

export interface PreparedBalanceBrowseCommand {
  params: BalanceBrowseParams;
  presentation: ResolvedBrowsePresentation;
}

interface BalanceBrowseOptionDefinition {
  description: string;
  flags: string;
}

const BALANCE_BROWSE_OPTION_DEFINITIONS: BalanceBrowseOptionDefinition[] = [
  {
    flags: '--json',
    description: 'Output JSON format',
  },
];

export function registerBalanceBrowseOptions(command: Command): Command {
  for (const option of BALANCE_BROWSE_OPTION_DEFINITIONS) {
    command.option(option.flags, option.description);
  }

  return command;
}

export function buildBalanceBrowseOptionsHelpText(): string {
  const flagsColumnWidth =
    BALANCE_BROWSE_OPTION_DEFINITIONS.reduce((maxWidth, option) => Math.max(maxWidth, option.flags.length), 0) + 2;

  return BALANCE_BROWSE_OPTION_DEFINITIONS.map((option) => {
    return `  ${option.flags.padEnd(flagsColumnWidth)}${option.description}`;
  }).join('\n');
}

export async function runBalanceRootBrowseCommand(tokens: string[] | undefined): Promise<void> {
  await runCliRuntimeCommand({
    command: BALANCE_BROWSE_COMMAND_ID,
    format: detectCliTokenOutputFormat(tokens),
    prepare: async () =>
      resultDoAsync(async function* () {
        const invocation = yield* parseCliBrowseRootInvocationResult(tokens, registerBalanceBrowseOptions);
        const accountSelector = invocation.selector?.trim();

        if (accountSelector?.toLowerCase() === BALANCE_LIST_ALIAS) {
          return yield* err(
            createCliFailure(new Error('Use bare "balance" instead of "balance list".'), ExitCodes.INVALID_ARGS)
          );
        }

        return yield* prepareBalanceBrowseCommand({
          accountSelector,
          rawOptions: invocation.rawOptions,
          surfaceSpec: accountSelector
            ? staticDetailSurfaceSpec(BALANCE_BROWSE_COMMAND_ID)
            : staticListSurfaceSpec(BALANCE_BROWSE_COMMAND_ID),
        });
      }),
    action: async (context) => executePreparedBalanceBrowseCommand(context.runtime, context.prepared),
  });
}

export async function runBalanceViewBrowseCommand(input: {
  accountSelector?: string | undefined;
  rawOptions: unknown;
}): Promise<void> {
  await runCliRuntimeCommand({
    command: BALANCE_VIEW_COMMAND_ID,
    format: detectCliOutputFormat(input.rawOptions),
    prepare: async () =>
      prepareBalanceBrowseCommand({
        accountSelector: input.accountSelector,
        rawOptions: input.rawOptions,
        surfaceSpec: input.accountSelector
          ? explorerDetailSurfaceSpec(BALANCE_VIEW_COMMAND_ID)
          : explorerListSurfaceSpec(BALANCE_VIEW_COMMAND_ID),
      }),
    action: async (context) => executePreparedBalanceBrowseCommand(context.runtime, context.prepared),
  });
}

export function prepareBalanceBrowseCommand(
  input: ExecuteBalanceBrowseCommandInput
): Result<PreparedBalanceBrowseCommand, CliFailure> {
  const optionsResult = parseCliCommandOptionsWithOverridesResult(
    input.rawOptions,
    { selector: input.accountSelector },
    BalanceViewCommandOptionsSchema
  );
  if (optionsResult.isErr()) {
    return err(optionsResult.error);
  }

  return ok({
    params: {
      accountSelector: optionsResult.value.selector,
    },
    presentation: resolveBrowsePresentation(input.surfaceSpec, input.rawOptions),
  });
}

export async function executePreparedBalanceBrowseCommand(
  ctx: CommandRuntime,
  prepared: PreparedBalanceBrowseCommand
): Promise<CliCommandResult> {
  const format = prepared.presentation.mode === 'json' ? 'json' : 'text';
  return resultDoAsync(async function* () {
    const browsePresentation = await withBalanceCommandScope(
      ctx,
      {
        format,
        needsWorkflow: false,
        prepareStoredSnapshots: true,
      },
      async (scope) => buildBalanceBrowsePresentation(scope, prepared.params)
    );
    if (browsePresentation.isErr()) {
      return yield* err(
        createCliFailure(browsePresentation.error, getAccountSelectorErrorExitCode(browsePresentation.error))
      );
    }

    const finalPresentation = collapseEmptyExplorerToStatic(prepared.presentation, {
      hasNavigableItems: hasNavigableBalances(browsePresentation.value.initialState),
      shouldCollapseEmptyExplorer: prepared.params.accountSelector === undefined,
    });

    if (finalPresentation.mode === 'tui') {
      yield* toCliResult(await closeBalanceDatabase(ctx), ExitCodes.GENERAL_ERROR);
    }

    return yield* buildBalanceBrowseCompletion(
      browsePresentation.value,
      finalPresentation.staticKind,
      finalPresentation.mode
    );
  });
}

function buildBalanceBrowseCompletion(
  browsePresentation: BalanceBrowsePresentation,
  staticKind: 'detail' | 'list',
  mode: 'json' | 'static' | 'tui'
): Result<CliCompletion, CliFailure> {
  switch (mode) {
    case 'json':
      return ok(jsonSuccess(browsePresentation.jsonResult.data, browsePresentation.jsonResult.metadata));
    case 'static':
      if (staticKind === 'detail') {
        const selectedAccountResult = toCliValue(
          browsePresentation.selectedAccountResult,
          new Error('Expected a selected balance scope for detail presentation'),
          ExitCodes.GENERAL_ERROR
        );
        if (selectedAccountResult.isErr()) {
          return err(selectedAccountResult.error);
        }

        return ok(
          textSuccess(() => {
            outputBalanceStaticDetail(selectedAccountResult.value);
          })
        );
      }

      return ok(
        textSuccess(() => {
          outputBalanceStaticList(browsePresentation.initialState);
        })
      );
    case 'tui': {
      const initialStateResult =
        staticKind === 'detail'
          ? toCliValue(
              browsePresentation.detailState,
              new Error('Expected a selected balance asset state for detail explorer'),
              ExitCodes.GENERAL_ERROR
            )
          : ok(browsePresentation.initialState);

      if (initialStateResult.isErr()) {
        return err(initialStateResult.error);
      }

      return ok(
        textSuccess(async () =>
          renderApp((unmount) =>
            React.createElement(BalanceApp, {
              initialState: initialStateResult.value,
              onQuit: unmount,
            })
          )
        )
      );
    }
  }

  const exhaustiveCheck: never = mode;
  return exhaustiveCheck;
}

async function closeBalanceDatabase(ctx: CommandRuntime): Promise<Result<void, Error>> {
  try {
    await ctx.closeDatabase();
    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
