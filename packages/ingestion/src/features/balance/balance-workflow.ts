import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type {
  Account,
  BalanceSnapshot,
  BalanceSnapshotAsset,
  ExchangeCredentials,
  ImportSession,
  Transaction,
} from '@exitbook/core';
import { createExchangeClient } from '@exitbook/exchange-providers';
import { parseAssetId, parseDecimal, wrapError } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { BalancePorts } from '../../ports/balance-ports.js';
import { loadBalanceScopeContext as loadSharedBalanceScopeContext } from '../../ports/balance-scope.js';

import {
  fetchBlockchainBalance,
  fetchChildAccountsBalance,
  fetchExchangeBalance,
  type UnifiedBalanceSnapshot,
} from './balance-fetch-utils.js';
import {
  type BalanceComparison,
  type BalancePartialFailure,
  type BalanceVerificationResult,
  calculateBalances,
  compareBalances,
  convertBalancesToDecimals,
  createVerificationResult,
} from './balance-utils.js';

const logger = getLogger('BalanceWorkflow');

export interface BalanceParams {
  accountId: number;
  credentials?: ExchangeCredentials | undefined;
}

interface BalanceScopeContext {
  memberAccounts: Account[];
  requestedAccount: Account;
  scopeAccount: Account;
}

interface BalanceRebuildResult {
  assetCount: number;
  requestedAccount: Account;
  scopeAccount: Account;
}

/**
 * Rebuild and refresh persisted balance snapshots for a scope.
 */
export class BalanceWorkflow {
  constructor(
    private readonly ports: BalancePorts,
    private readonly providerRuntime: IBlockchainProviderRuntime
  ) {}

  /**
   * Rebuild the calculated-only balance snapshot for the requested scope.
   */
  async rebuildCalculatedSnapshot(params: BalanceParams): Promise<Result<BalanceRebuildResult, Error>> {
    const scopeContextResult = await this.loadBalanceScopeContext(params.accountId);
    if (scopeContextResult.isErr()) return err(scopeContextResult.error);

    const scopeContext = scopeContextResult.value;
    logger.info(
      {
        requestedAccountId: scopeContext.requestedAccount.id,
        scopeAccountId: scopeContext.scopeAccount.id,
        platformKey: scopeContext.scopeAccount.platformKey,
      },
      'Rebuilding calculated balance snapshot'
    );

    return this.runScopeProjection(
      scopeContext.scopeAccount.id,
      'Failed to rebuild calculated balance snapshot',
      async () => {
        const calculatedResult = await this.calculateBalancesFromTransactions(scopeContext);
        if (calculatedResult.isErr()) return err(calculatedResult.error);

        const persistResult = await this.persistCalculatedSnapshot(scopeContext, calculatedResult.value);
        if (persistResult.isErr()) return err(persistResult.error);

        return ok({
          requestedAccount: scopeContext.requestedAccount,
          scopeAccount: scopeContext.scopeAccount,
          assetCount: Object.keys(calculatedResult.value.balances).length,
        });
      }
    );
  }

