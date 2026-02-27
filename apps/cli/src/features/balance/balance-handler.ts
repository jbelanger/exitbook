import type { Account, AccountType, ExchangeCredentials, UniversalTransactionData } from '@exitbook/core';
// eslint-disable-next-line no-restricted-imports -- ok here since this is the CLI boundary
import type { KyselyDB } from '@exitbook/data';
import {
  type AccountQueries,
  type TransactionQueries,
  createAccountQueries,
  createTokenMetadataPersistence,
  createTransactionQueries,
} from '@exitbook/data';
import { BalanceService, calculateBalances } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { EventRelay } from '../../ui/shared/event-relay.js';
import type { CommandContext } from '../shared/command-runtime.js';
import { getDataDir } from '../shared/data-dir.js';
import { createProviderManagerWithStats } from '../shared/provider-manager-factory.js';

import { buildBalanceAssetDebug } from './balance-debug.js';
import {
  buildAssetDiagnostics,
  buildAssetOfflineItem,
  resolveAccountCredentials,
  sortAccountsByVerificationPriority,
  sortAssetsByStatus,
  type AssetComparisonItem,
  type AssetOfflineItem,
  type BalanceEvent,
} from './components/index.js';

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
  comparisons: AssetComparisonItem[];
  verificationResult: import('@exitbook/ingestion').BalanceVerificationResult;
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
  static createOffline(accountRepo: AccountQueries, transactionRepo: TransactionQueries): BalanceHandler {
    return new BalanceHandler(accountRepo, transactionRepo, undefined);
  }

  static createOnline(
    accountRepo: AccountQueries,
    transactionRepo: TransactionQueries,
    balanceService: BalanceService
  ): BalanceHandler {
    return new BalanceHandler(accountRepo, transactionRepo, balanceService);
  }
  private abortController: AbortController | undefined;

  private constructor(
    private readonly accountRepo: AccountQueries,
    private readonly transactionRepo: TransactionQueries,
    private readonly balanceService: BalanceService | undefined
  ) {}

  abort(): void {
    this.abortController?.abort();
  }

  async loadAccountsForVerification(): Promise<Result<SortedVerificationAccount[], Error>> {
    const result = await this.accountRepo.findAll();
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
      for (const account of accounts) {
        const assets = await this.buildOfflineAssets(account);
        results.push({ account, assets });
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
    const service = this.requireBalanceService();

    try {
      const account = await this.loadSingleAccountOrFail(params.accountId);

      const result = await service.verifyBalance({
        accountId: account.id,
        credentials: params.credentials,
      });
      if (result.isErr()) return err(result.error);

      const vr = result.value;
      const transactions = await this.loadAccountTransactions(account);

      const comparisons: AssetComparisonItem[] = vr.comparisons.map((c) => {
        const diagnostics = this.buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, account.id, {
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
        account,
        comparisons,
        verificationResult: vr,
        streamMetadata: this.extractStreamMetadata(account),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async executeAll(): Promise<Result<AllAccountsVerificationResult, Error>> {
    const service = this.requireBalanceService();

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

        const result = await service.verifyBalance({ accountId: account.id, credentials });
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
          const diagnostics = this.buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, account.id, {
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

  async stream(accounts: SortedVerificationAccount[], relay: EventRelay<BalanceEvent>): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const service = this.requireBalanceService();

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
        const result = await service.verifyBalance({ accountId: item.accountId, credentials });

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
            const diagnostics = this.buildDiagnosticsForAsset(c.assetId, c.assetSymbol, transactions, item.accountId, {
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

  private requireBalanceService(): BalanceService {
    if (!this.balanceService) throw new Error('BalanceService not available (offline mode)');
    return this.balanceService;
  }

  private async loadAllAccounts(): Promise<Account[]> {
    const result = await this.accountRepo.findAll();
    if (result.isErr()) throw result.error;
    return result.value.filter((a) => !a.parentAccountId);
  }

  private async loadSingleAccount(accountId: number): Promise<Account[]> {
    const result = await this.accountRepo.findById(accountId);
    if (result.isErr()) throw result.error;
    if (!result.value) throw new Error(`Account #${accountId} not found`);
    return [result.value];
  }

  private async loadSingleAccountOrFail(accountId: number): Promise<Account> {
    const result = await this.accountRepo.findById(accountId);
    if (result.isErr()) throw result.error;
    if (!result.value) throw new Error(`Account #${accountId} not found`);
    return result.value;
  }

  private async loadAccountTransactions(account: Account): Promise<UniversalTransactionData[]> {
    const childResult = await this.accountRepo.findAll({ parentAccountId: account.id });
    const accountIds = [account.id];
    if (childResult.isOk()) {
      accountIds.push(...childResult.value.map((c) => c.id));
    } else {
      logger.warn(`Failed to load child accounts for account #${account.id}: ${childResult.error.message}`);
    }

    const txResult = await this.transactionRepo.getTransactions({ accountIds });
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
    accountId: number,
    balances?: { calculatedBalance: string; liveBalance: string }
  ): ReturnType<typeof buildAssetDiagnostics> {
    const debugResult = buildBalanceAssetDebug({ assetId, assetSymbol, transactions });

    if (debugResult.isOk()) {
      return buildAssetDiagnostics(debugResult.value, balances);
    }

    logger.warn(`Failed to build diagnostics for ${assetSymbol} (account #${accountId}): ${debugResult.error.message}`);
    return {
      txCount: 0,
      totals: { inflows: '0', outflows: '0', fees: '0', net: '0' },
      topOutflows: [],
      topInflows: [],
      topFees: [],
    };
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

  private async buildOfflineAssets(account: Account): Promise<AssetOfflineItem[]> {
    const transactions = await this.loadAccountTransactions(account);

    if (transactions.length === 0) {
      return [];
    }

    const { balances, assetMetadata } = calculateBalances(transactions);

    return Object.entries(balances).map(([assetId, balance]) => {
      const assetSymbol = assetMetadata[assetId] ?? assetId;
      const diagnostics = this.buildDiagnosticsForAsset(assetId, assetSymbol, transactions, account.id);
      return buildAssetOfflineItem(assetId, assetSymbol, balance, diagnostics);
    });
  }
}

export async function createBalanceHandler(
  ctx: CommandContext,
  database: KyselyDB,
  options: { needsOnline: boolean }
): Promise<BalanceHandler> {
  const accountRepo = createAccountQueries(database);
  const transactionRepo = createTransactionQueries(database);

  if (!options.needsOnline) {
    return BalanceHandler.createOffline(accountRepo, transactionRepo);
  }

  const tokenMetadataResult = await createTokenMetadataPersistence(getDataDir());
  if (tokenMetadataResult.isErr()) throw tokenMetadataResult.error;
  const { queries: tokenMetadataRepo, cleanup: cleanupTokenMetadata } = tokenMetadataResult.value;
  ctx.onCleanup(async () => cleanupTokenMetadata());

  const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();
  const balanceService = new BalanceService(database, tokenMetadataRepo, providerManager);
  ctx.onCleanup(async () => {
    await balanceService.destroy();
    await cleanupProviderManager();
  });

  return BalanceHandler.createOnline(accountRepo, transactionRepo, balanceService);
}
