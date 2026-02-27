import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { EventRelay } from '../../ui/shared/event-relay.js';
import { displayCliError } from '../shared/cli-error.js';
import { renderApp, runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputSuccess } from '../shared/json-output.js';
import { BalanceCommandOptionsSchema } from '../shared/schemas.js';
import { isJsonMode } from '../shared/utils.js';

import { createBalanceHandler } from './balance-handler.js';
import {
  BalanceApp,
  buildAccountOfflineItem,
  createBalanceAssetState,
  createBalanceOfflineState,
  createBalanceVerificationState,
  sortAssetsOffline,
  sortAssetsByStatus,
  type AccountVerificationItem,
  type BalanceEvent,
} from './components/index.js';

/**
 * Balance command options validated by Zod at CLI boundary
 */
export type BalanceCommandOptions = z.infer<typeof BalanceCommandOptionsSchema>;

export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Verify balances against live data or view calculated balances')
    .option('--account-id <id>', 'Verify specific account (default: all accounts)')
    .option('--offline', 'Skip live balance fetching; show calculated balances only')
    .option('--api-key <key>', 'API key for exchange (overrides .env)')
    .option('--api-secret <secret>', 'API secret for exchange (overrides .env)')
    .option('--api-passphrase <passphrase>', 'API passphrase for exchange (if required)')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook balance                                # verify all accounts
  $ exitbook balance --account-id 5                 # verify single account
  $ exitbook balance --offline                      # view calculated balances (no API calls)
  $ exitbook balance --offline --account-id 5       # single account offline
  $ exitbook balance --account-id 7 --api-key KEY --api-secret SECRET
                                                    # exchange account with credentials
  $ exitbook balance --json                         # JSON output

Notes:
  - Diagnostics are always available inline — no separate flags needed.
  - Use "exitbook accounts view" to list account IDs and types.