  /**
   * Refresh live balance verification for the requested scope.
   */
  async refreshVerification(params: BalanceParams): Promise<Result<BalanceVerificationResult, Error>> {
    const scopeContextResult = await this.loadBalanceScopeContext(params.accountId);
    if (scopeContextResult.isErr()) return err(scopeContextResult.error);

    const scopeContext = scopeContextResult.value;
    logger.info(
      {
        requestedAccountId: scopeContext.requestedAccount.id,
        scopeAccountId: scopeContext.scopeAccount.id,
        platformKey: scopeContext.scopeAccount.platformKey,
        accountType: scopeContext.scopeAccount.accountType,
      },
      'Refreshing balance verification'
    );

    return this.runScopeProjection(scopeContext.scopeAccount.id, 'Failed to refresh balance verification', async () => {
      const calculatedResult = await this.calculateBalancesFromTransactions(scopeContext);
      if (calculatedResult.isErr()) return err(calculatedResult.error);

      const persistCalculatedResult = await this.persistCalculatedSnapshot(scopeContext, calculatedResult.value);
      if (persistCalculatedResult.isErr()) return err(persistCalculatedResult.error);

      const liveBalanceSupportResult = this.resolveLiveBalanceSupport(scopeContext);
      if (liveBalanceSupportResult.isErr()) return err(liveBalanceSupportResult.error);

      if (!liveBalanceSupportResult.value.supported) {
        const persistUnavailableResult = await this.persistUnavailableSnapshot(
          scopeContext,
          calculatedResult.value,
          liveBalanceSupportResult.value.reason
        );
        if (persistUnavailableResult.isErr()) return err(persistUnavailableResult.error);

        const assetCount = Object.keys(calculatedResult.value.balances).length;
        const requestedAddressCount = this.getRequestedAddressCount(scopeContext);
        const warning = liveBalanceSupportResult.value.reason;

        return ok({
          account: scopeContext.scopeAccount,
          mode: 'calculated-only',
          timestamp: Date.now(),
          status: 'warning',
          comparisons: [],
          coverage: {
            confidence: 'low',
            failedAddresses: requestedAddressCount,
            failedAssets: assetCount,
            overallCoverageRatio: 0,
            parsedAssets: 0,
            requestedAddresses: requestedAddressCount,
            status: 'partial',
            successfulAddresses: 0,
            totalAssets: assetCount,
          },
          summary: {
            matches: 0,
            mismatches: 0,
            totalCurrencies: assetCount,
            warnings: 0,
          },
          suggestion: `Stored calculated balances only. Add a balance-capable provider for ${scopeContext.scopeAccount.platformKey} to enable live verification.`,
          warnings: [warning],
        });
      }

      const liveBalanceResult = await this.fetchLiveBalance(scopeContext, params.credentials);
      if (liveBalanceResult.isErr()) return err(liveBalanceResult.error);

      const liveSnapshot = liveBalanceResult.value;
      const parseResult = convertBalancesToDecimals(liveSnapshot.balances);
      const partialFailures: BalancePartialFailure[] = [
        ...(liveSnapshot.partialFailures ?? []),
        ...parseResult.partialFailures,
      ];
      const coverage = this.buildVerificationCoverage(liveSnapshot, parseResult.coverage);

      let liveBalances = parseResult.balances;
      let liveAssetMetadata = liveSnapshot.assetMetadata;
      let { balances: calculatedBalances, assetMetadata: calculatedAssetMetadata } = calculatedResult.value;

      const excludedInfoResult = await this.getExcludedAssetInfo(scopeContext);
      if (excludedInfoResult.isErr()) return err(excludedInfoResult.error);

      const { balanceAdjustments, spamAssetIds } = excludedInfoResult.value;
      if (Object.keys(balanceAdjustments).length > 0) {
        const excludedAssets = Object.keys(balanceAdjustments);
        logger.info(
          {
            scopeAccountId: scopeContext.scopeAccount.id,
            excludedAssets,
          },
          'Applying excluded transaction balance adjustments to live balance'
        );
        liveBalances = applyExcludedBalanceAdjustments(liveBalances, balanceAdjustments);
      }

      if (spamAssetIds.size > 0) {
        logger.info(
          { scopeAccountId: scopeContext.scopeAccount.id, spamAssetCount: spamAssetIds.size },
          'Filtering scam assets from balance comparison'
        );
        liveBalances = removeAssetsById(liveBalances, spamAssetIds);
        calculatedBalances = removeAssetsById(calculatedBalances, spamAssetIds);
        liveAssetMetadata = removeAssetsById(liveAssetMetadata, spamAssetIds);
        calculatedAssetMetadata = removeAssetsById(calculatedAssetMetadata, spamAssetIds);
      }

      const mergedAssetMetadata = { ...calculatedAssetMetadata, ...liveAssetMetadata };
      const comparisons = compareBalances(calculatedBalances, liveBalances, mergedAssetMetadata);

      const warnings: string[] = [];
      this.appendPartialCoverageWarnings(warnings, coverage);
      this.appendTokenCoverageWarnings(warnings, scopeContext.scopeAccount);

      const lastImportTimestampResult = await this.getLastImportTimestamp(scopeContext);
      if (lastImportTimestampResult.isErr()) return err(lastImportTimestampResult.error);

      const lastImportTimestamp = lastImportTimestampResult.value;
      const hasTransactions = Object.keys(calculatedBalances).length > 0;
      const verificationResult = createVerificationResult(
        scopeContext.scopeAccount,
        comparisons,
        lastImportTimestamp,
        hasTransactions,
        warnings.length > 0 ? warnings : undefined,
        coverage,
        partialFailures.length > 0 ? partialFailures : undefined
      );

      const persistVerifiedResult = await this.persistVerifiedSnapshot(
        scopeContext,
        calculatedBalances,
        comparisons,
        verificationResult.status,
        coverage,
        warnings.length > 0 ? warnings : undefined,
        verificationResult.suggestion
      );
      if (persistVerifiedResult.isErr()) return err(persistVerifiedResult.error);

      return ok(verificationResult);
    });
  }

