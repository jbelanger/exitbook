import {
  BlockchainProviderManager,
  loadExplorerConfig,
  type BlockchainExplorersConfig,
} from '@exitbook/blockchain-providers';
import type { Account, DataSource, SourceParams, VerificationMetadata, UniversalTransaction } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import { AccountRepository, TokenMetadataRepository, TransactionRepository } from '@exitbook/data';
import { createExchangeClient } from '@exitbook/exchanges-providers';
import {
  calculateBalances,
  compareBalances,
  convertBalancesToDecimals,
  createVerificationResult,
  fetchDerivedAddressesBalance,
  fetchBlockchainBalance,
  fetchExchangeBalance,
  DataSourceRepository,
  type BalanceComparison,
  type BalanceVerificationResult,
  type UnifiedBalanceSnapshot,
} from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { BalanceHandlerParams } from './balance-utils.js';
import {
  decimalRecordToStringRecord,
  findMostRecentCompletedSession,
  getExchangeCredentialsFromEnv,
  subtractExcludedAmounts,
  sumExcludedInflowAmounts,
  validateBalanceParams,
} from './balance-utils.js';

const logger = getLogger('BalanceHandler');

/**
 * Balance handler - fetches live balance and compares against calculated balance.
 * Stores verification results on the most recent data source .
 * Reusable by both CLI command and other contexts.
 */
export class BalanceHandler {
  private providerManager: BlockchainProviderManager;
  private transactionRepository: TransactionRepository;
  private sessionRepository: DataSourceRepository;
  private accountRepository: AccountRepository;
  private tokenMetadataRepository: TokenMetadataRepository;

  constructor(database: KyselyDB, explorerConfig?: BlockchainExplorersConfig) {
    // Load explorer config
    const config = explorerConfig || loadExplorerConfig();

    // Initialize services
    this.transactionRepository = new TransactionRepository(database);
    this.sessionRepository = new DataSourceRepository(database);
    this.accountRepository = new AccountRepository(database);
    this.tokenMetadataRepository = new TokenMetadataRepository(database);
    this.providerManager = new BlockchainProviderManager(config);
  }

