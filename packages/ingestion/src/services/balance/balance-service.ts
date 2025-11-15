import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type {
  Account,
  DataSource,
  SourceParams,
  SourceType,
  UniversalTransaction,
  VerificationMetadata,
} from '@exitbook/core';
import type { AccountRepository, TokenMetadataRepository, TransactionRepository, UserRepository } from '@exitbook/data';
import { createExchangeClient } from '@exitbook/exchanges-providers';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { IDataSourceRepository } from '../../types/repositories.js';

import { calculateBalances } from './balance-calculator.js';
import {
  convertBalancesToDecimals,
  fetchBlockchainBalance,
  fetchDerivedAddressesBalance,
  fetchExchangeBalance,
  type UnifiedBalanceSnapshot,
} from './balance-utils.js';
import { compareBalances, createVerificationResult } from './balance-verifier.js';
import type { BalanceComparison, BalanceVerificationResult } from './balance-verifier.types.js';

const logger = getLogger('BalanceService');

/**
 * Parameters for balance verification
 */
export interface BalanceServiceParams {
  sourceName: string;
  sourceType: SourceType;
  address?: string | undefined;
  credentials?:
    | {
        apiKey: string;
        passphrase?: string | undefined;
        secret: string;
      }
    | undefined;
  providerName?: string | undefined;
}

/**
 * Balance service - handles balance verification operations.
 * Orchestrates fetching live balances, calculating from transactions, and comparing.
 */
export class BalanceService {
  constructor(
    private userRepository: UserRepository,
    private accountRepository: AccountRepository,
    private transactionRepository: TransactionRepository,
    private sessionRepository: IDataSourceRepository,
    private tokenMetadataRepository: TokenMetadataRepository,
    private providerManager: BlockchainProviderManager
  ) {}

