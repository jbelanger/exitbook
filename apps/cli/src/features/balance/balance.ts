import { BlockchainProviderManager, loadExplorerConfig } from '@exitbook/blockchain-providers';
import type { Account, ExchangeCredentials } from '@exitbook/core';
import {
  AccountRepository,
  closeDatabase,
  ImportSessionRepository,
  initializeDatabase,
  TokenMetadataRepository,
  TransactionRepository,
} from '@exitbook/data';
import { BalanceService, calculateBalances } from '@exitbook/ingestion';
import { configureLogger, getLogger, resetLoggerContext } from '@exitbook/logger';
import type { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import type { z } from 'zod';

import { EventRelay } from '../../ui/shared/event-relay.js';
import { displayCliError } from '../shared/cli-error.js';
import { ExitCodes } from '../shared/exit-codes.js';
import { OutputManager } from '../shared/output.js';
import { BalanceCommandOptionsSchema } from '../shared/schemas.js';
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

  // Configure logger
  configureLogger({
    mode: options.json ? 'json' : 'text',
    verbose: false,
    sinks: options.json ? { ui: false, structured: 'file' } : { ui: false, structured: 'file' },
  });

  if (options.json) {
    await executeBalanceJSON(options);
  } else if (options.offline) {
    await executeBalanceOfflineTUI(options);
  } else if (options.accountId) {
    await executeBalanceSingleTUI(options);
  } else {
    await executeBalanceAllTUI(options);
  }

  resetLoggerContext();
}

// ─── JSON Mode ───────────────────────────────────────────────────────────────

async function executeBalanceJSON(options: BalanceCommandOptions): Promise<void> {
  const output = new OutputManager('json');

  const database = await initializeDatabase();
  const accountRepo = new AccountRepository(database);
  const transactionRepo = new TransactionRepository(database);
  const sessionRepo = new ImportSessionRepository(database);
  const tokenMetadataRepo = new TokenMetadataRepository(database);

  try {
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

      output.json('balance', {
        data: { accounts: accountsData },
        meta: {
          totalAccounts: accounts.length,
          mode: 'offline',
          filters: options.accountId ? { accountId: options.accountId } : {},
        },
      });
    } else if (options.accountId) {
      // Single-account online JSON (preserves existing format)
      const config = loadExplorerConfig();
      const providerManager = new BlockchainProviderManager(config);
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
          output.error('balance', result.error, ExitCodes.GENERAL_ERROR);
          return;
        }

        const vr = result.value;
        const streamMetadata = extractStreamMetadata(vr.account);
        output.json('balance', {
          status: vr.status,
          balances: vr.comparisons.map((c) => ({
            assetId: c.assetId,
            currency: c.currency,
            calculatedBalance: c.calculatedBalance,
            liveBalance: c.liveBalance,
            difference: c.difference,
            percentageDiff: c.percentageDiff,
            status: c.status,
          })),
          summary: vr.summary,
          source: {
            type: (vr.account.accountType === 'blockchain' ? 'blockchain' : 'exchange') as string,
            name: vr.account.sourceName,
            address: vr.account.accountType === 'blockchain' ? vr.account.identifier : undefined,
          },
          account: {
            id: vr.account.id,
            type: vr.account.accountType,
            sourceName: vr.account.sourceName,
            identifier: vr.account.identifier,
            providerName: vr.account.providerName,
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
      }
    } else {
      // All-accounts online JSON
      const config = loadExplorerConfig();
      const providerManager = new BlockchainProviderManager(config);
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

          // Derive account status from asset comparisons (not hardcoded 'success')
          const hasMismatch = vr.comparisons.some((c) => c.status === 'mismatch');
          const hasWarning = vr.comparisons.some((c) => c.status === 'warning');
          const accountStatus = hasMismatch
            ? ('failed' as const)
            : hasWarning
              ? ('warning' as const)
              : ('success' as const);

          accountResults.push({
            accountId: account.id,
            sourceName: account.sourceName,
            accountType: account.accountType,
            status: accountStatus,
            summary: vr.summary,
            comparisons: vr.comparisons.map((c) => ({
              assetId: c.assetId,
              assetSymbol: c.assetSymbol,
              calculatedBalance: c.calculatedBalance,
              liveBalance: c.liveBalance,
              difference: c.difference,
              percentageDiff: c.percentageDiff,
              status: c.status,
            })),
          });
        }

        output.json('balance', {
          data: { accounts: accountResults },
          meta: {
            totalAccounts: accounts.length,
            verified,
            skipped,
            matches: matchTotal,
            mismatches: mismatchTotal,
            timestamp: new Date().toISOString(),
          },
        });
      } finally {
        await balanceService.destroy();
      }
    }
  } catch (error) {
    output.error('balance', error instanceof Error ? error : new Error(String(error)), ExitCodes.GENERAL_ERROR);
  } finally {
    await closeDatabase(database);
  }
}

