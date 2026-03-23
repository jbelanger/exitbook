import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import { renderApp, runCommand } from '../../../runtime/command-scope.js';
import { EventRelay } from '../../../ui/shared/event-relay.js';
import { displayCliError } from '../../shared/cli-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { isJsonMode } from '../../shared/json-mode.js';
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

import { createBalanceHandler } from './balance-handler.js';
import { BalanceRefreshCommandOptionsSchema } from './balance-option-schemas.js';
import { buildCliExchangeCredentials } from './balance-utils.js';

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
  const isJson = isJsonMode(rawOptions);
  const validationResult = BalanceRefreshCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    displayCliError(
      'balance-refresh',
      new Error(validationResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJson ? 'json' : 'text'
    );
  }

  const options = validationResult.data;
  if (options.json) {
    await executeBalanceRefreshJSON(options, appRuntime);
  } else if (options.accountId) {
    await executeBalanceRefreshSingleTUI(options, appRuntime);
  } else {
    await executeBalanceRefreshAllTUI(options, appRuntime);
  }
}

async function executeBalanceRefreshJSON(
  options: BalanceRefreshCommandOptions,
  appRuntime: CliAppRuntime
): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const handlerResult = await createBalanceHandler(ctx, { needsWorkflow: true });
      if (handlerResult.isErr()) {
        displayCliError('balance-refresh', handlerResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const handler = handlerResult.value;

      if (options.accountId) {
        const credentials = buildCliExchangeCredentials(options);
        const result = await handler.refreshSingleScope({ accountId: options.accountId, credentials });
        if (result.isErr()) {
          displayCliError('balance-refresh', result.error, ExitCodes.GENERAL_ERROR, 'json');
        }

        const { account, requestedAccount, verificationResult, streamMetadata } = result.value;

        outputSuccess('balance-refresh', {
          status: verificationResult.status,
          mode: result.value.mode,
          balances:
            result.value.mode === 'verification'
              ? result.value.comparisons
              : result.value.assets.map((asset) => ({
                  assetId: asset.assetId,
                  assetSymbol: asset.assetSymbol,
                  calculatedBalance: asset.calculatedBalance,
                  diagnostics: asset.diagnostics,
                })),
          summary: verificationResult.summary,
          coverage: verificationResult.coverage,
          source: {
            type: (account.accountType === 'blockchain' ? 'blockchain' : 'exchange') as string,
            name: account.sourceName,
            address: account.accountType === 'blockchain' ? account.identifier : undefined,
          },
          account: {
            id: account.id,
            type: account.accountType,
            sourceName: account.sourceName,
            identifier: account.identifier,
            providerName: account.providerName,
          },
          ...(requestedAccount && {
            requestedAccount: {
              id: requestedAccount.id,
              type: requestedAccount.accountType,
              sourceName: requestedAccount.sourceName,
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
        return;
      }

      const result = await handler.refreshAllScopes();
      if (result.isErr()) {
        displayCliError('balance-refresh', result.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      outputSuccess(
        'balance-refresh',
        { accounts: result.value.accounts },
        {
          totalAccounts: result.value.totals.total,
          verified: result.value.totals.verified,
          skipped: result.value.totals.skipped,
          matches: result.value.totals.matches,
          mismatches: result.value.totals.mismatches,
          timestamp: new Date().toISOString(),
        }
      );
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
      const handlerResult = await createBalanceHandler(ctx, { needsWorkflow: true });
      if (handlerResult.isErr()) throw handlerResult.error;

      const handler = handlerResult.value;
      const credentials = buildCliExchangeCredentials(options);
      const result = await handler.refreshSingleScope({ accountId, credentials });
      if (result.isErr()) {
        displayCliError('balance-refresh', result.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const { account } = result.value;
      const initialState =
        result.value.mode === 'verification'
          ? createBalanceVerificationAssetState(
              { accountId: account.id, sourceName: account.sourceName, accountType: account.accountType },
              sortAssetsByStatus(result.value.comparisons)
            )
          : createBalanceStoredSnapshotAssetState(
              {
                accountId: account.id,
                sourceName: account.sourceName,
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

async function executeBalanceRefreshAllTUI(
  _options: BalanceRefreshCommandOptions,
  appRuntime: CliAppRuntime
): Promise<void> {
  try {
    await runCommand(appRuntime, async (ctx) => {
      const handlerResult = await createBalanceHandler(ctx, { needsWorkflow: true });
      if (handlerResult.isErr()) throw handlerResult.error;

      const handler = handlerResult.value;
      const sortedResult = await handler.loadAccountsForVerification();
      if (sortedResult.isErr()) throw sortedResult.error;

      const initialItems: AccountVerificationItem[] = sortAccountsByVerificationPriority(sortedResult.value).map(
        (account) => ({
          accountId: account.accountId,
          sourceName: account.sourceName,
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

      handler.startStream(sortedResult.value, relay);
      ctx.onAbort(() => handler.abort());

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
