import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import {
  cliErr,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  type CliCommandResult,
  type CliCompletion,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsWithOverridesResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { type CommandRuntime, renderApp } from '../../../runtime/command-runtime.js';
import { EventRelay } from '../../../ui/shared/event-relay.js';
import {
  hasAccountSelectorArgument,
  getAccountSelectorErrorExitCode,
  resolveRequiredOwnedAccountSelector,
} from '../../accounts/account-selector.js';
import { BalanceApp } from '../view/balance-view-components.jsx';
import {
  type AccountVerificationItem,
  createBalanceStoredSnapshotAssetState,
  createBalanceVerificationAssetState,
  createBalanceVerificationState,
  type BalanceEvent,
} from '../view/balance-view-state.js';
import { sortAssetsByStatus, sortAccountsByVerificationPriority } from '../view/balance-view-utils.js';

import { withBalanceCommandScope, type BalanceCommandScope } from './balance-command-scope.js';
import type {
  AllAccountsVerificationResult,
  SingleCalculatedSnapshotResult,
  SingleRefreshResult,
} from './balance-handler-types.js';
import { BalanceRefreshCommandOptionsSchema } from './balance-option-schemas.js';
import {
  abortBalanceVerification,
  loadBalanceVerificationAccounts,
  runBalanceRefreshAll,
  runBalanceRefreshSingle,
  startBalanceVerificationStream,
} from './run-balance.js';

type BalanceRefreshCommandOptions = z.infer<typeof BalanceRefreshCommandOptionsSchema>;

export function registerBalanceRefreshCommand(balanceCommand: Command, appRuntime: CliAppRuntime): void {
  balanceCommand
    .command('refresh')
    .description('Rebuild calculated balances and verify them against live provider data when available')
    .argument('[selector]', 'Account selector (name or fingerprint prefix)')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook balance refresh
  $ exitbook balance refresh kraken-main
  $ exitbook balance refresh --json

Notes:
  - Refresh is the only command that attempts live balance verification.
  - Exchange refresh uses provider credentials stored on the account itself.
  - If no live balance provider exists for a scope, refresh persists calculated balances and marks verification unavailable.
  - For child accounts, refresh operates on the owning parent balance scope.
`
    )
    .action((selector: string | undefined, rawOptions: unknown) =>
      executeBalanceRefreshCommand(selector, rawOptions, appRuntime)
    );
}

async function executeBalanceRefreshCommand(
  selector: string | undefined,
  rawOptions: unknown,
  appRuntime: CliAppRuntime
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'balance-refresh',
    format,
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsWithOverridesResult(
          rawOptions,
          { selector },
          BalanceRefreshCommandOptionsSchema
        );
      }),
    action: async (context) => executeBalanceRefreshCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeBalanceRefreshCommandResult(
  ctx: CommandRuntime,
  options: BalanceRefreshCommandOptions,
  format: 'json' | 'text'
): Promise<CliCommandResult> {
  if (format === 'json') {
    return hasAccountSelectorArgument(options)
      ? executeBalanceRefreshSingleJsonCommand(ctx, options)
      : executeBalanceRefreshAllJsonCommand(ctx);
  }

  return hasAccountSelectorArgument(options)
    ? executeBalanceRefreshSingleTuiCommand(ctx, options)
    : executeBalanceRefreshAllTuiCommand(ctx);
}

async function executeBalanceRefreshSingleJsonCommand(
  ctx: CommandRuntime,
  options: BalanceRefreshCommandOptions
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = await withBalanceCommandScope(ctx, { format: 'json', needsWorkflow: true }, async (scope) => {
      const selection = await resolveRequiredOwnedAccountSelector(
        scope.accountService,
        scope.profile.id,
        options.selector,
        'Balance refresh requires an account selector'
      );
      if (selection.isErr()) {
        return err(selection.error);
      }

      const result = await runBalanceRefreshSingle(scope, {
        accountId: selection.value.account.id,
      });
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(buildBalanceRefreshSingleJsonCompletion(result.value));
    });

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}

async function executeBalanceRefreshAllJsonCommand(ctx: CommandRuntime): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = await withBalanceCommandScope(ctx, { format: 'json', needsWorkflow: true }, async (scope) => {
      const result = await runBalanceRefreshAll(scope);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(buildBalanceRefreshAllJsonCompletion(result.value));
    });

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}

async function executeBalanceRefreshSingleTuiCommand(
  ctx: CommandRuntime,
  options: BalanceRefreshCommandOptions
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = await withBalanceCommandScope(ctx, { format: 'text', needsWorkflow: true }, async (scope) => {
      const selection = await resolveRequiredOwnedAccountSelector(
        scope.accountService,
        scope.profile.id,
        options.selector,
        'Balance refresh requires an account selector'
      );
      if (selection.isErr()) {
        return err(selection.error);
      }

      const result = await runBalanceRefreshSingle(scope, {
        accountId: selection.value.account.id,
      });
      if (result.isErr()) {
        return err(result.error);
      }

      return buildBalanceRefreshSingleTuiCompletion(result.value);
    });

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}

async function executeBalanceRefreshAllTuiCommand(ctx: CommandRuntime): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = await withBalanceCommandScope(ctx, { format: 'text', needsWorkflow: true }, async (scope) =>
      buildBalanceRefreshAllTuiCompletion(ctx, scope)
    );

    if (completion.isErr()) {
      return yield* cliErr(completion.error, getAccountSelectorErrorExitCode(completion.error));
    }

    return completion.value;
  });
}

function buildBalanceRefreshSingleJsonCompletion(result: SingleRefreshResult): CliCompletion {
  const { account, requestedAccount, verificationResult, streamMetadata } = result;

  return jsonSuccess({
    status: verificationResult.status,
    mode: result.mode,
    balances:
      result.mode === 'verification'
        ? result.comparisons
        : result.assets.map((asset) => ({
            assetId: asset.assetId,
            assetSymbol: asset.assetSymbol,
            calculatedBalance: asset.calculatedBalance,
            diagnostics: asset.diagnostics,
          })),
    summary: verificationResult.summary,
    coverage: verificationResult.coverage,
    source: {
      type: account.accountType === 'blockchain' ? 'blockchain' : 'exchange',
      name: account.platformKey,
      address: account.accountType === 'blockchain' ? account.identifier : undefined,
    },
    account: {
      id: account.id,
      type: account.accountType,
      platformKey: account.platformKey,
      identifier: account.identifier,
      providerName: account.providerName,
    },
    ...(requestedAccount && {
      requestedAccount: {
        id: requestedAccount.id,
        type: requestedAccount.accountType,
        platformKey: requestedAccount.platformKey,
        identifier: requestedAccount.identifier,
        providerName: requestedAccount.providerName,
      },
    }),
    meta: {
      timestamp: new Date(verificationResult.timestamp).toISOString(),
      ...(streamMetadata && { streams: streamMetadata }),
    },
    suggestion: verificationResult.suggestion,
    partialFailures: verificationResult.partialFailures,
    warnings: verificationResult.warnings,
  });
}

function buildBalanceRefreshAllJsonCompletion(result: AllAccountsVerificationResult): CliCompletion {
  return jsonSuccess(
    { accounts: result.accounts },
    {
      totalAccounts: result.totals.total,
      verified: result.totals.verified,
      skipped: result.totals.skipped,
      matches: result.totals.matches,
      mismatches: result.totals.mismatches,
      timestamp: new Date().toISOString(),
    }
  );
}

async function buildBalanceRefreshSingleTuiCompletion(
  result: SingleRefreshResult
): Promise<Result<CliCompletion, Error>> {
  try {
    const initialState =
      result.mode === 'verification'
        ? createBalanceVerificationAssetState(
            {
              accountId: result.account.id,
              platformKey: result.account.platformKey,
              accountType: result.account.accountType,
            },
            sortAssetsByStatus(result.comparisons)
          )
        : createStoredSnapshotAssetStateFromRefreshResult(result);

    await renderApp((unmount) => React.createElement(BalanceApp, { initialState, onQuit: unmount }));
    return ok(silentSuccess());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

async function buildBalanceRefreshAllTuiCompletion(
  ctx: CommandRuntime,
  scope: BalanceCommandScope
): Promise<Result<CliCompletion, Error>> {
  const sortedResult = await loadBalanceVerificationAccounts(scope);
  if (sortedResult.isErr()) {
    return err(sortedResult.error);
  }

  const initialItems: AccountVerificationItem[] = sortAccountsByVerificationPriority(sortedResult.value).map(
    (account) => ({
      accountId: account.accountId,
      platformKey: account.platformKey,
      accountType: account.accountType,
      status: account.skipReason ? ('skipped' as const) : ('pending' as const),
      assetCount: 0,
      matchCount: 0,
      mismatchCount: 0,
      warningCount: 0,
      skipReason: account.skipReason,
    })
  );
  const initialState = createBalanceVerificationState(initialItems);
  const relay = new EventRelay<BalanceEvent>();

  startBalanceVerificationStream(scope, sortedResult.value, relay);
  ctx.onAbort(() => abortBalanceVerification(scope));

  try {
    await renderApp((unmount) =>
      React.createElement(BalanceApp, {
        initialState,
        relay,
        onQuit: () => {
          relay.push({ type: 'ABORTING' });
          setTimeout(unmount, 50);
        },
      })
    );
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }

  return ok(silentSuccess());
}

function createStoredSnapshotAssetStateFromRefreshResult(result: SingleCalculatedSnapshotResult) {
  return createBalanceStoredSnapshotAssetState(
    {
      accountId: result.account.id,
      platformKey: result.account.platformKey,
      accountType: result.account.accountType,
      verificationStatus: 'unavailable',
      statusReason: result.verificationResult.warnings?.[0],
      suggestion: result.verificationResult.suggestion,
    },
    result.assets
  );
}