  /**
   * Execute the balance verification operation.
   * Fetches live balance, calculates balance from transactions, and compares them.
   */
  async verifyBalance(params: BalanceServiceParams): Promise<Result<BalanceVerificationResult, Error>> {
    try {
      logger.info(`Verifying balance for ${params.sourceName} (${params.sourceType})`);

      // 1. Find the account
      const accountResult = await this.findAccount(params);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }
      const account = accountResult.value;

      // 2. Fetch live balance from source
      const liveBalanceResult =
        params.sourceType === 'exchange'
          ? await this.fetchExchangeBalance(params)
          : await this.fetchBlockchainBalance(account, params);

      if (liveBalanceResult.isErr()) {
        return err(liveBalanceResult.error);
      }

      const liveSnapshot = liveBalanceResult.value;
      let liveBalances = convertBalancesToDecimals(liveSnapshot.balances);

      // 3. Fetch and calculate balance from transactions
      const calculatedBalancesResult = await this.calculateBalancesFromTransactions(account);
      if (calculatedBalancesResult.isErr()) {
        return err(calculatedBalancesResult.error);
      }

      const calculatedBalances = calculatedBalancesResult.value;

      // 4. Get excluded asset amounts (scam tokens) and subtract them from live balance
      const excludedAmountsResult = await this.getExcludedAssetAmounts(account);
      if (excludedAmountsResult.isErr()) {
        return err(excludedAmountsResult.error);
      }

      const excludedAmounts = excludedAmountsResult.value;
      if (Object.keys(excludedAmounts).length > 0) {
        const excludedAssets = Object.keys(excludedAmounts);
        logger.info(
          `Subtracting excluded amounts from live balance for ${excludedAssets.length} assets: ${excludedAssets.join(', ')}`
        );
        liveBalances = this.subtractExcludedAmounts(liveBalances, excludedAmounts);
      }

      // 5. Compare balances
      const comparisons = compareBalances(calculatedBalances, liveBalances);

      // 6. Get last import timestamp for suggestion generation
      const lastImportTimestamp = await this.getLastImportTimestamp(account);

      // 7. Create verification result
      const hasTransactions = Object.keys(calculatedBalances).length > 0;
      const verificationResult = createVerificationResult(
        account,
        params.sourceName,
        params.sourceType,
        comparisons,
        lastImportTimestamp,
        hasTransactions
      );

      // 8. Persist verification results
      const persistResult = await this.persistVerificationResults(
        account,
        params.sourceType,
        calculatedBalances,
        liveSnapshot.balances,
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
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources (stops provider manager timers/health checks).
   */
  destroy(): void {
    this.providerManager.destroy();
  }

  /**
   * Helper method to find an account based on balance params.
   */
  private async findAccount(params: BalanceServiceParams): Promise<Result<Account, Error>> {
    // 1. Get the default user
    const userResult = await this.userRepository.ensureDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    // 2. Map sourceType to accountType
    const accountType = params.sourceType === 'exchange' ? 'exchange-api' : 'blockchain';

    // 3. Determine identifier based on source type
    let identifier: string;
    if (params.sourceType === 'blockchain') {
      // For blockchain: identifier is the address
      if (!params.address) {
        return err(new Error('Address is required for blockchain balance'));
      }
      identifier = params.address;
    } else {
      // For exchange: identifier is the API key
      if (!params.credentials) {
        return err(
          new Error(
            `No credentials provided. Either use --api-key and --api-secret flags, or set ${params.sourceName.toUpperCase()}_API_KEY and ${params.sourceName.toUpperCase()}_SECRET in .env`
          )
        );
      }
      if (!params.credentials.apiKey) {
        return err(new Error('API key is required for exchange balance'));
      }
      identifier = params.credentials.apiKey;
    }

    // 4. Find account
    const accountResult: Result<Account | undefined, Error> = await this.accountRepository.findByUniqueConstraint(
      accountType,
      params.sourceName,
      identifier,
      user.id
    );

    if (accountResult.isErr()) {
      return err(accountResult.error);
    }

    if (!accountResult.value) {
      return err(
        new Error(
          `No account found for ${params.sourceName}. Please run import first to create the account. (Looking for: accountType=${accountType}, identifier=${identifier}, userId=${user.id})`
        )
      );
    }

    return ok(accountResult.value);
  }

  /**
   * Get derived addresses from account metadata for extended public keys.
   */
  private getDerivedAddressesFromAccount(account: Account, address: string): Result<string[], Error> {
    const derivedAddresses = account.derivedAddresses;

    if (!derivedAddresses || derivedAddresses.length === 0) {
      return err(new Error(`No derived addresses found for ${address}. Was this imported as an xpub?`));
    }

    return ok(derivedAddresses);
  }

  /**
   * Get the timestamp of the most recent completed import for the account.
   */
  private async getLastImportTimestamp(account: Account): Promise<number | undefined> {
    try {
      const sessionsResult: Result<DataSource[], Error> = await this.sessionRepository.findByAccount(account.id);

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
   */
  private async calculateBalancesFromTransactions(account: Account): Promise<Result<Record<string, Decimal>, Error>> {
    try {
      const sessionsResult: Result<DataSource[], Error> = await this.sessionRepository.findByAccount(account.id);
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessions = sessionsResult.value;
      if (sessions.length === 0) {
        return err(new Error(`No import sessions found for ${account.sourceName}`));
      }

      const matchingSession = this.findMostRecentCompletedSession(sessions);

      if (!matchingSession) {
        return err(new Error(`No completed import session found for ${account.sourceName}`));
      }

      const transactionsResult: Result<UniversalTransaction[], Error> =
        await this.transactionRepository.getTransactions({
          sessionId: matchingSession.id,
        });

      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      const transactions = transactionsResult.value;

      if (transactions.length === 0) {
        logger.warn(`No transactions found for ${account.sourceName} - calculated balance will be empty`);
        return ok({});
      }

      logger.info(`Calculating balances from ${transactions.length} transactions`);
      const calculatedBalances = calculateBalances(transactions);

      return ok(calculatedBalances);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Fetch balance from an exchange.
   */
  private async fetchExchangeBalance(params: BalanceServiceParams): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    if (!params.credentials) {
      return err(
        new Error(
          `No credentials provided. Either use --api-key and --api-secret flags, or set ${params.sourceName.toUpperCase()}_API_KEY and ${params.sourceName.toUpperCase()}_SECRET in .env`
        )
      );
    }

    // Build credentials (ExchangeCredentials = Record<string, string>)
    const credentials: Record<string, string> = {
      apiKey: params.credentials.apiKey,
      secret: params.credentials.secret,
    };
    if (params.credentials.passphrase) {
      credentials.passphrase = params.credentials.passphrase;
    }

    const clientResult = createExchangeClient(params.sourceName, credentials);
    if (clientResult.isErr()) {
      return err(clientResult.error);
    }

    const client = clientResult.value;
    return fetchExchangeBalance(client, params.sourceName);
  }

  /**
   * Fetch balance from a blockchain.
   * For addresses with derived addresses (e.g., xpub), fetches balances from all derived addresses and sums them.
   */
  private async fetchBlockchainBalance(
    account: Account,
    params: BalanceServiceParams
  ): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    if (!params.address) {
      return err(new Error('Address is required for blockchain balance fetch'));
    }

    // Check if this address has derived addresses (e.g., from xpub import)
    const derivedAddressesResult = this.getDerivedAddressesFromAccount(account, params.address);

    if (derivedAddressesResult.isOk()) {
      const derivedAddresses = derivedAddressesResult.value;
      logger.info(`Fetching balances for ${derivedAddresses.length} derived addresses`);

      return fetchDerivedAddressesBalance(
        this.providerManager,
        this.tokenMetadataRepository,
        params.sourceName,
        params.address,
        derivedAddresses,
        params.providerName
      );
    }

    // Standard single-address balance fetch
    return fetchBlockchainBalance(
      this.providerManager,
      this.tokenMetadataRepository,
      params.sourceName,
      params.address,
      params.providerName
    );
  }

  /**
   * Get excluded asset amounts (scam tokens) for the given account.
   */
  private async getExcludedAssetAmounts(account: Account): Promise<Result<Record<string, Decimal>, Error>> {
    try {
      const sessionsResult: Result<DataSource[], Error> = await this.sessionRepository.findByAccount(account.id);
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessions = sessionsResult.value;
      if (sessions.length === 0) {
        return ok({});
      }

      const mostRecentSession = this.findMostRecentCompletedSession(sessions);
      const targetSessionId = mostRecentSession?.id;

      if (!targetSessionId) {
        return ok({});
      }

      const excludedTxResult: Result<UniversalTransaction[], Error> = await this.transactionRepository.getTransactions({
        sessionId: targetSessionId,
        includeExcluded: true,
      });

      if (excludedTxResult.isErr()) {
        return err(excludedTxResult.error);
      }

      const excludedAmounts = this.sumExcludedInflowAmounts(excludedTxResult.value);
      return ok(excludedAmounts);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Persist verification results to the account.
   */
  private async persistVerificationResults(
    account: Account,
    sourceType: 'blockchain' | 'exchange',
    calculatedBalances: Record<string, Decimal>,
    liveBalances: Record<string, string>,
    comparisons: BalanceComparison[],
    status: 'success' | 'warning' | 'failed',
    suggestion?: string
  ): Promise<Result<void, Error>> {
    try {
      const calculatedBalancesStr = this.decimalRecordToStringRecord(calculatedBalances);

      const sourceParams: SourceParams =
        sourceType === 'exchange'
          ? { exchange: account.sourceName }
          : { blockchain: account.sourceName, address: account.identifier };

      const discrepancies = comparisons
        .filter((c) => c.status !== 'match')
        .map((c) => ({
          asset: c.currency,
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

      const updateResult: Result<void, Error> = await this.accountRepository.update(account.id, {
        verificationMetadata,
        lastBalanceCheckAt: new Date(),
      });

      if (updateResult.isErr()) {
        return err(updateResult.error);
      }

      logger.info(`Verification results persisted to account ${account.id}`);
      return ok();
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Find the most recent completed session from a list of sessions.
   */
  private findMostRecentCompletedSession(sessions: DataSource[]): DataSource | undefined {
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
   * Sum up amounts from excluded transactions (inflows only - scams are airdrops).
   */
  private sumExcludedInflowAmounts(transactions: UniversalTransaction[]): Record<string, Decimal> {
    const excludedTransactions = transactions.filter((tx) => tx.excludedFromAccounting === true);
    const amounts: Record<string, Decimal> = {};

    for (const tx of excludedTransactions) {
      // Only count inflows (received scam tokens)
      for (const inflow of tx.movements.inflows ?? []) {
        const existing = amounts[inflow.asset];
        amounts[inflow.asset] = existing ? existing.plus(inflow.grossAmount) : inflow.grossAmount;
      }
    }

    return amounts;
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