  // --- Private helpers -------------------------------------------------------

  private async runScopeProjection<T>(
    scopeAccountId: number,
    errorMessage: string,
    operation: () => Promise<Result<T, Error>>
  ): Promise<Result<T, Error>> {
    const buildingResult = await this.ports.markBuilding(scopeAccountId);
    if (buildingResult.isErr()) return err(buildingResult.error);

    try {
      const operationResult = await operation();
      if (operationResult.isErr()) {
        await this.markScopeFailed(scopeAccountId, operationResult.error);
        return err(operationResult.error);
      }

      const freshResult = await this.ports.markFresh(scopeAccountId);
      if (freshResult.isErr()) {
        await this.markScopeFailed(scopeAccountId, freshResult.error);
        return err(freshResult.error);
      }

      return ok(operationResult.value);
    } catch (error) {
      const wrappedError = wrapUnknownError(error, errorMessage);
      await this.markScopeFailed(scopeAccountId, wrappedError);
      return err(wrappedError);
    }
  }

  private async markScopeFailed(scopeAccountId: number, cause: Error): Promise<void> {
    const failedResult = await this.ports.markFailed(scopeAccountId);
    if (failedResult.isErr()) {
      logger.warn(
        { scopeAccountId, cause, projectionStateError: failedResult.error },
        'Failed to mark balance scope projection as failed'
      );
    }
  }

  private async loadBalanceScopeContext(accountId: number): Promise<Result<BalanceScopeContext, Error>> {
    const requestedAccountResult = await this.ports.findById(accountId);
    if (requestedAccountResult.isErr()) return err(requestedAccountResult.error);
    if (!requestedAccountResult.value) return err(new Error(`No account found with ID ${accountId}`));

    return loadSharedBalanceScopeContext(requestedAccountResult.value, this.ports);
  }

