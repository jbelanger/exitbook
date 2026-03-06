import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type {
  Account,
  ExchangeCredentials,
  ImportSession,
  UniversalTransactionData,
  VerificationMetadata,
} from '@exitbook/core';
import { parseAssetId, wrapError, type Currency } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { createExchangeClient } from '@exitbook/exchange-providers';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

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

const logger = getLogger('BalanceOperation');

export interface BalanceParams {
  accountId: number;
  credentials?: ExchangeCredentials | undefined;
}

export type { BalanceComparison, BalanceVerificationResult };

/**
 * Compare live vs calculated balances and persist verification metadata.
 *
 * Fetches live balances from providers, calculates from stored transactions,
 * compares, and writes verification results to accounts.
 *
 * Uses DataContext directly — pure app-layer orchestration.
 */
export class BalanceOperation {
  constructor(
    private readonly db: DataContext,
    private readonly providerManager: BlockchainProviderManager
  ) {}

  /**
   * Verify balance for a single account: fetch live → calculate from transactions →
   * subtract scam tokens → compare → persist results.
   */
  async verifyBalance(params: BalanceParams): Promise<Result<BalanceVerificationResult, Error>> {
    try {
      // 1. Fetch the account
      const accountResult = await this.db.accounts.findById(params.accountId);
      if (accountResult.isErr()) return err(accountResult.error);
      if (!accountResult.value) return err(new Error(`No account found with ID ${params.accountId}`));

      const account = accountResult.value;
      logger.info(`Verifying balance for account ${account.id}: ${account.sourceName} (${account.accountType})`);

      // 2. Fetch live balance from source
      const isExchange = account.accountType === 'exchange-api' || account.accountType === 'exchange-csv';
      const liveBalanceResult = isExchange
        ? await this.fetchExchangeLiveBalance(account, params.credentials)
        : await this.fetchBlockchainLiveBalance(account);

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

      // 3. Calculate balance from transactions
      const calculatedResult = await this.calculateBalancesFromTransactions(account);
      if (calculatedResult.isErr()) return err(calculatedResult.error);

      let { balances: calculatedBalances, assetMetadata: calculatedAssetMetadata } = calculatedResult.value;

      // 4. Subtract scam tokens from live balance
      const excludedInfoResult = await this.getExcludedAssetInfo(account);
      if (excludedInfoResult.isErr()) return err(excludedInfoResult.error);

      const { amounts: excludedAmounts, spamAssetIds } = excludedInfoResult.value;
      if (Object.keys(excludedAmounts).length > 0) {
        const excludedAssets = Object.keys(excludedAmounts);
        logger.info(
          `Subtracting excluded amounts from live balance for ${excludedAssets.length} assets: ${excludedAssets.join(', ')}`
        );
        liveBalances = subtractExcludedAmounts(liveBalances, excludedAmounts);
      }

      if (spamAssetIds.size > 0) {
        logger.info(`Filtering ${spamAssetIds.size} scam assets from balance comparison`);
        liveBalances = removeAssetsById(liveBalances, spamAssetIds);
        calculatedBalances = removeAssetsById(calculatedBalances, spamAssetIds);
        liveAssetMetadata = removeAssetsById(liveAssetMetadata, spamAssetIds);
        calculatedAssetMetadata = removeAssetsById(calculatedAssetMetadata, spamAssetIds);
      }

      // 5. Compare balances
      const mergedAssetMetadata = { ...calculatedAssetMetadata, ...liveAssetMetadata };
      const comparisons = compareBalances(calculatedBalances, liveBalances, mergedAssetMetadata);

      const warnings: string[] = [];
      this.appendPartialCoverageWarnings(warnings, coverage);

      if (!isExchange) {
        const providers = this.providerManager.getProviders(account.sourceName);
        const supportsTokenBalances = providers.some((p) =>
          p.capabilities.supportedOperations.includes('getAddressTokenBalances')
        );
        const supportsTokenTransactions = providers.some((p) => {
          if (!p.capabilities.supportedOperations.includes('getAddressTransactions')) return false;
          return p.capabilities.supportedTransactionTypes?.includes('token') ?? false;
        });

        if (supportsTokenTransactions && !supportsTokenBalances) {
          warnings.push(
            `Token balances are not available for ${account.sourceName}. Live balance includes native assets only; token mismatches may be false negatives.`
          );
        }
      }

      // 6. Get last import timestamp for suggestion generation
      const lastImportTimestamp = await this.getLastImportTimestamp(account);

      // 7. Assemble verification result
      const hasTransactions = Object.keys(calculatedBalances).length > 0;
      const verificationResult = createVerificationResult(
        account,
        comparisons,
        lastImportTimestamp,
        hasTransactions,
        warnings.length > 0 ? warnings : undefined,
        coverage,
        partialFailures.length > 0 ? partialFailures : undefined
      );

      // 8. Persist verification results
      const adjustedLiveBalancesStr = decimalRecordToStringRecord(liveBalances);
      const persistResult = await this.persistVerificationResults(
        account,
        calculatedBalances,
        adjustedLiveBalancesStr,
        comparisons,
        verificationResult.status,
        verificationResult.suggestion
      );

      if (persistResult.isErr()) {
        logger.warn(`Failed to persist verification results: ${persistResult.error.message}`);
      }

      return ok(verificationResult);
    } catch (error) {
      return wrapError(error, 'Failed to verify balance');
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

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

  private async getLastImportTimestamp(account: Account): Promise<number | undefined> {
    try {
      const childAccountsResult = await this.db.accounts.findAll({ parentAccountId: account.id });
      if (childAccountsResult.isErr()) {
        logger.warn(`Failed to fetch child accounts: ${childAccountsResult.error.message}`);
        return undefined;
      }

      const accountIds = [account.id, ...childAccountsResult.value.map((child) => child.id)];
      const sessionsResult: Result<ImportSession[], Error> = await this.db.importSessions.findAll({ accountIds });

      if (sessionsResult.isErr()) {
        logger.warn(`Failed to fetch import sessions: ${sessionsResult.error.message}`);
        return undefined;
      }

      const completedSessions = sessionsResult.value.filter((s) => s.status === 'completed');
      if (completedSessions.length === 0) return undefined;

      const mostRecent = completedSessions.reduce((best, current) => {
        if (!current.completedAt) return best;
        if (!best.completedAt) return current;
        return current.completedAt > best.completedAt ? current : best;
      });
      return mostRecent.completedAt?.getTime();
    } catch (error) {
      logger.warn(`Error fetching last import timestamp: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async calculateBalancesFromTransactions(
    account: Account
  ): Promise<Result<{ assetMetadata: Record<string, string>; balances: Record<string, Decimal> }, Error>> {
    try {
      const accountIdsResult = await this.resolveAccountScope(account);
      if (accountIdsResult.isErr()) return err(accountIdsResult.error);
      const accountIds = accountIdsResult.value;

      const sessionsResult: Result<ImportSession[], Error> = await this.db.importSessions.findAll({ accountIds });
      if (sessionsResult.isErr()) return err(sessionsResult.error);

      const allSessions = sessionsResult.value;
      if (allSessions.length === 0) {
        return err(new Error(`No import sessions found for ${account.sourceName}`));
      }

      if (!allSessions.some((s) => s.status === 'completed')) {
        return err(new Error(`No completed import session found for ${account.sourceName}`));
      }

      const transactionsResult: Result<UniversalTransactionData[], Error> = await this.db.transactions.findAll({
        accountIds,
      });
      if (transactionsResult.isErr()) return err(transactionsResult.error);

      const allTransactions = transactionsResult.value;
      if (allTransactions.length === 0) {
        logger.warn(`No transactions found for ${account.sourceName} - calculated balance will be empty`);
        return ok({ balances: {}, assetMetadata: {} });
      }

      const childAccountCount = accountIds.length - 1;
      const accountInfo =
        childAccountCount > 0
          ? `${account.sourceName} (parent + ${childAccountCount} child accounts)`
          : account.sourceName;
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
        new Error(`No credentials found for account ${account.id}. This should not happen for exchange-api accounts.`)
      );
    }
    const clientResult = createExchangeClient(
      account.sourceName,
      credentials ?? account.credentials ?? { apiKey: '', apiSecret: '' }
    );
    if (clientResult.isErr()) return err(clientResult.error);

    return fetchExchangeBalance(clientResult.value, account.sourceName);
  }

  private async fetchBlockchainLiveBalance(account: Account): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    const childAccountsResult = await this.db.accounts.findAll({ parentAccountId: account.id });
    if (childAccountsResult.isErr()) return err(childAccountsResult.error);

    const childAccounts = childAccountsResult.value;

    if (childAccounts.length > 0) {
      logger.info(`Fetching balances for ${childAccounts.length} child accounts`);
      return fetchChildAccountsBalance(this.providerManager, account.sourceName, account.identifier, childAccounts);
    }

    return fetchBlockchainBalance(this.providerManager, account.sourceName, account.identifier);
  }

  private async getExcludedAssetInfo(
    account: Account
  ): Promise<Result<{ amounts: Record<string, Decimal>; spamAssetIds: Set<string> }, Error>> {
    try {
      const accountIdsResult = await this.resolveAccountScope(account);
      if (accountIdsResult.isErr()) return err(accountIdsResult.error);
      const accountIds = accountIdsResult.value;

      const sessionsResult: Result<ImportSession[], Error> = await this.db.importSessions.findAll({ accountIds });
      if (sessionsResult.isErr()) return err(sessionsResult.error);

      const allSessions = sessionsResult.value;
      if (allSessions.length === 0 || !allSessions.some((s) => s.status === 'completed')) {
        return ok({ amounts: {}, spamAssetIds: new Set() });
      }

      const excludedTxResult: Result<UniversalTransactionData[], Error> = await this.db.transactions.findAll({
        accountIds,
        includeExcluded: true,
      });
      if (excludedTxResult.isErr()) return err(excludedTxResult.error);

      return ok(collectExcludedAssetInfo(excludedTxResult.value));
    } catch (error) {
      return wrapError(error, 'Failed to collect excluded asset info');
    }
  }

  private async persistVerificationResults(
    account: Account,
    calculatedBalances: Record<string, Decimal>,
    liveBalances: Record<string, string>,
    comparisons: BalanceComparison[],
    status: 'success' | 'warning' | 'failed',
    suggestion?: string
  ): Promise<Result<void, Error>> {
    try {
      const calculatedBalancesStr = decimalRecordToStringRecord(calculatedBalances);
      const discrepancies = comparisons
        .filter((c) => c.status !== 'match')
        .map((c) => ({
          assetId: c.assetId,
          assetSymbol: c.assetSymbol as Currency,
          calculated: c.calculatedBalance,
          live: c.liveBalance,
          difference: c.difference,
        }));

      const verificationMetadata: VerificationMetadata = {
        current_balance: calculatedBalancesStr,
        last_verification: {
          status: status === 'success' ? 'match' : 'mismatch',
          verified_at: new Date().toISOString(),
          calculated_balance: calculatedBalancesStr,
          live_balance: liveBalances,
          discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
          suggestions: suggestion ? [suggestion] : undefined,
        },
      };

      const updateResult: Result<void, Error> = await this.db.accounts.update(account.id, {
        verificationMetadata,
        lastBalanceCheckAt: new Date(),
      });

      if (updateResult.isErr()) return err(updateResult.error);

      logger.info(`Verification results persisted to account ${account.id}`);
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to persist verification results');
    }
  }

  private async resolveAccountScope(account: Account): Promise<Result<number[], Error>> {
    const childAccountsResult = await this.db.accounts.findAll({ parentAccountId: account.id });
    if (childAccountsResult.isErr()) return err(childAccountsResult.error);
    return ok([account.id, ...childAccountsResult.value.map((child) => child.id)]);
  }
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

function decimalRecordToStringRecord(record: Record<string, Decimal>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = value.toFixed();
  }
  return result;
}

function subtractExcludedAmounts(
  liveBalances: Record<string, Decimal>,
  excludedAmounts: Record<string, Decimal>
): Record<string, Decimal> {
  const adjusted = { ...liveBalances };

  for (const [asset, excludedAmount] of Object.entries(excludedAmounts)) {
    if (adjusted[asset]) {
      const newBalance = adjusted[asset].minus(excludedAmount);
      if (newBalance.lte(0)) {
        delete adjusted[asset];
      } else {
        adjusted[asset] = newBalance;
      }
    }
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
function collectExcludedAssetInfo(transactions: UniversalTransactionData[]): {
  amounts: Record<string, Decimal>;
  spamAssetIds: Set<string>;
} {
  const excludedTransactions = transactions.filter((tx) => tx.excludedFromAccounting === true);
  const amounts: Record<string, Decimal> = {};
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
    const isScam = tx.isSpam === true || (tx.notes?.some((note) => note.type === 'SCAM_TOKEN') ?? false);

    if (isScam) {
      for (const inflow of tx.movements.inflows ?? []) {
        if (shouldMarkScamAsset(inflow.assetId)) spamAssetIds.add(inflow.assetId);
      }
      for (const outflow of tx.movements.outflows ?? []) {
        if (shouldMarkScamAsset(outflow.assetId)) spamAssetIds.add(outflow.assetId);
      }
    }

    // Only count inflows (received scam tokens)
    for (const inflow of tx.movements.inflows ?? []) {
      const existing = amounts[inflow.assetId];
      amounts[inflow.assetId] = existing ? existing.plus(inflow.grossAmount) : inflow.grossAmount;
    }
  }

  return { amounts, spamAssetIds };
}
