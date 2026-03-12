import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { EventRelay } from '../../../ui/shared/event-relay.js';
import { displayCliError } from '../../shared/cli-error.js';
import { renderApp, runCommand } from '../../shared/command-runtime.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { outputSuccess } from '../../shared/json-output.js';
import { BalanceRefreshCommandOptionsSchema } from '../../shared/schemas.js';
import { isJsonMode } from '../../shared/utils.js';
import { BalanceApp } from '../view/balance-view-components.jsx';
import {
  type AccountVerificationItem,
  createBalanceAssetState,
  createBalanceVerificationState,
  type BalanceEvent,
} from '../view/balance-view-state.js';
import { sortAssetsByStatus, sortAccountsByVerificationPriority } from '../view/balance-view-utils.js';

import { createBalanceHandler } from './balance-handler.js';
import { buildCliExchangeCredentials } from './balance-utils.js';

type BalanceRefreshCommandOptions = z.infer<typeof BalanceRefreshCommandOptionsSchema>;

export function registerBalanceRefreshCommand(balanceCommand: Command): void {
  balanceCommand
    .command('refresh')
    .description('Rebuild calculated balances and verify them against live provider data')
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
  - Refresh is the only command that fetches live balances.
  - For child accounts, refresh operates on the owning parent balance scope.
`
    )
    .action(executeBalanceRefreshCommand);
}

async function executeBalanceRefreshCommand(rawOptions: unknown): Promise<void> {
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
    await executeBalanceRefreshJSON(options);
  } else if (options.accountId) {
    await executeBalanceRefreshSingleTUI(options);
  } else {
    await executeBalanceRefreshAllTUI(options);
  }
}

async function executeBalanceRefreshJSON(options: BalanceRefreshCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createBalanceHandler(ctx, database, { needsOnline: true });
      if (handlerResult.isErr()) {
        displayCliError('balance-refresh', handlerResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }

      const handler = handlerResult.value;

      if (options.accountId) {
        const credentials = buildCliExchangeCredentials(options);
        const result = await handler.executeSingle({ accountId: options.accountId, credentials });
        if (result.isErr()) {
          displayCliError('balance-refresh', result.error, ExitCodes.GENERAL_ERROR, 'json');
        }

        const { account, requestedAccount, comparisons, verificationResult, streamMetadata } = result.value;

        outputSuccess('balance-refresh', {
          status: verificationResult.status,
          balances: comparisons,
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

      const result = await handler.executeAll();
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

async function executeBalanceRefreshSingleTUI(options: BalanceRefreshCommandOptions): Promise<void> {
  const accountId = options.accountId;
  if (accountId === undefined) return;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createBalanceHandler(ctx, database, { needsOnline: true });
      if (handlerResult.isErr()) throw handlerResult.error;

      const handler = handlerResult.value;
      const credentials = buildCliExchangeCredentials(options);
      const result = await handler.executeSingle({ accountId, credentials });
      if (result.isErr()) {
        displayCliError('balance-refresh', result.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const { account, comparisons } = result.value;
      const sortedAssets = sortAssetsByStatus(comparisons);
      const initialState = createBalanceAssetState(
        { accountId: account.id, sourceName: account.sourceName, accountType: account.accountType },
        sortedAssets,
        { mode: 'verification' }
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

async function executeBalanceRefreshAllTUI(_options: BalanceRefreshCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createBalanceHandler(ctx, database, { needsOnline: true });
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