// ─── TUI: All-Accounts Online ───────────────────────────────────────────────

async function executeBalanceAllTUI(_options: BalanceCommandOptions): Promise<void> {
  const database = await initializeDatabase();
  const accountRepo = new AccountRepository(database);
  const transactionRepo = new TransactionRepository(database);
  const sessionRepo = new ImportSessionRepository(database);
  const tokenMetadataRepo = new TokenMetadataRepository(database);

  const config = loadExplorerConfig();
  const providerManager = new BlockchainProviderManager(config);
  const balanceService = new BalanceService(
    accountRepo,
    transactionRepo,
    sessionRepo,
    tokenMetadataRepo,
    providerManager
  );

  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;

  try {
    const accounts = await loadAllAccounts(accountRepo);

    // Sort by verification priority
    const sorted = sortAccountsByVerificationPriority(
      accounts.map((a) => ({ accountId: a.id, sourceName: a.sourceName, accountType: a.accountType, account: a }))
    );

    // Build initial items: determine which can be verified and which should be skipped
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

    // Render TUI
    await new Promise<void>((resolve, reject) => {
      inkInstance = render(
        React.createElement(BalanceApp, {
          initialState,
          relay,
          onQuit: () => {
            if (inkInstance) inkInstance.unmount();
          },
        })
      );

      // Run verification loop in background
      runVerificationLoop(
        sorted.map((s) => s.account),
        balanceService,
        accountRepo,
        transactionRepo,
        relay
      ).catch((error) => {
        logger.error({ error }, 'Verification loop error');
      });

      inkInstance.waitUntilExit().then(resolve).catch(reject);
    });
  } catch (error) {
    console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        /* ignore */
      }
    }
    await balanceService.destroy();
    await closeDatabase(database);
  }
}

