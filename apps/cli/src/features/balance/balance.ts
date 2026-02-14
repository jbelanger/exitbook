import type { Account, ExchangeCredentials } from '@exitbook/core';
import {
  AccountRepository,
  ImportSessionRepository,
  TokenMetadataRepository,
  TransactionRepository,
} from '@exitbook/data';
import { BalanceService, calculateBalances } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { Command } from 'commander';
import React from 'react';
import type { z } from 'zod';

import { EventRelay } from '../../ui/shared/event-relay.js';
import { displayCliError } from '../shared/cli-error.js';
import { renderApp, runCommand } from '../shared/command-runtime.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { outputError, outputSuccess } from '../shared/json-output.js';
import { createProviderManagerWithStats } from '../shared/provider-manager-factory.js';
import { BalanceCommandOptionsSchema } from '../shared/schemas.js';
import { createSpinner, stopSpinner } from '../shared/spinner.js';
import { isJsonMode } from '../shared/utils.js';

import { buildBalanceAssetDebug } from './balance-debug.js';
import {
  BalanceApp,
  buildAccountOfflineItem,
  buildAssetDiagnostics,
  buildAssetOfflineItem,
  createBalanceAssetState,
  createBalanceOfflineState,
  createBalanceVerificationState,
  resolveAccountCredentials,
  sortAccountsByVerificationPriority,
  sortAssetsOffline,
  sortAssetsByStatus,
  type AccountVerificationItem,
  type BalanceEvent,
} from './components/index.js';

const logger = getLogger('balance');

/**
 * Balance command options validated by Zod at CLI boundary
 */
export type BalanceCommandOptions = z.infer<typeof BalanceCommandOptionsSchema>;