  private buildVerificationCoverage(
    liveSnapshot: UnifiedBalanceSnapshot,
    parseCoverage: { failedAssetCount: number; parsedAssetCount: number; totalAssetCount: number }
  ): BalanceVerificationResult['coverage'] {
    const requestedAddresses = liveSnapshot.coverage?.requestedAddressCount ?? 1;
    const successfulAddresses = liveSnapshot.coverage?.successfulAddressCount ?? requestedAddresses;
    const failedAddresses =
      liveSnapshot.coverage?.failedAddressCount ?? Math.max(0, requestedAddresses - successfulAddresses);

    const totalAssets = parseCoverage.totalAssetCount;
    const parsedAssets = parseCoverage.parsedAssetCount;
    const failedAssets = parseCoverage.failedAssetCount;

    const addressCoverageRatio = requestedAddresses > 0 ? successfulAddresses / requestedAddresses : 1;
    const assetCoverageRatio = totalAssets > 0 ? parsedAssets / totalAssets : 1;
    const overallCoverageRatio = Math.min(addressCoverageRatio, assetCoverageRatio);

    const status: 'complete' | 'partial' = failedAddresses > 0 || failedAssets > 0 ? 'partial' : 'complete';
    let confidence: 'high' | 'medium' | 'low';
    if (status === 'complete' && overallCoverageRatio >= 0.99) {
      confidence = 'high';
    } else if (overallCoverageRatio >= 0.8) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      status,
      confidence,
      requestedAddresses,
      successfulAddresses,
      failedAddresses,
      totalAssets,
      parsedAssets,
      failedAssets,
      overallCoverageRatio,
    };
  }

  private appendPartialCoverageWarnings(warnings: string[], coverage: BalanceVerificationResult['coverage']): void {
    if (coverage.failedAddresses > 0) {
      warnings.push(
        `Live balance verification is partial: ${coverage.failedAddresses}/${coverage.requestedAddresses} addresses failed to fetch.`
      );
    }

    if (coverage.failedAssets > 0) {
      warnings.push(
        `Live balance verification is partial: ${coverage.failedAssets}/${coverage.totalAssets} assets failed to parse. Invalid assets were excluded from live comparison.`
      );
    }
  }

  private appendTokenCoverageWarnings(warnings: string[], account: Account): void {
    if (account.accountType === 'exchange-api' || account.accountType === 'exchange-csv') {
      return;
    }

    const providers = this.providerRuntime.getProviders(account.platformKey);
    const supportsTokenBalances = providers.some((p) =>
      p.capabilities.supportedOperations.includes('getAddressTokenBalances')
    );
    const supportsTokenTransactions = providers.some((p) => {
      if (!p.capabilities.supportedOperations.includes('getAddressTransactions')) return false;
      return p.capabilities.supportedTransactionTypes?.includes('token') ?? false;
    });

    if (supportsTokenTransactions && !supportsTokenBalances) {
      warnings.push(
        `Token balances are not available for ${account.platformKey}. Live balance includes native assets only; token mismatches may be false negatives.`
      );
    }
  }

  private async getLastImportTimestamp(scopeContext: BalanceScopeContext): Promise<Result<number | undefined, Error>> {
    const accountIds = scopeContext.memberAccounts.map((account) => account.id);

    try {
      const sessionsResult: Result<ImportSession[], Error> = await this.ports.findByAccountIds(accountIds);

      if (sessionsResult.isErr()) {
        return wrapError(
          sessionsResult.error,
          `Failed to fetch import sessions for balance verification scope ${scopeContext.scopeAccount.id}`
        );
      }

      const completedSessions = sessionsResult.value.filter((s) => s.status === 'completed');
      if (completedSessions.length === 0) return ok(undefined);

      const mostRecent = completedSessions.reduce((best, current) => {
        if (!current.completedAt) return best;
        if (!best.completedAt) return current;
        return current.completedAt > best.completedAt ? current : best;
      });
      return ok(mostRecent.completedAt?.getTime());
    } catch (error) {
      return wrapError(
        error,
        `Failed to fetch import sessions for balance verification scope ${scopeContext.scopeAccount.id}`
      );
    }
  }

  private async calculateBalancesFromTransactions(
    scopeContext: BalanceScopeContext
  ): Promise<Result<{ assetMetadata: Record<string, string>; balances: Record<string, Decimal> }, Error>> {
    try {
      const accountIds = scopeContext.memberAccounts.map((account) => account.id);

      const sessionsResult: Result<ImportSession[], Error> = await this.ports.findByAccountIds(accountIds);
      if (sessionsResult.isErr()) return err(sessionsResult.error);

      const allSessions = sessionsResult.value;
      if (allSessions.length === 0) {
        return err(buildMissingImportSessionsError(scopeContext.scopeAccount.platformKey));
      }

      if (!allSessions.some((s) => s.status === 'completed')) {
        return err(buildNoCompletedImportSessionsError(scopeContext.scopeAccount.platformKey));
      }

      const transactionsResult: Result<Transaction[], Error> = await this.ports.findTransactionsByAccountIds({
        accountIds,
      });
      if (transactionsResult.isErr()) return err(transactionsResult.error);

      const allTransactions = transactionsResult.value;
      if (allTransactions.length === 0) {
        logger.warn(
          `No transactions found for ${scopeContext.scopeAccount.platformKey} - calculated balance will be empty`
        );
        return ok({ balances: {}, assetMetadata: {} });
      }

      const childAccountCount = accountIds.length - 1;
      const accountInfo =
        childAccountCount > 0
          ? `${scopeContext.scopeAccount.platformKey} (parent + ${childAccountCount} child accounts)`
          : scopeContext.scopeAccount.platformKey;
      logger.info(
        `Calculating balances from ${allTransactions.length} transactions across all completed sessions for ${accountInfo}`
      );

      return ok(calculateBalances(allTransactions));
    } catch (error) {
      return wrapError(error, 'Failed to calculate balances from transactions');
    }
  }

  private async fetchExchangeLiveBalance(
    account: Account,
    credentials?: ExchangeCredentials
  ): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    if (!credentials && !account.credentials) {
      return err(
        new Error(`No stored provider credentials found for exchange account ${account.id} (${account.platformKey}).`)
      );
    }
    const clientResult = createExchangeClient(
      account.platformKey,
      credentials ?? account.credentials ?? { apiKey: '', apiSecret: '' }
    );
    if (clientResult.isErr()) return err(clientResult.error);

    return fetchExchangeBalance(clientResult.value, account.platformKey);
  }

  private async fetchBlockchainLiveBalance(
    scopeContext: BalanceScopeContext
  ): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    const childAccounts = scopeContext.memberAccounts.filter((account) => account.id !== scopeContext.scopeAccount.id);
    if (childAccounts.length > 0) {
      logger.info(`Fetching balances for ${childAccounts.length} child accounts`);
      return fetchChildAccountsBalance(
        this.providerRuntime,
        scopeContext.scopeAccount.platformKey,
        scopeContext.scopeAccount.identifier,
        childAccounts
      );
    }

    return fetchBlockchainBalance(
      this.providerRuntime,
      scopeContext.scopeAccount.platformKey,
      scopeContext.scopeAccount.identifier
    );
  }

  private async getExcludedAssetInfo(
    scopeContext: BalanceScopeContext
  ): Promise<Result<{ balanceAdjustments: Record<string, Decimal>; spamAssetIds: Set<string> }, Error>> {
    try {
      const accountIds = scopeContext.memberAccounts.map((account) => account.id);

      const sessionsResult: Result<ImportSession[], Error> = await this.ports.findByAccountIds(accountIds);
      if (sessionsResult.isErr()) return err(sessionsResult.error);

      const allSessions = sessionsResult.value;
      if (allSessions.length === 0 || !allSessions.some((s) => s.status === 'completed')) {
        return ok({ balanceAdjustments: {}, spamAssetIds: new Set() });
      }

      const excludedTxResult: Result<Transaction[], Error> = await this.ports.findTransactionsByAccountIds({
        accountIds,
        includeExcluded: true,
      });
      if (excludedTxResult.isErr()) return err(excludedTxResult.error);

      return ok(collectExcludedAssetInfo(excludedTxResult.value));
    } catch (error) {
      return wrapError(error, 'Failed to collect excluded asset info');
    }
  }

  private async fetchLiveBalance(
    scopeContext: BalanceScopeContext,
    credentials?: ExchangeCredentials
  ): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    const account = scopeContext.scopeAccount;
    const isExchange = account.accountType === 'exchange-api' || account.accountType === 'exchange-csv';
    return isExchange
      ? this.fetchExchangeLiveBalance(account, credentials)
      : this.fetchBlockchainLiveBalance(scopeContext);
  }

  private resolveLiveBalanceSupport(
    scopeContext: BalanceScopeContext
  ): Result<{ supported: true } | { reason: string; supported: false }, Error> {
    if (scopeContext.scopeAccount.accountType !== 'blockchain') {
      return ok({ supported: true });
    }

    const blockchain = scopeContext.scopeAccount.platformKey;
    const hasRegisteredBalanceSupport = this.providerRuntime.hasRegisteredOperationSupport(
      blockchain,
      'getAddressBalances'
    );

    if (!hasRegisteredBalanceSupport) {
      return ok({
        supported: false,
        reason: `Live balance verification is unavailable for ${blockchain}: no registered provider supports getAddressBalances. Stored calculated balances only.`,
      });
    }

    const providers = this.providerRuntime.getProviders(blockchain);
    const supportsBalance = providers.some((provider) =>
      provider.capabilities.supportedOperations.includes('getAddressBalances')
    );

    if (supportsBalance) {
      return ok({ supported: true });
    }

    return err(
      new Error(
        `Failed to initialize a balance-capable provider for ${blockchain}. A registered provider supports getAddressBalances, but none could be initialized. Check provider configuration and API keys.`
      )
    );
  }

  private getRequestedAddressCount(scopeContext: BalanceScopeContext): number {
    const childAccounts = scopeContext.memberAccounts.filter((account) => account.id !== scopeContext.scopeAccount.id);
    return childAccounts.length > 0 ? childAccounts.length : 1;
  }

  private async persistCalculatedSnapshot(
    scopeContext: BalanceScopeContext,
    calculated: { assetMetadata: Record<string, string>; balances: Record<string, Decimal> }
  ): Promise<Result<void, Error>> {
    try {
      const now = new Date();
      const snapshot: BalanceSnapshot = {
        scopeAccountId: scopeContext.scopeAccount.id,
        calculatedAt: now,
        verificationStatus: 'never-run',
        matchCount: 0,
        warningCount: 0,
        mismatchCount: 0,
      };

      const assets: BalanceSnapshotAsset[] = Object.entries(calculated.balances).map(([assetId, balance]) => ({
        scopeAccountId: scopeContext.scopeAccount.id,
        assetId,
        assetSymbol: calculated.assetMetadata[assetId] ?? assetId,
        calculatedBalance: balance.toFixed(),
        excludedFromAccounting: false,
      }));

      const replaceResult = await this.ports.replaceSnapshot({ snapshot, assets });
      if (replaceResult.isErr()) return err(replaceResult.error);

      logger.info(
        { scopeAccountId: scopeContext.scopeAccount.id, assetCount: assets.length },
        'Calculated balance snapshot persisted'
      );
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to persist calculated balance snapshot');
    }
  }

  private async persistUnavailableSnapshot(
    scopeContext: BalanceScopeContext,
    calculated: { assetMetadata: Record<string, string>; balances: Record<string, Decimal> },
    reason: string
  ): Promise<Result<void, Error>> {
    try {
      const now = new Date();
      const assetCount = Object.keys(calculated.balances).length;
      const requestedAddressCount = this.getRequestedAddressCount(scopeContext);
      const suggestion = `Add a balance-capable provider for ${scopeContext.scopeAccount.platformKey} to enable live verification.`;

      const snapshot: BalanceSnapshot = {
        scopeAccountId: scopeContext.scopeAccount.id,
        calculatedAt: now,
        lastRefreshAt: now,
        verificationStatus: 'unavailable',
        coverageStatus: 'partial',
        coverageConfidence: 'low',
        requestedAddressCount,
        successfulAddressCount: 0,
        failedAddressCount: requestedAddressCount,
        totalAssetCount: assetCount,
        parsedAssetCount: 0,
        failedAssetCount: assetCount,
        matchCount: 0,
        warningCount: 0,
        mismatchCount: 0,
        statusReason: reason,
        suggestion,
        lastError: reason,
      };

      const assets: BalanceSnapshotAsset[] = Object.entries(calculated.balances).map(([assetId, balance]) => ({
        scopeAccountId: scopeContext.scopeAccount.id,
        assetId,
        assetSymbol: calculated.assetMetadata[assetId] ?? assetId,
        calculatedBalance: balance.toFixed(),
        comparisonStatus: 'unavailable',
        excludedFromAccounting: false,
      }));

      const replaceResult = await this.ports.replaceSnapshot({ snapshot, assets });
      if (replaceResult.isErr()) return err(replaceResult.error);

      logger.warn(
        {
          scopeAccountId: scopeContext.scopeAccount.id,
          platformKey: scopeContext.scopeAccount.platformKey,
          assetCount,
          reason,
        },
        'Persisted calculated-only balance snapshot because live verification is unavailable'
      );
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to persist unavailable balance snapshot');
    }
  }

  private async persistVerifiedSnapshot(
    scopeContext: BalanceScopeContext,
    calculatedBalances: Record<string, Decimal>,
    comparisons: BalanceComparison[],
    status: 'success' | 'warning' | 'failed',
    coverage: BalanceVerificationResult['coverage'],
    warnings?: string[],
    suggestion?: string
  ): Promise<Result<void, Error>> {
    try {
      const now = new Date();
      const snapshot: BalanceSnapshot = {
        scopeAccountId: scopeContext.scopeAccount.id,
        calculatedAt: now,
        lastRefreshAt: now,
        verificationStatus: toSnapshotVerificationStatus(status),
        coverageStatus: coverage.status,
        coverageConfidence: coverage.confidence,
        requestedAddressCount: coverage.requestedAddresses,
        successfulAddressCount: coverage.successfulAddresses,
        failedAddressCount: coverage.failedAddresses,
        totalAssetCount: coverage.totalAssets,
        parsedAssetCount: coverage.parsedAssets,
        failedAssetCount: coverage.failedAssets,
        matchCount: comparisons.filter((comparison) => comparison.status === 'match').length,
        warningCount: comparisons.filter((comparison) => comparison.status === 'warning').length,
        mismatchCount: comparisons.filter((comparison) => comparison.status === 'mismatch').length,
        statusReason: warnings?.join(' '),
        suggestion,
      };

      const assets: BalanceSnapshotAsset[] = comparisons.map((comparison) => ({
        scopeAccountId: scopeContext.scopeAccount.id,
        assetId: comparison.assetId,
        assetSymbol: comparison.assetSymbol,
        calculatedBalance: calculatedBalances[comparison.assetId]?.toFixed() ?? comparison.calculatedBalance,
        liveBalance: comparison.liveBalance,
        difference: comparison.difference,
        comparisonStatus: comparison.status,
        excludedFromAccounting: false,
      }));

      const replaceResult = await this.ports.replaceSnapshot({
        snapshot,
        assets,
      });

      if (replaceResult.isErr()) return err(replaceResult.error);

      logger.info(
        { scopeAccountId: scopeContext.scopeAccount.id, assetCount: assets.length },
        'Verified balance snapshot persisted'
      );
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to persist verified balance snapshot');
    }
  }
}