`
    )
    .action(executeBalanceCommand);
}

async function executeBalanceCommand(rawOptions: unknown): Promise<void> {
  const isJson = isJsonMode(rawOptions);

  const validationResult = BalanceCommandOptionsSchema.safeParse(rawOptions);
  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0];
    displayCliError(
      'balance',
      new Error(firstError?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJson ? 'json' : 'text'
    );
  }

  const options = validationResult.data;

  if (options.json) {
    await executeBalanceJSON(options);
  } else if (options.offline) {
    await executeBalanceOfflineTUI(options);
  } else if (options.accountId) {
    await executeBalanceSingleTUI(options);
  } else {
    await executeBalanceAllTUI(options);
  }
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executeBalanceJSON(options: BalanceCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createBalanceHandler(ctx, database, { needsOnline: !options.offline });
      if (handlerResult.isErr()) {
        displayCliError('balance', handlerResult.error, ExitCodes.GENERAL_ERROR, 'json');
      }
      const handler = handlerResult.value;

      if (options.offline) {
        const result = await handler.executeOffline({ accountId: options.accountId });
        if (result.isErr()) {
          displayCliError('balance', result.error, ExitCodes.GENERAL_ERROR, 'json');
        }

        const accountsData = result.value.accounts.map((a) => ({
          accountId: a.account.id,
          sourceName: a.account.sourceName,
          accountType: a.account.accountType,
          assets: a.assets.map((asset) => ({
            assetId: asset.assetId,
            assetSymbol: asset.assetSymbol,
            calculatedBalance: asset.calculatedBalance,
            diagnostics: asset.diagnostics,
          })),
        }));

        outputSuccess(
          'balance',
          { accounts: accountsData },
          {
            totalAccounts: result.value.accounts.length,
            mode: 'offline',
            filters: options.accountId ? { accountId: options.accountId } : {},
          }
        );
      } else if (options.accountId) {
        let credentials: import('@exitbook/core').ExchangeCredentials | undefined;
        if (options.apiKey && options.apiSecret) {
          credentials = {
            apiKey: options.apiKey,
            apiSecret: options.apiSecret,
            ...(options.apiPassphrase && { apiPassphrase: options.apiPassphrase }),
          };
        }

        const result = await handler.executeSingle({ accountId: options.accountId, credentials });
        if (result.isErr()) {
          displayCliError('balance', result.error, ExitCodes.GENERAL_ERROR, 'json');
        }

        const { account, comparisons, verificationResult: vr, streamMetadata } = result.value;

        outputSuccess('balance', {
          status: vr.status,
          balances: comparisons,
          summary: vr.summary,
          coverage: vr.coverage,
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
          meta: {
            timestamp: new Date(vr.timestamp).toISOString(),
            ...(streamMetadata && { streams: streamMetadata }),
          },
          suggestion: vr.suggestion,
          partialFailures: vr.partialFailures,
          warnings: vr.warnings,
        });
      } else {
        const result = await handler.executeAll();
        if (result.isErr()) {
          displayCliError('balance', result.error, ExitCodes.GENERAL_ERROR, 'json');
        }

        outputSuccess(
          'balance',
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
      }
    });
  } catch (error) {
    displayCliError(
      'balance',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'json'
    );
  }
}

// ─── TUI: Offline ────────────────────────────────────────────────────────────

async function executeBalanceOfflineTUI(options: BalanceCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createBalanceHandler(ctx, database, { needsOnline: false });
      if (handlerResult.isErr()) throw handlerResult.error;
      const handler = handlerResult.value;

      const result = await handler.executeOffline({ accountId: options.accountId });
      if (result.isErr()) throw result.error;

      await ctx.closeDatabase();

      if (options.accountId) {
        const item = result.value.accounts[0];
        if (!item) throw new Error(`Account #${options.accountId} not found`);

        const initialState = createBalanceAssetState(
          { accountId: item.account.id, sourceName: item.account.sourceName, accountType: item.account.accountType },
          sortAssetsOffline(item.assets),
          { offline: true }
        );

        await renderApp((unmount) => React.createElement(BalanceApp, { initialState, onQuit: unmount }));
      } else {
        const offlineItems = result.value.accounts.map((a) =>
          buildAccountOfflineItem(a.account, sortAssetsOffline(a.assets))
        );
        const initialState = createBalanceOfflineState(offlineItems);

        await renderApp((unmount) => React.createElement(BalanceApp, { initialState, onQuit: unmount }));
      }
    });
  } catch (error) {
    displayCliError(
      'balance',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

// ─── TUI: Single-Account Online ─────────────────────────────────────────────

async function executeBalanceSingleTUI(options: BalanceCommandOptions): Promise<void> {
  if (!options.accountId) return;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createBalanceHandler(ctx, database, { needsOnline: true });
      if (handlerResult.isErr()) throw handlerResult.error;
      const handler = handlerResult.value;

      let credentials: import('@exitbook/core').ExchangeCredentials | undefined;
      if (options.apiKey && options.apiSecret) {
        credentials = {
          apiKey: options.apiKey,
          apiSecret: options.apiSecret,
          ...(options.apiPassphrase && { apiPassphrase: options.apiPassphrase }),
        };
      }

      const result = await handler.executeSingle({ accountId: options.accountId!, credentials });
      if (result.isErr()) {
        displayCliError('balance', result.error, ExitCodes.GENERAL_ERROR, 'text');
      }

      const { account, comparisons } = result.value;
      const sortedAssets = sortAssetsByStatus(comparisons);
      const initialState = createBalanceAssetState(
        { accountId: account.id, sourceName: account.sourceName, accountType: account.accountType },
        sortedAssets,
        { offline: false }
      );

      await renderApp((unmount) => React.createElement(BalanceApp, { initialState, onQuit: unmount }));
    });
  } catch (error) {
    displayCliError(
      'balance',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}

// ─── TUI: All-Accounts Online ───────────────────────────────────────────────

async function executeBalanceAllTUI(_options: BalanceCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createBalanceHandler(ctx, database, { needsOnline: true });
      if (handlerResult.isErr()) throw handlerResult.error;
      const handler = handlerResult.value;

      const sortedResult = await handler.loadAccountsForVerification();
      if (sortedResult.isErr()) throw sortedResult.error;

      const initialItems: AccountVerificationItem[] = sortedResult.value.map((a) => ({
        accountId: a.accountId,
        sourceName: a.sourceName,
        accountType: a.accountType,
        status: a.skipReason ? ('skipped' as const) : ('pending' as const),
        assetCount: 0,
        matchCount: 0,
        mismatchCount: 0,
        warningCount: 0,
        skipReason: a.skipReason,
      }));
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
      'balance',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      'text'
    );
  }
}