/**
 * Register the balance command.
 */
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
      const accountRepo = new AccountRepository(database);
      const transactionRepo = new TransactionRepository(database);
      const sessionRepo = new ImportSessionRepository(database);
      const tokenMetadataRepo = new TokenMetadataRepository(database);

      if (options.offline) {
        // Offline JSON
        const accounts = options.accountId
          ? await loadSingleAccount(accountRepo, options.accountId)
          : await loadAllAccounts(accountRepo);

        const accountsData = [];
        for (const account of accounts) {
          const { assets } = await buildOfflineAssets(account, accountRepo, transactionRepo);
          accountsData.push({
            accountId: account.id,
            sourceName: account.sourceName,
            accountType: account.accountType,
            assets: assets.map((a) => ({
              assetId: a.assetId,
              assetSymbol: a.assetSymbol,
              calculatedBalance: a.calculatedBalance,
              diagnostics: a.diagnostics,
            })),
          });
        }

        outputSuccess(
          'balance',
          { accounts: accountsData },
          {
            totalAccounts: accounts.length,
            mode: 'offline',
            filters: options.accountId ? { accountId: options.accountId } : {},
          }
        );
      } else if (options.accountId) {
        // Single-account online JSON
        const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();
        const balanceService = new BalanceService(
          accountRepo,
          transactionRepo,
          sessionRepo,
          tokenMetadataRepo,
          providerManager
        );

        try {
          let credentials: ExchangeCredentials | undefined;
          if (options.apiKey && options.apiSecret) {
            credentials = {
              apiKey: options.apiKey,
              apiSecret: options.apiSecret,
              ...(options.apiPassphrase && { apiPassphrase: options.apiPassphrase }),
            };
          }

          const result = await balanceService.verifyBalance({ accountId: options.accountId, credentials });
          if (result.isErr()) {
            outputError('balance', result.error, ExitCodes.GENERAL_ERROR);
            return;
          }

          const vr = result.value;
          const account = vr.account;

          // Build diagnostics for each asset
          const transactions = await loadAccountTransactions(account, accountRepo, transactionRepo);
          const balances = vr.comparisons.map((c) => {
            const diagnostics = buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, account.id, {
              liveBalance: c.liveBalance,
              calculatedBalance: c.calculatedBalance,
            });

            return {
              assetId: c.assetId,
              assetSymbol: c.assetSymbol,
              calculatedBalance: c.calculatedBalance,
              liveBalance: c.liveBalance,
              difference: c.difference,
              percentageDiff: c.percentageDiff,
              status: c.status,
              diagnostics,
            };
          });

          const streamMetadata = extractStreamMetadata(account);
          outputSuccess('balance', {
            status: vr.status,
            balances,
            summary: vr.summary,
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
            warnings: vr.warnings,
          });
        } finally {
          await balanceService.destroy();
          await cleanupProviderManager();
        }
      } else {
        // All-accounts online JSON
        const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();
        const balanceService = new BalanceService(
          accountRepo,
          transactionRepo,
          sessionRepo,
          tokenMetadataRepo,
          providerManager
        );

        try {
          const accounts = await loadAllAccounts(accountRepo);
          const sorted = sortAccountsByVerificationPriority(
            accounts.map((a) => ({ accountId: a.id, sourceName: a.sourceName, accountType: a.accountType, account: a }))
          );

          const accountResults = [];
          let verified = 0;
          let skipped = 0;
          let matchTotal = 0;
          let mismatchTotal = 0;

          for (const item of sorted) {
            const account = item.account;
            const { credentials, skipReason } = resolveAccountCredentials(account);

            if (skipReason) {
              skipped++;
              accountResults.push({
                accountId: account.id,
                sourceName: account.sourceName,
                accountType: account.accountType,
                status: 'skipped' as const,
                reason: skipReason,
              });
              continue;
            }

            const result = await balanceService.verifyBalance({ accountId: account.id, credentials });
            if (result.isErr()) {
              accountResults.push({
                accountId: account.id,
                sourceName: account.sourceName,
                accountType: account.accountType,
                status: 'error' as const,
                error: result.error.message,
              });
              continue;
            }

            const vr = result.value;
            verified++;
            matchTotal += vr.summary.matches;
            mismatchTotal += vr.summary.mismatches + vr.summary.warnings;

            // Build diagnostics for each asset
            const transactions = await loadAccountTransactions(account, accountRepo, transactionRepo);
            const comparisons = vr.comparisons.map((c) => {
              const diagnostics = buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, account.id, {
                liveBalance: c.liveBalance,
                calculatedBalance: c.calculatedBalance,
              });

              return {
                assetId: c.assetId,
                assetSymbol: c.assetSymbol,
                calculatedBalance: c.calculatedBalance,
                liveBalance: c.liveBalance,
                difference: c.difference,
                percentageDiff: c.percentageDiff,
                status: c.status,
                diagnostics,
              };
            });

            // Derive account status from asset comparisons
            const hasMismatch = comparisons.some((c) => c.status === 'mismatch');
            const hasWarning = comparisons.some((c) => c.status === 'warning');

            let accountStatus: 'failed' | 'warning' | 'success';
            if (hasMismatch) {
              accountStatus = 'failed';
            } else if (hasWarning) {
              accountStatus = 'warning';
            } else {
              accountStatus = 'success';
            }

            accountResults.push({
              accountId: account.id,
              sourceName: account.sourceName,
              accountType: account.accountType,
              status: accountStatus,
              summary: vr.summary,
              comparisons,
            });
          }

          outputSuccess(
            'balance',
            { accounts: accountResults },
            {
              totalAccounts: accounts.length,
              verified,
              skipped,
              matches: matchTotal,
              mismatches: mismatchTotal,
              timestamp: new Date().toISOString(),
            }
          );
        } finally {
          await balanceService.destroy();
          await cleanupProviderManager();
        }
      }
    });
  } catch (error) {
    outputError('balance', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  }
}

// ─── TUI: All-Accounts Online ───────────────────────────────────────────────

