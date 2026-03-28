import { err, ok } from '@exitbook/foundation';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp, runCommand } from '../../../runtime/command-runtime.js';
import { EventRelay } from '../../../ui/shared/event-relay.js';
import { displayCliError } from '../../shared/cli-error.js';
import { parseCliCommandOptions } from '../../shared/command-options.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { BalanceApp } from '../view/balance-view-components.jsx';
import {
  type AccountVerificationItem,
  createBalanceStoredSnapshotAssetState,
  createBalanceVerificationAssetState,
  createBalanceVerificationState,
  type BalanceEvent,
} from '../view/balance-view-state.js';
import { sortAssetsByStatus, sortAccountsByVerificationPriority } from '../view/balance-view-utils.js';

import { withBalanceCommandScope } from './balance-command-scope.js';
import { BalanceRefreshCommandOptionsSchema } from './balance-option-schemas.js';
import { buildCliExchangeCredentials } from './balance-utils.js';
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
    .option('--account-id <id>', 'Refresh a specific balance scope', parseInt)
    .option('--api-key <key>', 'API key for exchange (overrides .env)')
    .option('--api-secret <secret>', 'API secret for exchange (overrides .env)')
    .option('--api-passphrase <passphrase>', 'API passphrase for exchange (if required)')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook balance refresh
  $ exitbook balance refresh --account-id 5
  $ exitbook balance refresh --account-id 7 --api-key KEY --api-secret SECRET
  $ exitbook balance refresh --json

Notes:
  - Refresh is the only command that attempts live balance verification.
  - If no live balance provider exists for a scope, refresh persists calculated balances and marks verification unavailable.
  - For child accounts, refresh operates on the owning parent balance scope.
`
    )
    .action((rawOptions: unknown) => executeBalanceRefreshCommand(rawOptions, appRuntime));
}

async function executeBalanceRefreshCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const { format, options } = parseCliCommandOptions('balance-refresh', rawOptions, BalanceRefreshCommandOptionsSchema);
  if (format === 'json') {
    await executeBalanceRefreshJSON(options, appRuntime);
  } else if (options.accountId) {
    await executeBalanceRefreshSingleTUI(options, appRuntime);
  } else {
    await executeBalanceRefreshAllTUI(appRuntime);
  }
}

async function executeBalanceRefreshJSON(
  options: BalanceRefreshCommandOptions,
  appRuntime: CliAppRuntime
): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const result = await withBalanceCommandScope(ctx, { format: 'json', needsWorkflow: true }, async (scope) => {
        if (options.accountId) {
          const credentials = buildCliExchangeCredentials(options);
          const refreshResult = await runBalanceRefreshSingle(scope, {
            accountId: options.accountId,
            credentials,
          });
          if (refreshResult.isErr()) {
            return err(refreshResult.error);
          }

          const { account, requestedAccount, verificationResult, streamMetadata } = refreshResult.value;

          outputSuccess('balance-refresh', {
            status: verificationResult.status,
            mode: refreshResult.value.mode,
            balances:
              refreshResult.value.mode === 'verification'
                ? refreshResult.value.comparisons
                : refreshResult.value.assets.map((asset) => ({
                    assetId: asset.assetId,
                    assetSymbol: asset.assetSymbol,
                    calculatedBalance: asset.calculatedBalance,
                    diagnostics: asset.diagnostics,
                  })),
            summary: verificationResult.summary,
            coverage: verificationResult.coverage,
            source: {
              type: (account.accountType === 'blockchain' ? 'blockchain' : 'exchange') as string,
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
          return ok(undefined);
        }

        const refreshAllResult = await runBalanceRefreshAll(scope);
        if (refreshAllResult.isErr()) {
          return err(refreshAllResult.error);
        }

        outputSuccess(
          'balance-refresh',
          { accounts: refreshAllResult.value.accounts },
          {
            totalAccounts: refreshAllResult.value.totals.total,
            verified: refreshAllResult.value.totals.verified,
            skipped: refreshAllResult.value.totals.skipped,
            matches: refreshAllResult.value.totals.matches,
            mismatches: refreshAllResult.value.totals.mismatches,
            timestamp: new Date().toISOString(),
          }
        );

        return ok(undefined);
      });
      if (result.isErr()) {
        displayCliError('balance-refresh', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }
    });
  } catch (error) {
    displayCliError(
      'balance-refresh',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

async function executeBalanceRefreshSingleTUI(
  options: BalanceRefreshCommandOptions,
  appRuntime: CliAppRuntime
): Promise<void> {
  const accountId = options.accountId;
  if (accountId === undefined) return;

  try {
    await runCommand(appRuntime, async (ctx) => {
      const result = await withBalanceCommandScope(ctx, { format: 'text', needsWorkflow: true }, (scope) =>
        runBalanceRefreshSingle(scope, {
          accountId,
          credentials: buildCliExchangeCredentials(options),
        })
      );
      if (result.isErr()) {
        displayCliError('balance-refresh', result.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const { account } = result.value;
      const initialState =
        result.value.mode === 'verification'
          ? createBalanceVerificationAssetState(
              { accountId: account.id, platformKey: account.platformKey, accountType: account.accountType },
              sortAssetsByStatus(result.value.comparisons)
            )
          : createBalanceStoredSnapshotAssetState(
              {
                accountId: account.id,
                platformKey: account.platformKey,
                accountType: account.accountType,
                verificationStatus: 'unavailable',
                statusReason: result.value.verificationResult.warnings?.[0],
                suggestion: result.value.verificationResult.suggestion,
              },
              result.value.assets
            );

      await renderApp((unmount) => React.createElement(BalanceApp, { initialState, onQuit: unmount }));
    });
  } catch (error) {
    displayCliError(
      'balance-refresh',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

async function executeBalanceRefreshAllTUI(appRuntime: CliAppRuntime): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const result = await withBalanceCommandScope(ctx, { format: 'text', needsWorkflow: true }, async (scope) => {
        const sortedResult = await loadBalanceVerificationAccounts(scope);
        if (sortedResult.isErr()) {
          return sortedResult;
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

        return sortedResult;
      });
      if (result.isErr()) {
        throw result.error;
      }
    });
  } catch (error) {
    displayCliError(
      'balance-refresh',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}