  /**
   * Execute the balance fetch and verification operation.
   * Fetches live balance, calculates balance from transactions, and compares them.
   */
  async execute(params: BalanceHandlerParams): Promise<Result<BalanceVerificationResult, Error>> {
    try {
      // Validate parameters
      const validation = validateBalanceParams(params);
      if (validation.isErr()) {
        return err(validation.error);
      }

      logger.info(`Fetching and verifying balance for ${params.sourceName} (${params.sourceType})`);

      // 1. Fetch live balance from source
      const liveBalanceResult =
        params.sourceType === 'exchange'
          ? await this.fetchExchangeBalance(params)
          : await this.fetchBlockchainBalance(params);

      if (liveBalanceResult.isErr()) {
        return err(liveBalanceResult.error);
      }

      const liveSnapshot = liveBalanceResult.value;
      let liveBalances = convertBalancesToDecimals(liveSnapshot.balances);

      // 2. Fetch and calculate balance from transactions
      const calculatedBalancesResult = await this.calculateBalancesFromTransactions(params);
      if (calculatedBalancesResult.isErr()) {
        return err(calculatedBalancesResult.error);
      }

      const calculatedBalances = calculatedBalancesResult.value;

      // 2.5. Get excluded asset amounts (scam tokens) and subtract them from live balance
      const excludedAmountsResult = await this.getExcludedAssetAmounts(params);
      if (excludedAmountsResult.isErr()) {
        return err(excludedAmountsResult.error);
      }

      const excludedAmounts = excludedAmountsResult.value;
      if (Object.keys(excludedAmounts).length > 0) {
        const excludedAssets = Object.keys(excludedAmounts);
        logger.info(
          `Subtracting excluded amounts from live balance for ${excludedAssets.length} assets: ${excludedAssets.join(', ')}`
        );
        liveBalances = subtractExcludedAmounts(liveBalances, excludedAmounts);
      }

      // 3. Compare balances
      const comparisons = compareBalances(calculatedBalances, liveBalances);

      // 4. Get last import timestamp for suggestion generation
      const lastImportTimestamp = await this.getLastImportTimestamp(params);

      // 5. Create verification result
      // Check if we have any transactions (empty calculated balances means no transactions)
      const hasTransactions = Object.keys(calculatedBalances).length > 0;
      const verificationResult = createVerificationResult(
        params.sourceName,
        params.sourceType,
        comparisons,
        lastImportTimestamp,
        hasTransactions
      );

      // 6. Persist verification results to the session matching this source/address
      const persistResult = await this.persistVerificationResults(
        params,
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
   * Cleanup resources.
   */
  destroy(): void {
    this.providerManager.destroy();
  }

  /**
   * Helper method to find an account based on balance params.
   */
  private async findAccount(params: BalanceHandlerParams): Promise<Result<Account, Error>> {
    // Map sourceType to accountType
    const accountType = params.sourceType === 'exchange' ? 'exchange-api' : 'blockchain';

    // For blockchain: identifier is the address
    // For exchange: we don't have identifier here, need to search by source name
    // This is a temporary solution - we may need to refactor this
    const identifier = params.sourceType === 'blockchain' && params.address ? params.address : '';

    // Find account (user_id is null for tracking-only accounts)
    const accountResult: Result<Account | undefined, Error> = await this.accountRepository.findByUniqueConstraint(
      accountType,
      params.sourceName,
      identifier,
      // eslint-disable-next-line unicorn/no-null -- AccountRepository.findByUniqueConstraint requires null for DB compatibility
      null // Assuming tracking-only accounts for now
    );

    if (accountResult.isErr()) {
      return err(accountResult.error);
    }

    if (!accountResult.value) {
      return err(new Error(`No account found for ${params.sourceName} ${identifier || ''}`));
    }

    return ok(accountResult.value);
  }

  /**
   * Get derived addresses from account metadata for extended public keys.
   * Returns the list of derived addresses stored during import (e.g., from xpub).
   */
  private async getDerivedAddressesFromAccount(params: BalanceHandlerParams): Promise<Result<string[], Error>> {
    try {
      // Find the account
      const accountResult = await this.findAccount(params);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }

      const account = accountResult.value;

      // Extract derived addresses from account
      const derivedAddresses = account.derivedAddresses;

      if (!derivedAddresses || derivedAddresses.length === 0) {
        return err(new Error(`No derived addresses found for ${params.address}. Was this imported as an xpub?`));
      }

      return ok(derivedAddresses);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get the timestamp of the most recent completed import for the account.
   * Returns undefined if no completed imports found.
   */
  private async getLastImportTimestamp(params: BalanceHandlerParams): Promise<number | undefined> {
    try {
      // Find the account
      const accountResult = await this.findAccount(params);
      if (accountResult.isErr()) {
        logger.warn(`Failed to find account: ${accountResult.error.message}`);
        return undefined;
      }

      const account = accountResult.value;

      // Find sessions for this account
      const sessionsResult: Result<DataSource[], Error> = await this.sessionRepository.findByAccount(account.id);

      if (sessionsResult.isErr()) {
        logger.warn(`Failed to fetch import sessions: ${sessionsResult.error.message}`);
        return undefined;
      }

      const sessions = sessionsResult.value;

      // Filter to completed sessions only
      const completedSessions = sessions.filter((s) => s.status === 'completed');

      if (completedSessions.length === 0) {
        return undefined;
      }

      // Find the most recent completed session
      const mostRecentSession = findMostRecentCompletedSession(completedSessions);
      return mostRecentSession?.completedAt?.getTime();
    } catch (error) {
      logger.warn(`Error fetching last import timestamp: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /**
   * Calculate balances from transactions in the database.
   * Finds the account, then the most recent completed session, then queries transactions.
   */
  private async calculateBalancesFromTransactions(
    params: BalanceHandlerParams
  ): Promise<Result<Record<string, import('decimal.js').Decimal>, Error>> {
    try {
      // Find the account
      const accountResult = await this.findAccount(params);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }

      const account = accountResult.value;

      // Find sessions for this account
      const sessionsResult: Result<DataSource[], Error> = await this.sessionRepository.findByAccount(account.id);
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessions = sessionsResult.value;
      if (sessions.length === 0) {
        return err(new Error(`No import sessions found for ${params.sourceName}`));
      }

      // Use the most recent completed session
      const matchingSession = findMostRecentCompletedSession(sessions);

      if (!matchingSession) {
        return err(new Error(`No completed import session found for ${params.sourceName}`));
      }

      // Fetch all transactions for this session
      const transactionsResult: Result<UniversalTransaction[], Error> =
        await this.transactionRepository.getTransactions({
          sessionId: matchingSession.id,
        });

      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      const transactions = transactionsResult.value;

      if (transactions.length === 0) {
        logger.warn(`No transactions found for ${params.sourceName} - calculated balance will be empty`);
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
  private async fetchExchangeBalance(params: BalanceHandlerParams): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    // Try credentials from CLI flags first, fallback to environment variables
    let credentials = params.credentials;

    if (!credentials) {
      const envCredentials = getExchangeCredentialsFromEnv(params.sourceName);
      if (envCredentials.isErr()) {
        return err(
          new Error(
            `No credentials provided. Either use --api-key and --api-secret flags, or set ${params.sourceName.toUpperCase()}_API_KEY and ${params.sourceName.toUpperCase()}_SECRET in .env`
          )
        );
      }
      credentials = envCredentials.value;
    }

    // Create exchange client
    const clientResult = createExchangeClient(params.sourceName, credentials);
    if (clientResult.isErr()) {
      return err(clientResult.error);
    }

    const client = clientResult.value;

    // Fetch balance
    return fetchExchangeBalance(client, params.sourceName);
  }

  /**
   * Fetch balance from a blockchain.
   * For addresses with derived addresses (e.g., xpub), fetches balances from all derived addresses and sums them.
   */
  private async fetchBlockchainBalance(params: BalanceHandlerParams): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    if (!params.address) {
      return err(new Error('Address is required for blockchain balance fetch'));
    }

    // Check if this address has derived addresses (e.g., from xpub import)
    const derivedAddressesResult = await this.getDerivedAddressesFromAccount(params);

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
   * Returns a map of asset -> total amount to subtract from live balance.
   */
  private async getExcludedAssetAmounts(params: BalanceHandlerParams): Promise<Result<Record<string, Decimal>, Error>> {
    try {
      // Find the account
      const accountResult = await this.findAccount(params);
      if (accountResult.isErr()) {
        return ok({}); // Return empty if account not found
      }

      const account = accountResult.value;

      // Find sessions for this account
      const sessionsResult: Result<DataSource[], Error> = await this.sessionRepository.findByAccount(account.id);
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessions = sessionsResult.value;
      if (sessions.length === 0) {
        return ok({});
      }

      // Use the most recent completed session
      const mostRecentSession = findMostRecentCompletedSession(sessions);
      const targetSessionId = mostRecentSession?.id;

      if (!targetSessionId) {
        return ok({});
      }

      // Fetch all transactions with excluded_from_accounting = true
      const excludedTxResult: Result<UniversalTransaction[], Error> = await this.transactionRepository.getTransactions({
        sessionId: targetSessionId,
        includeExcluded: true, // Must include to get the excluded ones
      });

      if (excludedTxResult.isErr()) {
        return err(excludedTxResult.error);
      }

      // Sum up amounts from excluded transactions (inflows only - scams are airdrops)
      const excludedAmounts = sumExcludedInflowAmounts(excludedTxResult.value);

      return ok(excludedAmounts);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Persist verification results to the account matching source/address.
   * Finds THE account that matches the exact source and address/exchange.
   */
  private async persistVerificationResults(
    params: BalanceHandlerParams,
    calculatedBalances: Record<string, Decimal>,
    liveBalances: Record<string, string>,
    comparisons: BalanceComparison[],
    status: 'success' | 'warning' | 'failed',
    suggestion?: string
  ): Promise<Result<void, Error>> {
    try {
      // Find the account
      const accountResult = await this.findAccount(params);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }

      const account = accountResult.value;

      // Build verification metadata
      const calculatedBalancesStr = decimalRecordToStringRecord(calculatedBalances);

      // Build source params from account data
      const sourceParams: SourceParams =
        params.sourceType === 'exchange'
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

      // Update the account with verification metadata
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
}