async function executeBalanceAllTUI(_options: BalanceCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const accountRepo = new AccountRepository(database);
      const transactionRepo = new TransactionRepository(database);
      const sessionRepo = new ImportSessionRepository(database);
      const tokenMetadataRepo = new TokenMetadataRepository(database);

      const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();
      const balanceService = new BalanceService(
        accountRepo,
        transactionRepo,
        sessionRepo,
        tokenMetadataRepo,
        providerManager
      );

      ctx.onCleanup(async () => {
        await balanceService.destroy();
        await cleanupProviderManager();
      });

      const accounts = await loadAllAccounts(accountRepo);

      const sorted = sortAccountsByVerificationPriority(
        accounts.map((a) => ({ accountId: a.id, sourceName: a.sourceName, accountType: a.accountType, account: a }))
      );

      const initialItems: AccountVerificationItem[] = sorted.map((item) => {
        const { skipReason } = resolveAccountCredentials(item.account);
        return {
          accountId: item.accountId,
          sourceName: item.sourceName,
          accountType: item.accountType,
          status: skipReason ? ('skipped' as const) : ('pending' as const),
          assetCount: 0,
          matchCount: 0,
          mismatchCount: 0,
          warningCount: 0,
          skipReason,
        };
      });

      const initialState = createBalanceVerificationState(initialItems);
      const relay = new EventRelay<BalanceEvent>();

      // Create abort controller to cancel verification loop on quit
      const abortController = new AbortController();

      // Track the verification loop promise so we can wait for it to finish
      const verificationPromise = runVerificationLoop(
        sorted.map((s) => s.account),
        balanceService,
        accountRepo,
        transactionRepo,
        relay,
        abortController.signal
      ).catch((error) => {
        // Ignore abort errors (expected when user quits)
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        logger.error({ error }, 'Verification loop error');
      });

      // Register cleanup to wait for verification loop to complete/abort
      ctx.onCleanup(async () => {
        abortController.abort();
        await verificationPromise;
      });

      await renderApp((unmount) =>
        React.createElement(BalanceApp, {
          initialState,
          relay,
          onQuit: () => {
            // Show aborting message in UI before unmounting
            relay.push({ type: 'ABORTING' });
            // Give React a tick to render the aborting message
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

async function runVerificationLoop(
  accounts: Account[],
  balanceService: BalanceService,
  accountRepo: AccountRepository,
  transactionRepo: TransactionRepository,
  relay: EventRelay<BalanceEvent>,
  signal: AbortSignal
): Promise<void> {
  for (const account of accounts) {
    // Check if aborted (user quit)
    if (signal.aborted) {
      const error = new Error('Verification aborted');
      error.name = 'AbortError';
      throw error;
    }

    const { credentials, skipReason } = resolveAccountCredentials(account);
    if (skipReason) {
      // Already marked as skipped in initial state
      continue;
    }

    relay.push({ type: 'VERIFICATION_STARTED', accountId: account.id });

    try {
      const result = await balanceService.verifyBalance({ accountId: account.id, credentials });

      if (result.isErr()) {
        relay.push({ type: 'VERIFICATION_ERROR', accountId: account.id, error: result.error.message });
        continue;
      }

      // Check if aborted after async operation
      if (signal.aborted) {
        const error = new Error('Verification aborted');
        error.name = 'AbortError';
        throw error;
      }

      const vr = result.value;

      // Build diagnostics for each asset
      const transactions = await loadAccountTransactions(account, accountRepo, transactionRepo);

      // Check if aborted after async operation
      if (signal.aborted) {
        const error = new Error('Verification aborted');
        error.name = 'AbortError';
        throw error;
      }
      const comparisons = vr.comparisons.map((c) => {
        const diagnostics = buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, account.id, {
          liveBalance: c.liveBalance,
          calculatedBalance: c.calculatedBalance,
        });

        return {
          assetId: c.assetId,
          assetSymbol: c.assetSymbol,
          calculatedBalance: c.calculatedBalance,
          liveBalance: c.liveBalance,
          difference: c.difference,
          percentageDiff: c.percentageDiff,
          status: c.status,
          diagnostics,
        };
      });

      // Determine account-level status
      const hasMismatch = comparisons.some((c) => c.status === 'mismatch');
      const hasWarning = comparisons.some((c) => c.status === 'warning');

      let accountStatus: AccountVerificationItem['status'];
      if (hasMismatch) {
        accountStatus = 'failed';
      } else if (hasWarning) {
        accountStatus = 'warning';
      } else {
        accountStatus = 'success';
      }

      const item: AccountVerificationItem = {
        accountId: account.id,
        sourceName: account.sourceName,
        accountType: account.accountType,
        status: accountStatus,
        assetCount: comparisons.length,
        matchCount: comparisons.filter((c) => c.status === 'match').length,
        mismatchCount: comparisons.filter((c) => c.status === 'mismatch').length,
        warningCount: comparisons.filter((c) => c.status === 'warning').length,
        comparisons: sortAssetsByStatus(comparisons),
      };

      relay.push({ type: 'VERIFICATION_COMPLETED', accountId: account.id, result: item });
    } catch (error) {
      relay.push({
        type: 'VERIFICATION_ERROR',
        accountId: account.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  relay.push({ type: 'ALL_VERIFICATIONS_COMPLETE' });
}

// ─── TUI: Single-Account Online ─────────────────────────────────────────────

async function executeBalanceSingleTUI(options: BalanceCommandOptions): Promise<void> {
  if (!options.accountId) return;

  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const accountRepo = new AccountRepository(database);
      const transactionRepo = new TransactionRepository(database);
      const sessionRepo = new ImportSessionRepository(database);
      const tokenMetadataRepo = new TokenMetadataRepository(database);

      const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();
      const balanceService = new BalanceService(
        accountRepo,
        transactionRepo,
        sessionRepo,
        tokenMetadataRepo,
        providerManager
      );

      ctx.onCleanup(async () => {
        await balanceService.destroy();
        await cleanupProviderManager();
      });

      const account = await loadSingleAccountOrFail(accountRepo, options.accountId!);

      let credentials: ExchangeCredentials | undefined;
      if (options.apiKey && options.apiSecret) {
        credentials = {
          apiKey: options.apiKey,
          apiSecret: options.apiSecret,
          ...(options.apiPassphrase && { apiPassphrase: options.apiPassphrase }),
        };
      }

      const spinner = createSpinner(`Verifying balance for ${account.sourceName} (account #${account.id})...`, false);

      const result = await balanceService.verifyBalance({ accountId: account.id, credentials });
      stopSpinner(spinner);

      if (result.isErr()) {
        console.error(`\n⚠ Error: ${result.error.message}`);
        ctx.exitCode = ExitCodes.GENERAL_ERROR;
        return;
      }

      const vr = result.value;

      const transactions = await loadAccountTransactions(account, accountRepo, transactionRepo);
      const comparisons = vr.comparisons.map((c) => {
        const diagnostics = buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, account.id, {
          liveBalance: c.liveBalance,
          calculatedBalance: c.calculatedBalance,
        });

        return {
          assetId: c.assetId,
          assetSymbol: c.assetSymbol,
          calculatedBalance: c.calculatedBalance,
          liveBalance: c.liveBalance,
          difference: c.difference,
          percentageDiff: c.percentageDiff,
          status: c.status,
          diagnostics,
        };
      });

      const sortedAssets = sortAssetsByStatus(comparisons);
      const initialState = createBalanceAssetState(
        { accountId: account.id, sourceName: account.sourceName, accountType: account.accountType },
        sortedAssets,
        { offline: false }
      );

      await renderApp((unmount) =>
        React.createElement(BalanceApp, {
          initialState,
          onQuit: unmount,
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

// ─── TUI: Offline ────────────────────────────────────────────────────────────

async function executeBalanceOfflineTUI(options: BalanceCommandOptions): Promise<void> {
  try {
    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const accountRepo = new AccountRepository(database);
      const transactionRepo = new TransactionRepository(database);

      if (options.accountId) {
        const account = await loadSingleAccountOrFail(accountRepo, options.accountId);
        const { assets } = await buildOfflineAssets(account, accountRepo, transactionRepo);
        const sortedAssets = sortAssetsOffline(assets);

        const initialState = createBalanceAssetState(
          { accountId: account.id, sourceName: account.sourceName, accountType: account.accountType },
          sortedAssets,
          { offline: true }
        );

        await ctx.closeDatabase();

        await renderApp((unmount) =>
          React.createElement(BalanceApp, {
            initialState,
            onQuit: unmount,
          })
        );
      } else {
        const accounts = await loadAllAccounts(accountRepo);
        const offlineItems = [];

        for (const account of accounts) {
          const { assets } = await buildOfflineAssets(account, accountRepo, transactionRepo);
          offlineItems.push(buildAccountOfflineItem(account, sortAssetsOffline(assets)));
        }

        const initialState = createBalanceOfflineState(offlineItems);

        await ctx.closeDatabase();

        await renderApp((unmount) =>
          React.createElement(BalanceApp, {
            initialState,
            onQuit: unmount,
          })
        );
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

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/**
 * Default empty diagnostics structure used when debug info cannot be built.
 */
function getEmptyDiagnostics() {
  return {
    txCount: 0,
    totals: { inflows: '0', outflows: '0', fees: '0', net: '0' },
    topOutflows: [],
    topInflows: [],
    topFees: [],
  };
}

/**
 * Build diagnostics for an asset, with fallback to empty diagnostics on error.
 */
function buildDiagnosticsForAsset(
  assetId: string,
  assetSymbol: string,
  transactions: import('@exitbook/core').UniversalTransactionData[],
  accountId: number,
  balances?: { calculatedBalance: string; liveBalance: string }
): ReturnType<typeof buildAssetDiagnostics> {
  const debugResult = buildBalanceAssetDebug({ assetId, assetSymbol, transactions });

  if (debugResult.isOk()) {
    return buildAssetDiagnostics(debugResult.value, balances);
  }

  logger.warn(`Failed to build diagnostics for ${assetSymbol} (account #${accountId}): ${debugResult.error.message}`);
  return getEmptyDiagnostics();
}

async function loadAllAccounts(accountRepo: AccountRepository): Promise<Account[]> {
  const result = await accountRepo.findAll();
  if (result.isErr()) throw result.error;
  // Filter to top-level accounts only (no child/derived accounts)
  return result.value.filter((a) => !a.parentAccountId);
}

async function loadSingleAccount(accountRepo: AccountRepository, accountId: number): Promise<Account[]> {
  const result = await accountRepo.findById(accountId);
  if (result.isErr()) throw result.error;
  if (!result.value) throw new Error(`Account #${accountId} not found`);
  return [result.value];
}

async function loadSingleAccountOrFail(accountRepo: AccountRepository, accountId: number): Promise<Account> {
  const result = await accountRepo.findById(accountId);
  if (result.isErr()) throw result.error;
  if (!result.value) throw new Error(`Account #${accountId} not found`);
  return result.value;
}

async function loadAccountTransactions(
  account: Account,
  accountRepo: AccountRepository,
  transactionRepo: TransactionRepository
): Promise<import('@exitbook/core').UniversalTransactionData[]> {
  const childResult = await accountRepo.findAll({ parentAccountId: account.id });
  const accountIds = [account.id];
  if (childResult.isOk()) {
    accountIds.push(...childResult.value.map((c) => c.id));
  } else {
    logger.warn(`Failed to load child accounts for account #${account.id}: ${childResult.error.message}`);
  }

  const txResult = await transactionRepo.getTransactions({ accountIds });
  if (txResult.isErr()) {
    logger.warn(`Failed to load transactions for account #${account.id}: ${txResult.error.message}`);
    return [];
  }
  return txResult.value;
}

/**
 * Extract stream/cursor metadata from account for inclusion in JSON output.
 * Returns generic metadata about what transaction streams were imported and their status.
 */
function extractStreamMetadata(account: Account): Record<string, unknown> | undefined {
  if (!account.lastCursor || Object.keys(account.lastCursor).length === 0) {
    return undefined;
  }

  const streamMetadata: Record<string, { metadata?: unknown; totalFetched: number }> = {};

  for (const [streamType, cursor] of Object.entries(account.lastCursor)) {
    streamMetadata[streamType] = {
      totalFetched: cursor.totalFetched,
      ...(cursor.metadata && { metadata: cursor.metadata }),
    };
  }

  return streamMetadata;
}

async function buildOfflineAssets(
  account: Account,
  accountRepo: AccountRepository,
  transactionRepo: TransactionRepository
): Promise<{ assets: import('./components/index.js').AssetOfflineItem[] }> {
  const transactions = await loadAccountTransactions(account, accountRepo, transactionRepo);

  if (transactions.length === 0) {
    return { assets: [] };
  }

  const { balances, assetMetadata } = calculateBalances(transactions);

  const assets = Object.entries(balances).map(([assetId, balance]) => {
    const assetSymbol = assetMetadata[assetId] ?? assetId;
    const diagnostics = buildDiagnosticsForAsset(assetId, assetSymbol, transactions, account.id);
    return buildAssetOfflineItem(assetId, assetSymbol, balance, diagnostics);
  });

  return { assets };
}
