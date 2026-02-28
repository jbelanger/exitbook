import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type {
  Account,
  ExchangeCredentials,
  ImportSession,
  SourceParams,
  UniversalTransactionData,
  VerificationMetadata,
} from '@exitbook/core';
import { parseAssetId, wrapError, type Currency } from '@exitbook/core';
import { type DataContext } from '@exitbook/data';
import { createExchangeClient } from '@exitbook/exchange-providers';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { calculateBalances } from './balance-calculator.js';
import {
  type BalancePartialFailure,
  convertBalancesToDecimals,
  fetchBlockchainBalance,
  fetchChildAccountsBalance,
  fetchExchangeBalance,
  type UnifiedBalanceSnapshot,
} from './balance-utils.js';
import { compareBalances, createVerificationResult } from './balance-verifier.js';
import type { BalanceComparison, BalanceVerificationResult } from './balance-verifier.types.js';

const logger = getLogger('BalanceService');

/**
 * Parameters for balance verification - now account-centric
 */
export interface BalanceServiceParams {
  accountId: number;
  credentials?: ExchangeCredentials | undefined;
}

/**
 * Balance service - handles balance verification operations.
 * Orchestrates fetching live balances, calculating from transactions, and comparing.
 */
export class BalanceService {
  constructor(
    private readonly db: DataContext,
    private providerManager: BlockchainProviderManager
  ) {}

  /**
   * Execute the balance verification operation.
   * Fetches live balance, calculates balance from transactions, and compares them.
   */
  async verifyBalance(params: BalanceServiceParams): Promise<Result<BalanceVerificationResult, Error>> {
    try {
      // 1. Fetch the account by ID
      const accountResult = await this.db.accounts.findById(params.accountId);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }

      if (!accountResult.value) {
        return err(new Error(`No account found with ID ${params.accountId}`));
      }

      const account = accountResult.value;
      logger.info(`Verifying balance for account ${account.id}: ${account.sourceName} (${account.accountType})`);

      // 2. Fetch live balance from source
      const isExchange = account.accountType === 'exchange-api' || account.accountType === 'exchange-csv';
      const liveBalanceResult = isExchange
        ? await this.fetchExchangeBalance(account, params.credentials)
        : await this.fetchBlockchainBalance(account);

      if (liveBalanceResult.isErr()) {
        return err(liveBalanceResult.error);
      }

      const liveSnapshot = liveBalanceResult.value;
      const parseResult = convertBalancesToDecimals(liveSnapshot.balances);
      const partialFailures: BalancePartialFailure[] = [
        ...(liveSnapshot.partialFailures ?? []),
        ...parseResult.partialFailures,
      ];
      const coverage = this.buildVerificationCoverage(liveSnapshot, parseResult.coverage);

      let liveBalances = parseResult.balances;
      let liveAssetMetadata = liveSnapshot.assetMetadata;

      // 3. Fetch and calculate balance from transactions
      const calculatedBalancesResult = await this.calculateBalancesFromTransactions(account);
      if (calculatedBalancesResult.isErr()) {
        return err(calculatedBalancesResult.error);
      }

      let { balances: calculatedBalances, assetMetadata: calculatedAssetMetadata } = calculatedBalancesResult.value;

      // 4. Get excluded asset amounts (scam tokens) and subtract them from live balance
      const excludedInfoResult = await this.getExcludedAssetInfo(account);
      if (excludedInfoResult.isErr()) {
        return err(excludedInfoResult.error);
      }

      const { amounts: excludedAmounts, spamAssetIds: spamAssetIds } = excludedInfoResult.value;
      if (Object.keys(excludedAmounts).length > 0) {
        const excludedAssets = Object.keys(excludedAmounts);
        logger.info(
          `Subtracting excluded amounts from live balance for ${excludedAssets.length} assets: ${excludedAssets.join(', ')}`
        );
        liveBalances = this.subtractExcludedAmounts(liveBalances, excludedAmounts);
      }

      if (spamAssetIds.size > 0) {
        logger.info(`Filtering ${spamAssetIds.size} scam assets from balance comparison`);
        liveBalances = this.removeAssetsById(liveBalances, spamAssetIds);
        calculatedBalances = this.removeAssetsById(calculatedBalances, spamAssetIds);
        liveAssetMetadata = this.removeAssetsById(liveAssetMetadata, spamAssetIds);
        calculatedAssetMetadata = this.removeAssetsById(calculatedAssetMetadata, spamAssetIds);
      }

      // 5. Compare balances (merge metadata from both calculated and live)
      const mergedAssetMetadata = { ...calculatedAssetMetadata, ...liveAssetMetadata };
      const comparisons = compareBalances(calculatedBalances, liveBalances, mergedAssetMetadata);

      const warnings: string[] = [];
      this.appendPartialCoverageWarnings(warnings, coverage);

      if (!isExchange) {
        const providers = this.providerManager.getProviders(account.sourceName);
        const supportsTokenBalances = providers.some((provider) =>
          provider.capabilities.supportedOperations.includes('getAddressTokenBalances')
        );
        const supportsTokenTransactions = providers.some((provider) => {
          if (!provider.capabilities.supportedOperations.includes('getAddressTransactions')) {
            return false;
          }
          return provider.capabilities.supportedTransactionTypes?.includes('token') ?? false;
        });

        if (supportsTokenTransactions && !supportsTokenBalances) {
          warnings.push(
            `Token balances are not available for ${account.sourceName}. Live balance includes native assets only; token mismatches may be false negatives.`
          );
        }
      }

      // 6. Get last import timestamp for suggestion generation
      const lastImportTimestamp = await this.getLastImportTimestamp(account);

      // 7. Create verification result
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

      // 8. Persist verification results to the account with adjusted live balances
      // Convert adjusted liveBalances (after scam token subtraction) to strings for storage
      const adjustedLiveBalancesStr = this.decimalRecordToStringRecord(liveBalances);
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
        // Don't fail the whole operation if persistence fails
      }

