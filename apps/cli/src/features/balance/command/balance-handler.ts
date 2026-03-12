import type {
  Account,
  AccountType,
  BalanceSnapshotAsset,
  ExchangeCredentials,
  UniversalTransactionData,
} from '@exitbook/core';
import { err, ok, parseDecimal, type Result } from '@exitbook/core';
import { buildBalancePorts, type DataContext } from '@exitbook/data';
import { BalanceWorkflow, type BalanceVerificationResult } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

import type { EventRelay } from '../../../ui/shared/event-relay.js';
import { openBlockchainProviderRuntime } from '../../shared/blockchain-provider-runtime.js';
import type { CommandContext } from '../../shared/command-runtime.js';
import { buildBalanceAssetDiagnosticsSummary } from '../shared/balance-diagnostics.js';
import type { AssetOfflineItem, AssetComparisonItem, BalanceEvent } from '../view/balance-view-state.js';
import {
  sortAccountsByVerificationPriority,
  resolveAccountCredentials,
  sortAssetsByStatus,
  buildAssetDiagnostics,
  buildAssetOfflineItem,
} from '../view/balance-view-utils.js';

const logger = getLogger('BalanceHandler');

export interface SortedVerificationAccount {
  account: Account;
  accountId: number;
  sourceName: string;
  accountType: AccountType;
  skipReason?: string | undefined;
}

export interface OfflineBalanceResult {
  accounts: { account: Account; assets: AssetOfflineItem[] }[];
}

export interface SingleVerificationResult {
  account: Account;
  requestedAccount?: Account | undefined;
  comparisons: AssetComparisonItem[];
  verificationResult: BalanceVerificationResult;
  streamMetadata?: Record<string, unknown> | undefined;
}

export interface AccountJsonResult {
  accountId: number;
  sourceName: string;
  accountType: AccountType;
  status: string;
  reason?: string | undefined;
  error?: string | undefined;
  summary?: unknown;
  coverage?: unknown;
  comparisons?: AssetComparisonItem[] | undefined;
  partialFailures?: unknown;
  warnings?: unknown;
}

export interface AllAccountsVerificationResult {
  accounts: AccountJsonResult[];
  totals: {
    matches: number;
    mismatches: number;
    skipped: number;
    total: number;
    verified: number;
  };
}

export class BalanceHandler {
  private abortController: AbortController | undefined;
  private streamPromise: Promise<void> | undefined;

  constructor(
    private readonly db: DataContext,
    private readonly balanceOperation: BalanceWorkflow | undefined
  ) {}

  abort(): void {
    this.abortController?.abort();
  }

  async loadAccountsForVerification(): Promise<Result<SortedVerificationAccount[], Error>> {
    const result = await this.db.accounts.findAll();
    if (result.isErr()) return err(result.error);

    const topLevel = result.value.filter((a) => !a.parentAccountId);
    const sorted = sortAccountsByVerificationPriority(
      topLevel.map((a) => ({ accountId: a.id, sourceName: a.sourceName, accountType: a.accountType, account: a }))
    );

    return ok(
      sorted.map((item) => {
        const { skipReason } = resolveAccountCredentials(item.account);
        return {
          account: item.account,
          accountId: item.accountId,
          sourceName: item.sourceName,
          accountType: item.accountType,
          skipReason,
        };
      })
    );
  }

