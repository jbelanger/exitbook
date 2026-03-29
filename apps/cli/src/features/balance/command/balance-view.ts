import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { BalanceApp } from '../view/balance-view-components.jsx';
import { createBalanceStoredSnapshotAssetState, createBalanceStoredSnapshotState } from '../view/balance-view-state.js';
import { buildStoredSnapshotAccountItem, sortStoredSnapshotAssets } from '../view/balance-view-utils.js';

import { withBalanceCommandScope } from './balance-command-scope.js';
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
  const { format, options } = parseCliCommandOptions('balance-view', rawOptions, BalanceViewCommandOptionsSchema);
  if (format === 'json') {
    await executeBalanceViewJSON(options, appRuntime);
  } else {
    await executeBalanceViewTUI(options, appRuntime);
  }
}

async function executeBalanceViewJSON(options: BalanceViewCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const result = await withBalanceCommandScope(
        ctx,
        {
          format: 'json',
          needsWorkflow: true,
          prepareStoredSnapshots: true,
        },
        (scope) => runBalanceView(scope, { accountId: options.accountId })
      );
      if (result.isErr()) {
        displayCliError('balance-view', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const accountsData = result.value.accounts.map((item) => ({
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

      outputSuccess(
        'balance-view',
        { accounts: accountsData },
        {
          totalAccounts: result.value.accounts.length,
          mode: 'view',
          filters: {
            ...(options.accountId ? { accountId: options.accountId } : {}),
          },
        }
      );
    });
  } catch (error) {
    displayCliError(
      'balance-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

async function executeBalanceViewTUI(options: BalanceViewCommandOptions, appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const result = await withBalanceCommandScope(
        ctx,
        {
          format: 'text',
          needsWorkflow: true,
          prepareStoredSnapshots: true,
        },
        (scope) => runBalanceView(scope, { accountId: options.accountId })
      );
      if (result.isErr()) throw result.error;

      await ctx.closeDatabase();

      if (options.accountId) {
        const item = result.value.accounts[0];
        if (!item) throw new Error(`Account #${options.accountId} not found`);

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
        return;
      }

      const storedSnapshotItems = result.value.accounts.map((item) =>
        buildStoredSnapshotAccountItem(item.account, sortStoredSnapshotAssets(item.assets), item.snapshot)
      );
      const initialState = createBalanceStoredSnapshotState(storedSnapshotItems);

      await renderApp((unmount) => React.createElement(BalanceApp, { initialState, onQuit: unmount }));
    });
  } catch (error) {
    displayCliError(
      'balance-view',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}