function buildMissingImportSessionsError(platformKey: string): Error {
  return new Error(
    `No imported transaction data found for ${platformKey}. Run "exitbook import" first, then rerun "exitbook accounts refresh".`
  );
}

function buildNoCompletedImportSessionsError(platformKey: string): Error {
  return new Error(
    `No completed import found for ${platformKey}. Run "exitbook import" successfully before refreshing balances.`
  );
}

// --- Pure helpers ------------------------------------------------------------

function applyExcludedBalanceAdjustments(
  liveBalances: Record<string, Decimal>,
  balanceAdjustments: Record<string, Decimal>
): Record<string, Decimal> {
  const adjusted = { ...liveBalances };

  for (const [asset, adjustment] of Object.entries(balanceAdjustments)) {
    const currentBalance = adjusted[asset] ?? parseDecimal('0');
    const nextBalance = currentBalance.minus(adjustment);

    if (nextBalance.isZero()) {
      delete adjusted[asset];
      continue;
    }

    adjusted[asset] = nextBalance;
  }

  return adjusted;
}

function removeAssetsById<T>(balances: Record<string, T>, assetIds: Set<string>): Record<string, T> {
  const filtered: Record<string, T> = {};
  for (const [assetId, balance] of Object.entries(balances)) {
    if (!assetIds.has(assetId)) {
      filtered[assetId] = balance;
    }
  }
  return filtered;
}