async function runVerificationLoop(
  accounts: Account[],
  balanceService: BalanceService,
  accountRepo: AccountRepository,
  transactionRepo: TransactionRepository,
  relay: EventRelay<BalanceEvent>
): Promise<void> {
  for (const account of accounts) {
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

      const vr = result.value;

      // Build diagnostics for each asset
      const transactions = await loadAccountTransactions(account, accountRepo, transactionRepo);
      const comparisons = vr.comparisons.map((c) => {
        const debugResult = buildBalanceAssetDebug({
          assetId: c.assetId,
          assetSymbol: c.assetSymbol,
          transactions,
        });
        const diagnostics = debugResult.isOk()
          ? buildAssetDiagnostics(debugResult.value, {
              liveBalance: c.liveBalance,
              calculatedBalance: c.calculatedBalance,
            })
          : (() => {
              logger.warn(
                `Failed to build diagnostics for ${c.assetSymbol} (account #${account.id}): ${debugResult.error.message}`
              );
              return {
                txCount: 0,
                totals: { inflows: '0', outflows: '0', fees: '0', net: '0' },
                topOutflows: [],
                topInflows: [],
                topFees: [],
              };
            })();

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
      const hasError = false;
      const hasMismatch = comparisons.some((c) => c.status === 'mismatch');
      const hasWarning = comparisons.some((c) => c.status === 'warning');
      let accountStatus: AccountVerificationItem['status'];
      if (hasError) accountStatus = 'error';
      else if (hasMismatch) accountStatus = 'failed';
      else if (hasWarning) accountStatus = 'warning';
      else accountStatus = 'success';

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

  const database = await initializeDatabase();
  const accountRepo = new AccountRepository(database);
  const transactionRepo = new TransactionRepository(database);
  const sessionRepo = new ImportSessionRepository(database);
  const tokenMetadataRepo = new TokenMetadataRepository(database);

  const config = loadExplorerConfig();
  const providerManager = new BlockchainProviderManager(config);
  const balanceService = new BalanceService(
    accountRepo,
    transactionRepo,
    sessionRepo,
    tokenMetadataRepo,
    providerManager
  );

  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;

  try {
    const account = await loadSingleAccountOrFail(accountRepo, options.accountId);

    // Build credentials
    let credentials: ExchangeCredentials | undefined;
    if (options.apiKey && options.apiSecret) {
      credentials = {
        apiKey: options.apiKey,
        apiSecret: options.apiSecret,
        ...(options.apiPassphrase && { apiPassphrase: options.apiPassphrase }),
      };
    }

    // Spinner in text mode while verifying
    const spinner = createSpinner();
    spinner?.start(`Verifying balance for ${account.sourceName} (account #${account.id})...`);

    const result = await balanceService.verifyBalance({ accountId: account.id, credentials });
    spinner?.stop();

    if (result.isErr()) {
      console.error(`\n⚠ Error: ${result.error.message}`);
      return;
    }

    const vr = result.value;

    // Build asset comparisons with diagnostics
    const transactions = await loadAccountTransactions(account, accountRepo, transactionRepo);
    const comparisons = vr.comparisons.map((c) => {
      const debugResult = buildBalanceAssetDebug({
        assetId: c.assetId,
        assetSymbol: c.assetSymbol,
        transactions,
      });
      const diagnostics = debugResult.isOk()
        ? buildAssetDiagnostics(debugResult.value, {
            liveBalance: c.liveBalance,
            calculatedBalance: c.calculatedBalance,
          })
        : (() => {
            logger.warn(
              `Failed to build diagnostics for ${c.assetSymbol} (account #${account.id}): ${debugResult.error.message}`
            );
            return {
              txCount: 0,
              totals: { inflows: '0', outflows: '0', fees: '0', net: '0' },
              topOutflows: [],
              topInflows: [],
              topFees: [],
            };
          })();

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

    // Render TUI
    await new Promise<void>((resolve, reject) => {
      inkInstance = render(
        React.createElement(BalanceApp, {
          initialState,
          onQuit: () => {
            if (inkInstance) inkInstance.unmount();
          },
        })
      );

      inkInstance.waitUntilExit().then(resolve).catch(reject);
    });
  } catch (error) {
    console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        /* ignore */
      }
    }
    await balanceService.destroy();
    await closeDatabase(database);
  }
}

// ─── TUI: Offline ────────────────────────────────────────────────────────────

async function executeBalanceOfflineTUI(options: BalanceCommandOptions): Promise<void> {
  const database = await initializeDatabase();
  const accountRepo = new AccountRepository(database);
  const transactionRepo = new TransactionRepository(database);

  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;

  try {
    if (options.accountId) {
      // Single account offline → asset view
      const account = await loadSingleAccountOrFail(accountRepo, options.accountId);
      const { assets } = await buildOfflineAssets(account, accountRepo, transactionRepo);
      const sortedAssets = sortAssetsOffline(assets);

      const initialState = createBalanceAssetState(
        { accountId: account.id, sourceName: account.sourceName, accountType: account.accountType },
        sortedAssets,
        { offline: true }
      );

      await new Promise<void>((resolve, reject) => {
        inkInstance = render(
          React.createElement(BalanceApp, {
            initialState,
            onQuit: () => {
              if (inkInstance) inkInstance.unmount();
            },
          })
        );
        inkInstance.waitUntilExit().then(resolve).catch(reject);
      });
    } else {
      // All accounts offline → accounts view
      const accounts = await loadAllAccounts(accountRepo);
      const offlineItems = [];

      for (const account of accounts) {
        const { assets } = await buildOfflineAssets(account, accountRepo, transactionRepo);
        offlineItems.push(buildAccountOfflineItem(account, sortAssetsOffline(assets)));
      }

      const initialState = createBalanceOfflineState(offlineItems);

      await new Promise<void>((resolve, reject) => {
        inkInstance = render(
          React.createElement(BalanceApp, {
            initialState,
            onQuit: () => {
              if (inkInstance) inkInstance.unmount();
            },
          })
        );
        inkInstance.waitUntilExit().then(resolve).catch(reject);
      });
    }
  } catch (error) {
    console.error('\n⚠ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch {
        /* ignore */
      }
    }
    await closeDatabase(database);
  }
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

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
  const childResult = await accountRepo.findByParent(account.id);
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
    const debugResult = buildBalanceAssetDebug({ assetId, assetSymbol, transactions });
    const diagnostics = debugResult.isOk()
      ? buildAssetDiagnostics(debugResult.value)
      : (() => {
          logger.warn(
            `Failed to build diagnostics for ${assetSymbol} (account #${account.id}): ${debugResult.error.message}`
          );
          return {
            txCount: 0,
            totals: { inflows: '0', outflows: '0', fees: '0', net: '0' },
            topOutflows: [],
            topInflows: [],
            topFees: [],
          };
        })();

    return buildAssetOfflineItem(assetId, assetSymbol, balance, diagnostics);
  });

  return { assets };
}

function createSpinner(): { start: (msg: string) => void; stop: () => void } | undefined {
  // Simple spinner for text mode
  try {
    let interval: ReturnType<typeof setInterval> | undefined;
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;

    return {
      start(msg: string) {
        interval = setInterval(() => {
          process.stderr.write(`\r${frames[frameIndex % frames.length]} ${msg}`);
          frameIndex++;
        }, 80);
      },
      stop() {
        if (interval) {
          clearInterval(interval);
          process.stderr.write('\r\x1b[K'); // Clear line
        }
      },
    };
  } catch {
    return undefined;
  }
}