      return ok(verificationResult);
    } catch (error) {
      return wrapError(error, 'Failed to verify balance');
    }
  }

  /**
   * Cleanup resources (stops provider manager timers/health checks).
   *
   * Idempotent: safe to call multiple times.
   */
  async destroy(): Promise<void> {
    await this.providerManager.destroy();
  }

  private buildVerificationCoverage(
    liveSnapshot: UnifiedBalanceSnapshot,
    parseCoverage: {
      failedAssetCount: number;
      parsedAssetCount: number;
      totalAssetCount: number;
    }
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

  /**
   * Get the timestamp of the most recent completed import for the account.
   * For xpub/parent accounts, checks child account sessions as well.
   */
  private async getLastImportTimestamp(account: Account): Promise<number | undefined> {
    try {
      // Get child accounts if this is a parent account (e.g., xpub)
      const childAccountsResult = await this.db.accounts.findAll({ parentAccountId: account.id });
      if (childAccountsResult.isErr()) {
        logger.warn(`Failed to fetch child accounts: ${childAccountsResult.error.message}`);
        return undefined;
      }

      const childAccounts = childAccountsResult.value;
      const accountIds = [account.id, ...childAccounts.map((child) => child.id)];

      // Find sessions for all accounts in one query
      const sessionsResult: Result<ImportSession[], Error> = await this.db.importSessions.findAll({ accountIds });

      if (sessionsResult.isErr()) {
        logger.warn(`Failed to fetch import sessions: ${sessionsResult.error.message}`);
        return undefined;
      }

      const sessions = sessionsResult.value;
      const completedSessions = sessions.filter((s) => s.status === 'completed');

      if (completedSessions.length === 0) {
        return undefined;
      }

      const mostRecentSession = this.findMostRecentCompletedSession(completedSessions);
      return mostRecentSession?.completedAt?.getTime();
    } catch (error) {
      logger.warn(`Error fetching last import timestamp: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /**
   * Calculate balances from transactions in the database.
   * Aggregates transactions from ALL completed sessions for the account and its child accounts.
   * Returns both balances and asset metadata for display.
   */
  private async calculateBalancesFromTransactions(
    account: Account
  ): Promise<Result<{ assetMetadata: Record<string, string>; balances: Record<string, Decimal> }, Error>> {
    try {
      const accountIdsResult = await this.resolveAccountScope(account);
      if (accountIdsResult.isErr()) return err(accountIdsResult.error);
      const accountIds = accountIdsResult.value;

      // Find sessions for all accounts in one query (avoids N+1)
      const sessionsResult: Result<ImportSession[], Error> = await this.db.importSessions.findAll({ accountIds });
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const allSessions = sessionsResult.value;

      if (allSessions.length === 0) {
        return err(new Error(`No import sessions found for ${account.sourceName}`));
      }

      // Check if there's at least one completed session
      const hasCompletedSession = allSessions.some((s) => s.status === 'completed');
      if (!hasCompletedSession) {
        return err(new Error(`No completed import session found for ${account.sourceName}`));
      }

      // Fetch ALL transactions for all accounts in one query (avoids N+1)
      const transactionsResult: Result<UniversalTransactionData[], Error> = await this.db.transactions.findAll({
        accountIds,
      });

      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

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
      const calculationResult = calculateBalances(allTransactions);

      return ok(calculationResult);
    } catch (error) {
      return wrapError(error, 'Failed to calculate balances from transactions');
    }
  }

  /**
   * Fetch balance from an exchange.
   */
  private async fetchExchangeBalance(
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
    if (clientResult.isErr()) {
      return err(clientResult.error);
    }

    const client = clientResult.value;
    return fetchExchangeBalance(client, account.sourceName);
  }

  /**
   * Fetch balance from a blockchain.
   * For accounts with child accounts (e.g., xpub with derived addresses), fetches balances from all child accounts and sums them.
   */
  private async fetchBlockchainBalance(account: Account): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    // Check if this account has child accounts (e.g., from xpub import)
    const childAccountsResult = await this.db.accounts.findAll({ parentAccountId: account.id });
    if (childAccountsResult.isErr()) {
      return err(childAccountsResult.error);
    }

    const childAccounts = childAccountsResult.value;

    if (childAccounts.length > 0) {
      logger.info(`Fetching balances for ${childAccounts.length} child accounts`);

      // Don't pass providerName - allow failover to all available providers for accurate balance verification
      return fetchChildAccountsBalance(this.providerManager, account.sourceName, account.identifier, childAccounts);
    }

    // Standard single-address balance fetch
    // Don't pass providerName - allow failover to all available providers for accurate balance verification
    return fetchBlockchainBalance(this.providerManager, account.sourceName, account.identifier);
  }

  /**
   * Get excluded asset amounts (scam tokens) for the given account and its child accounts.
   * Returns a map of asset -> total amount to subtract from live balance.
   * Aggregates excluded transactions from ALL completed sessions.
   */
  private async getExcludedAssetInfo(
    account: Account
  ): Promise<Result<{ amounts: Record<string, Decimal>; spamAssetIds: Set<string> }, Error>> {
    try {
      const accountIdsResult = await this.resolveAccountScope(account);
      if (accountIdsResult.isErr()) return err(accountIdsResult.error);
      const accountIds = accountIdsResult.value;

      // Find sessions for all accounts in one query (avoids N+1)
      const sessionsResult: Result<ImportSession[], Error> = await this.db.importSessions.findAll({ accountIds });
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const allSessions = sessionsResult.value;

      if (allSessions.length === 0) {
        return ok({ amounts: {}, spamAssetIds: new Set() });
      }

      // Check if there's at least one completed session
      const hasCompletedSession = allSessions.some((s) => s.status === 'completed');
      if (!hasCompletedSession) {
        return ok({ amounts: {}, spamAssetIds: new Set() });
      }

      // Fetch ALL excluded transactions for all accounts in one query (avoids N+1)
      const excludedTxResult: Result<UniversalTransactionData[], Error> = await this.db.transactions.findAll({
        accountIds,
        includeExcluded: true, // Must include to get the excluded ones
      });

      if (excludedTxResult.isErr()) {
        return err(excludedTxResult.error);
      }

      const allExcludedTransactions = excludedTxResult.value;

      const excludedInfo = this.collectExcludedAssetInfo(allExcludedTransactions);
      return ok(excludedInfo);
    } catch (error) {
      return wrapError(error, 'Failed to collect excluded asset info');
    }
  }

  /**
   * Persist verification results to the account.
   */
  private async persistVerificationResults(
    account: Account,
    calculatedBalances: Record<string, Decimal>,
    liveBalances: Record<string, string>,
    comparisons: BalanceComparison[],
    status: 'success' | 'warning' | 'failed',
    suggestion?: string
  ): Promise<Result<void, Error>> {
    try {
      const calculatedBalancesStr = this.decimalRecordToStringRecord(calculatedBalances);

      // Derive sourceParams from account type
      const isExchange = account.accountType === 'exchange-api' || account.accountType === 'exchange-csv';
      const sourceParams: SourceParams = isExchange
        ? { exchange: account.sourceName }
        : { blockchain: account.sourceName, address: account.identifier };

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
        source_params: sourceParams,
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

      if (updateResult.isErr()) {
        return err(updateResult.error);
      }

      logger.info(`Verification results persisted to account ${account.id}`);
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to persist verification results');
    }
  }

  /**
   * Find the most recent completed session from a list of sessions.
   */
  private findMostRecentCompletedSession(sessions: ImportSession[]): ImportSession | undefined {
    const completedSessions = sessions.filter((s) => s.status === 'completed');

    if (completedSessions.length === 0) {
      return undefined;
    }

    return completedSessions.reduce((mostRecent, current) => {
      if (!current.completedAt) return mostRecent;
      if (!mostRecent.completedAt) return current;
      return current.completedAt > mostRecent.completedAt ? current : mostRecent;
    });
  }

  /**
   * Summarize excluded assets from transactions.
   * - amounts: sum of excluded inflows (airdrops) by assetId
   * - spamAssetIds: assetIds seen in scam transactions (notes or isSpam)
   */
  private collectExcludedAssetInfo(transactions: UniversalTransactionData[]): {
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

      if (parsed.value.namespace !== 'blockchain') {
        return false;
      }

      // Never exclude native assets from balance comparisons (e.g., ETH gas fees on spam txs)
      if (parsed.value.ref === 'native') {
        return false;
      }

      return true;
    };

    for (const tx of excludedTransactions) {
      const isScam = tx.isSpam === true || (tx.notes?.some((note) => note.type === 'SCAM_TOKEN') ?? false);

      if (isScam) {
        for (const inflow of tx.movements.inflows ?? []) {
          if (shouldMarkScamAsset(inflow.assetId)) {
            spamAssetIds.add(inflow.assetId);
          }
        }
        for (const outflow of tx.movements.outflows ?? []) {
          if (shouldMarkScamAsset(outflow.assetId)) {
            spamAssetIds.add(outflow.assetId);
          }
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

  /**
   * Subtract excluded amounts from live balances.
   * Removes assets entirely when balance becomes zero or negative after subtraction.
   */
  private subtractExcludedAmounts(
    liveBalances: Record<string, Decimal>,
    excludedAmounts: Record<string, Decimal>
  ): Record<string, Decimal> {
    const adjusted = { ...liveBalances };

    for (const [asset, excludedAmount] of Object.entries(excludedAmounts)) {
      if (adjusted[asset]) {
        const newBalance = adjusted[asset].minus(excludedAmount);

        // If balance becomes zero or negative, remove the asset entirely
        // This prevents false mismatches for fully-excluded scam tokens
        if (newBalance.lte(0)) {
          delete adjusted[asset];
        } else {
          adjusted[asset] = newBalance;
        }
      }
    }

    return adjusted;
  }

  /**
   * Remove assets from a balance map.
   */
  private removeAssetsById<T>(balances: Record<string, T>, assetIds: Set<string>): Record<string, T> {
    const filtered: Record<string, T> = {};
    for (const [assetId, balance] of Object.entries(balances)) {
      if (!assetIds.has(assetId)) {
        filtered[assetId] = balance;
      }
    }
    return filtered;
  }

  /**
   * Resolve the full set of account IDs for an account (itself + child accounts).
   */
  private async resolveAccountScope(account: Account): Promise<Result<number[], Error>> {
    const childAccountsResult = await this.db.accounts.findAll({ parentAccountId: account.id });
    if (childAccountsResult.isErr()) return err(childAccountsResult.error);
    return ok([account.id, ...childAccountsResult.value.map((child) => child.id)]);
  }

  /**
   * Convert decimal record to string record.
   */
  private decimalRecordToStringRecord(record: Record<string, Decimal>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      result[key] = value.toFixed();
    }
    return result;
  }
}