  async executeOffline(params: { accountId?: number | undefined }): Promise<Result<OfflineBalanceResult, Error>> {
    try {
      const accounts = params.accountId ? await this.loadSingleAccount(params.accountId) : await this.loadAllAccounts();

      const results: { account: Account; assets: AssetOfflineItem[] }[] = [];
      for (const requestedAccount of accounts) {
        const scopeAccount = await this.resolveOfflineScopeAccount(requestedAccount);
        const assets = await this.buildOfflineAssets(requestedAccount, scopeAccount);
        results.push({ account: scopeAccount, assets });
      }

      return ok({ accounts: results });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async executeSingle(params: {
    accountId: number;
    credentials?: ExchangeCredentials | undefined;
  }): Promise<Result<SingleVerificationResult, Error>> {
    const operation = this.requireBalanceWorkflow();

    try {
      const requestedAccount = await this.loadSingleAccountOrFail(params.accountId);

      const result = await operation.refreshVerification({
        accountId: requestedAccount.id,
        credentials: params.credentials,
      });
      if (result.isErr()) return err(result.error);

      const vr = result.value;
      const scopeAccount = vr.account;
      const transactions = await this.loadAccountTransactions(scopeAccount);

      const comparisons: AssetComparisonItem[] = vr.comparisons.map((c) => {
        const diagnostics = this.buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, {
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

      return ok({
        account: scopeAccount,
        requestedAccount: requestedAccount.id === scopeAccount.id ? undefined : requestedAccount,
        comparisons,
        verificationResult: vr,
        streamMetadata: this.extractStreamMetadata(scopeAccount),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async executeAll(): Promise<Result<AllAccountsVerificationResult, Error>> {
    const operation = this.requireBalanceWorkflow();

    try {
      const accounts = await this.loadAllAccounts();
      const sorted = sortAccountsByVerificationPriority(
        accounts.map((a) => ({ accountId: a.id, sourceName: a.sourceName, accountType: a.accountType, account: a }))
      );

      const accountResults: AccountJsonResult[] = [];
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
            status: 'skipped',
            reason: skipReason,
          });
          continue;
        }

        const result = await operation.refreshVerification({ accountId: account.id, credentials });
        if (result.isErr()) {
          accountResults.push({
            accountId: account.id,
            sourceName: account.sourceName,
            accountType: account.accountType,
            status: 'error',
            error: result.error.message,
          });
          continue;
        }

        const vr = result.value;
        verified++;
        matchTotal += vr.summary.matches;
        mismatchTotal += vr.summary.mismatches + vr.summary.warnings + (vr.coverage.status === 'partial' ? 1 : 0);

        const transactions = await this.loadAccountTransactions(account);
        const comparisons: AssetComparisonItem[] = vr.comparisons.map((c) => {
          const diagnostics = this.buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, {
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

        accountResults.push({
          accountId: account.id,
          sourceName: account.sourceName,
          accountType: account.accountType,
          status: vr.status,
          summary: vr.summary,
          coverage: vr.coverage,
          partialFailures: vr.partialFailures,
          warnings: vr.warnings,
          comparisons,
        });
      }

      return ok({
        accounts: accountResults,
        totals: {
          total: accounts.length,
          verified,
          skipped,
          matches: matchTotal,
          mismatches: mismatchTotal,
        },
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  startStream(accounts: SortedVerificationAccount[], relay: EventRelay<BalanceEvent>): void {
    this.streamPromise = this.runStream(accounts, relay).catch((error) => {
      if (error instanceof Error && error.name === 'AbortError') return;
      logger.error({ error }, 'Verification loop error');
    });
  }

  async awaitStream(): Promise<void> {
    await this.streamPromise;
  }

  private async runStream(accounts: SortedVerificationAccount[], relay: EventRelay<BalanceEvent>): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const operation = this.requireBalanceWorkflow();

    for (const item of accounts) {
      if (signal.aborted) {
        const error = new Error('Verification aborted');
        error.name = 'AbortError';
        throw error;
      }

      if (item.skipReason) {
        continue;
      }

      const { credentials } = resolveAccountCredentials(item.account);
      relay.push({ type: 'VERIFICATION_STARTED', accountId: item.accountId });

      try {
        const result = await operation.refreshVerification({ accountId: item.accountId, credentials });

        if (result.isErr()) {
          relay.push({ type: 'VERIFICATION_ERROR', accountId: item.accountId, error: result.error.message });
          continue;
        }

        if (signal.aborted) {
          const error = new Error('Verification aborted');
          error.name = 'AbortError';
          throw error;
        }

        const vr = result.value;
        const transactions = await this.loadAccountTransactions(item.account);

        if (signal.aborted) {
          const error = new Error('Verification aborted');
          error.name = 'AbortError';
          throw error;
        }

        const comparisons = sortAssetsByStatus(
          vr.comparisons.map((c) => {
            const diagnostics = this.buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, {
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
          })
        );

        const verificationItem = {
          accountId: item.accountId,
          sourceName: item.sourceName,
          accountType: item.accountType,
          status: vr.status,
          assetCount: comparisons.length,
          matchCount: comparisons.filter((c) => c.status === 'match').length,
          mismatchCount: comparisons.filter((c) => c.status === 'mismatch').length,
          warningCount:
            comparisons.filter((c) => c.status === 'warning').length + (vr.coverage.status === 'partial' ? 1 : 0),
          comparisons,
        };

        relay.push({ type: 'VERIFICATION_COMPLETED', accountId: item.accountId, result: verificationItem });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        relay.push({
          type: 'VERIFICATION_ERROR',
          accountId: item.accountId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    relay.push({ type: 'ALL_VERIFICATIONS_COMPLETE' });
  }

  private requireBalanceWorkflow(): BalanceWorkflow {
    if (!this.balanceOperation) throw new Error('BalanceWorkflow not available in balance view mode');
    return this.balanceOperation;
  }

  private async loadAllAccounts(): Promise<Account[]> {
    const result = await this.db.accounts.findAll();
    if (result.isErr()) throw result.error;
    return result.value.filter((a) => !a.parentAccountId);
  }

  private async loadSingleAccount(accountId: number): Promise<Account[]> {
    const result = await this.db.accounts.findById(accountId);
    if (result.isErr()) throw result.error;
    if (!result.value) throw new Error(`Account #${accountId} not found`);
    return [result.value];
  }

  private async loadSingleAccountOrFail(accountId: number): Promise<Account> {
    const result = await this.db.accounts.findById(accountId);
    if (result.isErr()) throw result.error;
    if (!result.value) throw new Error(`Account #${accountId} not found`);
    return result.value;
  }

  private async loadAccountTransactions(account: Account): Promise<UniversalTransactionData[]> {
    const childResult = await this.db.accounts.findAll({ parentAccountId: account.id });
    const accountIds = [account.id];
    if (childResult.isOk()) {
      accountIds.push(...childResult.value.map((c) => c.id));
    } else {
      logger.warn(`Failed to load child accounts for account #${account.id}: ${childResult.error.message}`);
    }

    const txResult = await this.db.transactions.findAll({ accountIds });
    if (txResult.isErr()) {
      logger.warn(`Failed to load transactions for account #${account.id}: ${txResult.error.message}`);
      return [];
    }
    return txResult.value;
  }

  private buildDiagnosticsForAsset(
    assetId: string,
    assetSymbol: string,
    transactions: UniversalTransactionData[],
    balances?: { calculatedBalance: string; liveBalance: string }
  ): ReturnType<typeof buildAssetDiagnostics> {
    const diagnosticsSummary = buildBalanceAssetDiagnosticsSummary({ assetId, assetSymbol, transactions });
    return buildAssetDiagnostics(diagnosticsSummary, balances);
  }

  private extractStreamMetadata(account: Account): Record<string, unknown> | undefined {
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

  private async buildOfflineAssets(requestedAccount: Account, scopeAccount: Account): Promise<AssetOfflineItem[]> {
    const snapshotAssets = await this.loadOfflineSnapshotAssets(requestedAccount, scopeAccount);
    if (snapshotAssets.length === 0) {
      return [];
    }

    const transactions = await this.loadAccountTransactions(scopeAccount);

    return snapshotAssets.map((asset) => {
      const assetSymbol = asset.assetSymbol;
      const diagnostics = this.buildDiagnosticsForAsset(asset.assetId, assetSymbol, transactions);
      return buildAssetOfflineItem(asset.assetId, assetSymbol, parseDecimal(asset.calculatedBalance), diagnostics);
    });
  }

  private async resolveOfflineScopeAccount(account: Account): Promise<Account> {
    if (!account.parentAccountId) {
      return account;
    }

    const parentResult = await this.db.accounts.findById(account.parentAccountId);
    if (parentResult.isErr()) {
      logger.warn(
        { accountId: account.id, parentAccountId: account.parentAccountId, error: parentResult.error },
        'Failed to load parent scope account for balance view; falling back to requested account'
      );
      return account;
    }

    return parentResult.value ?? account;
  }

  private async loadOfflineSnapshotAssets(account: Account, scopeAccount: Account): Promise<BalanceSnapshotAsset[]> {
    const candidateScopeIds = [...new Set([scopeAccount.id, account.id])];

    for (const scopeAccountId of candidateScopeIds) {
      const assetsResult = await this.db.balanceSnapshots.findAssetsByScope([scopeAccountId]);
      if (assetsResult.isErr()) {
        logger.warn(
          { accountId: account.id, scopeAccountId, error: assetsResult.error },
          'Failed to load balance snapshot assets for balance view'
        );
        continue;
      }

      if (assetsResult.value.length > 0) {
        return assetsResult.value;
      }
    }

    return [];
  }
}

export async function createBalanceHandler(
  ctx: CommandContext,
  database: DataContext,
  options: { needsOnline: boolean }
): Promise<Result<BalanceHandler, Error>> {
  try {
    if (!options.needsOnline) {
      return ok(new BalanceHandler(database, undefined));
    }

    const { providerManager, cleanup: cleanupProviderManager } = await openBlockchainProviderRuntime(undefined, {
      dataDir: ctx.dataDir,
    });
    const balancePorts = buildBalancePorts(database);
    const balanceWorkflow = new BalanceWorkflow(balancePorts, providerManager);
    const handler = new BalanceHandler(database, balanceWorkflow);
    ctx.onCleanup(async () => {
      await handler.awaitStream();
      await cleanupProviderManager();
    });

    return ok(handler);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
