import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import {
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  silentSuccess,
  toCliResult,
  type CliCommandResult,
  type CliCompletion,
} from '../../../cli/command.js';
import { detectCliOutputFormat, type CliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { BalanceApp } from '../view/balance-view-components.jsx';
import { createBalanceStoredSnapshotAssetState, createBalanceStoredSnapshotState } from '../view/balance-view-state.js';
import { buildStoredSnapshotAccountItem, sortStoredSnapshotAssets } from '../view/balance-view-utils.js';

import { withBalanceCommandScope } from './balance-command-scope.js';
import type { StoredSnapshotBalanceResult } from './balance-handler-types.js';
import { BalanceViewCommandOptionsSchema } from './balance-option-schemas.js';
import { runBalanceView } from './run-balance.js';

type BalanceViewCommandOptions = z.infer<typeof BalanceViewCommandOptionsSchema>;

export function registerBalanceViewCommand(balanceCommand: Command, appRuntime: CliAppRuntime): void {
  balanceCommand
    .command('view')
    .description('View stored balance snapshots without calling live providers')
    .option('--account-id <id>', 'View a specific balance scope', parseInt)
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook balance view
  $ exitbook balance view --account-id 5
  $ exitbook balance view --json

Notes:
  - Reads stored balance snapshots only.
  - Reprocesses derived transactions automatically if they are missing or stale.
  - Rebuilds stored calculated snapshots automatically when they are missing or stale.
  - Does not fetch live balances.
  - Use "exitbook balance refresh" when you want live verification.
`
    )
    .action((rawOptions: unknown) => executeBalanceViewCommand(rawOptions, appRuntime));
}

async function executeBalanceViewCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand<BalanceViewCommandOptions>({
    command: 'balance-view',
    format,
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsResult(rawOptions, BalanceViewCommandOptionsSchema);
      }),
    action: async (context) => executeBalanceViewCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeBalanceViewCommandResult(
  ctx: CommandRuntime,
  options: BalanceViewCommandOptions,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const completion = yield* toCliResult(
      await withBalanceCommandScope(
        ctx,
        {
          format,
          needsWorkflow: true,
          prepareStoredSnapshots: true,
        },
        async (scope) => {
          const result = await runBalanceView(scope, { accountId: options.accountId });
          if (result.isErr()) {
            return err(result.error);
          }

          if (format === 'json') {
            return ok(buildBalanceViewJsonCompletion(options, result.value));
          }

          return buildBalanceViewTuiCompletion(ctx, options, result.value);
        }
      ),
      ExitCodes.GENERAL_ERROR
    );

    return completion;
  });
}

function buildBalanceViewJsonCompletion(
  options: BalanceViewCommandOptions,
  result: StoredSnapshotBalanceResult
): CliCompletion {
  const accounts = result.accounts.map((item) => ({
    accountId: item.account.id,
    platformKey: item.account.platformKey,
    accountType: item.account.accountType,
    snapshot: {
      verificationStatus: item.snapshot.verificationStatus,
      statusReason: item.snapshot.statusReason,
      suggestion: item.snapshot.suggestion,
      lastRefreshAt: item.snapshot.lastRefreshAt?.toISOString(),
    },
    ...(item.requestedAccount && {
      requestedAccount: {
        id: item.requestedAccount.id,
        platformKey: item.requestedAccount.platformKey,
        accountType: item.requestedAccount.accountType,
      },
    }),
    assets: item.assets.map((asset) => ({
      assetId: asset.assetId,
      assetSymbol: asset.assetSymbol,
      calculatedBalance: asset.calculatedBalance,
      diagnostics: asset.diagnostics,
    })),
  }));

  return jsonSuccess(
    { accounts },
    {
      totalAccounts: result.accounts.length,
      mode: 'view',
      filters: {
        ...(options.accountId ? { accountId: options.accountId } : {}),
      },
    }
  );
}

async function buildBalanceViewTuiCompletion(
  ctx: CommandRuntime,
  options: BalanceViewCommandOptions,
  result: StoredSnapshotBalanceResult
): Promise<Result<CliCompletion, Error>> {
  try {
    await ctx.closeDatabase();

    if (options.accountId !== undefined) {
      const item = result.accounts[0];
      if (!item) {
        return err(new Error(`Account #${options.accountId} not found`));
      }

      const initialState = createBalanceStoredSnapshotAssetState(
        {
          accountId: item.account.id,
          platformKey: item.account.platformKey,
          accountType: item.account.accountType,
          verificationStatus: item.snapshot.verificationStatus,
          statusReason: item.snapshot.statusReason,
          suggestion: item.snapshot.suggestion,
          lastRefreshAt: item.snapshot.lastRefreshAt?.toISOString(),
        },
        sortStoredSnapshotAssets(item.assets)
      );

      await renderApp((unmount) => React.createElement(BalanceApp, { initialState, onQuit: unmount }));
      return ok(silentSuccess());
    }

    const storedSnapshotItems = result.accounts.map((item) =>
      buildStoredSnapshotAccountItem(item.account, sortStoredSnapshotAssets(item.assets), item.snapshot)
    );
    const initialState = createBalanceStoredSnapshotState(storedSnapshotItems);

    await renderApp((unmount) => React.createElement(BalanceApp, { initialState, onQuit: unmount }));
    return ok(silentSuccess());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