/**
 * Collect excluded asset amounts and spam assetIds from transactions.
 */
function collectExcludedAssetInfo(transactions: Transaction[]): {
  balanceAdjustments: Record<string, Decimal>;
  spamAssetIds: Set<string>;
} {
  const excludedTransactions = transactions.filter((tx) => tx.excludedFromAccounting === true);
  const balanceAdjustments: Record<string, Decimal> = {};
  const spamAssetIds = new Set<string>();

  const shouldMarkScamAsset = (assetId: string): boolean => {
    const parsed = parseAssetId(assetId);
    if (parsed.isErr()) {
      logger.warn({ assetId, error: parsed.error }, 'Failed to parse assetId for scam filtering, skipping');
      return false;
    }
    if (parsed.value.namespace !== 'blockchain') return false;
    // Never exclude native assets from balance comparisons (e.g., ETH gas fees on spam txs)
    if (parsed.value.ref === 'native') return false;
    return true;
  };

  for (const tx of excludedTransactions) {
    const isScam =
      tx.isSpam === true || (tx.diagnostics?.some((diagnostic) => diagnostic.code === 'SCAM_TOKEN') ?? false);

    if (isScam) {
      for (const inflow of tx.movements.inflows ?? []) {
        if (shouldMarkScamAsset(inflow.assetId)) spamAssetIds.add(inflow.assetId);
      }
      for (const outflow of tx.movements.outflows ?? []) {
        if (shouldMarkScamAsset(outflow.assetId)) spamAssetIds.add(outflow.assetId);
      }
    }

    for (const inflow of tx.movements.inflows ?? []) {
      const existing = balanceAdjustments[inflow.assetId] ?? parseDecimal('0');
      balanceAdjustments[inflow.assetId] = existing.plus(inflow.grossAmount);
    }

    for (const outflow of tx.movements.outflows ?? []) {
      const existing = balanceAdjustments[outflow.assetId] ?? parseDecimal('0');
      balanceAdjustments[outflow.assetId] = existing.minus(outflow.grossAmount);
    }

    for (const fee of tx.fees ?? []) {
      if (fee.settlement === 'on-chain') {
        continue;
      }

      const existing = balanceAdjustments[fee.assetId] ?? parseDecimal('0');
      balanceAdjustments[fee.assetId] = existing.minus(fee.amount);
    }
  }

  return { balanceAdjustments, spamAssetIds };
}

function toSnapshotVerificationStatus(status: 'success' | 'warning' | 'failed'): BalanceSnapshot['verificationStatus'] {
  switch (status) {
    case 'success':
      return 'match';
    case 'warning':
      return 'warning';
    case 'failed':
      return 'mismatch';
  }
}

function wrapUnknownError(error: unknown, message: string): Error {
  const wrapped = wrapError(error, message);
  return wrapped.isErr() ? wrapped.error : new Error(message);
}
