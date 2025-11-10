import {
  BlockchainProviderManager,
  loadExplorerConfig,
  type BlockchainExplorersConfig,
} from '@exitbook/blockchain-providers';
import type { VerificationMetadata } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import { TokenMetadataRepository, TransactionRepository } from '@exitbook/data';
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
  buildSourceParams,
  decimalRecordToStringRecord,
  findMostRecentCompletedSession,
  findSessionByAddress,
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
  private tokenMetadataRepository: TokenMetadataRepository;

  constructor(database: KyselyDB, explorerConfig?: BlockchainExplorersConfig) {
    // Load explorer config
    const config = explorerConfig || loadExplorerConfig();

    // Initialize services
    this.transactionRepository = new TransactionRepository(database);
    this.sessionRepository = new DataSourceRepository(database);
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
   * Get derived addresses from session metadata for extended public keys.
   * Returns the list of derived addresses stored during import (e.g., from xpub).
   */
  private async getDerivedAddressesFromSession(params: BalanceHandlerParams): Promise<Result<string[], Error>> {
    try {
      const sessionsResult = await this.sessionRepository.findBySource(params.sourceName);

      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessions = sessionsResult.value;
      if (sessions.length === 0) {
        return err(new Error(`No data source found for ${params.sourceName}`));
      }

      // Find session matching this specific address
      const normalizedAddress = params.address?.toLowerCase();
      const matchingSession = sessions.find((session) => {
        const importParams = session.importParams;
        return importParams.address?.toLowerCase() === normalizedAddress;
      });

      if (!matchingSession) {
        return err(new Error(`No data source found for address ${params.address}`));
      }

      // Extract derived addresses from importResultMetadata (not importParams)
      // The derivedAddresses are stored by the importer in the metadata field of ImportRunResult
      const resultMetadata = matchingSession.importResultMetadata;

      const derivedAddresses = resultMetadata.derivedAddresses;

      if (!Array.isArray(derivedAddresses) || derivedAddresses.length === 0) {
        return err(
          new Error(
            `No derived addresses found in session metadata for ${params.address}. Was this imported as an xpub?`
          )
        );
      }

      return ok(derivedAddresses);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get the timestamp of the most recent completed import for the source.
   * Returns undefined if no completed imports found.
   */
  private async getLastImportTimestamp(params: BalanceHandlerParams): Promise<number | undefined> {
    try {
      const sessionsResult = await this.sessionRepository.findBySource(params.sourceName);

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

      // For blockchain sources, find session matching the specific address
      if (params.sourceType === 'blockchain' && params.address) {
        const matchingSession = findSessionByAddress(completedSessions, params.address);

        if (!matchingSession) {
          return undefined;
        }

        return matchingSession.completedAt?.getTime();
      }

      // For exchanges, find the most recent completed session
      const mostRecentSession = findMostRecentCompletedSession(sessions);
      return mostRecentSession?.completedAt ? new Date(mostRecentSession.completedAt).getTime() : undefined;
    } catch (error) {
      logger.warn(`Error fetching last import timestamp: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /**
   * Calculate balances from transactions in the database.
   * For blockchain: find the data_source for the address, then query by data_source_id
   * For exchange: find the most recent completed data_source, then query by data_source_id
   */
  private async calculateBalancesFromTransactions(
    params: BalanceHandlerParams
  ): Promise<Result<Record<string, import('decimal.js').Decimal>, Error>> {
    try {
      // Find the data_source that matches this source
      const sessionsResult = await this.sessionRepository.findBySource(params.sourceName);
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessions = sessionsResult.value;
      if (sessions.length === 0) {
        return err(new Error(`No data source found for ${params.sourceName}`));
      }

      let matchingSession: (typeof sessions)[0] | undefined;

      if (params.sourceType === 'blockchain' && params.address) {
        // Find session matching this specific address
        matchingSession = findSessionByAddress(sessions, params.address);

        if (!matchingSession) {
          return err(new Error(`No data source found for address ${params.address}`));
        }
      } else {
        // For exchanges, use the most recent completed session
        matchingSession = findMostRecentCompletedSession(sessions);
      }

      if (!matchingSession) {
        return err(new Error(`No data source found for ${params.sourceName}`));
      }

      // Fetch all transactions for this data_source_id
      const transactionsResult = await this.transactionRepository.getTransactions({
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
    const derivedAddressesResult = await this.getDerivedAddressesFromSession(params);

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
   * Get excluded asset amounts (scam tokens) for the given source.
   * Returns a map of asset -> total amount to subtract from live balance.
   */
  private async getExcludedAssetAmounts(params: BalanceHandlerParams): Promise<Result<Record<string, Decimal>, Error>> {
    try {
      // Find the matching session
      const sessionsResult = await this.sessionRepository.findBySource(params.sourceName);
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessions = sessionsResult.value;
      if (sessions.length === 0) {
        return ok({});
      }

      // For blockchain: find session matching the specific address
      // For exchange: use the most recent completed session
      let targetSessionId: number | undefined;

      if (params.sourceType === 'blockchain' && params.address) {
        const matchingSession = findSessionByAddress(sessions, params.address);
        targetSessionId = matchingSession?.id;
      } else {
        // For exchanges, use the most recent completed session
        const mostRecentSession = findMostRecentCompletedSession(sessions);
        targetSessionId = mostRecentSession?.id;
      }

      if (!targetSessionId) {
        return ok({});
      }

      // Fetch all transactions with excluded_from_accounting = true
      const excludedTxResult = await this.transactionRepository.getTransactions({
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
   * Persist verification results to the session matching source/address.
   * Finds THE session (not "most recent") that matches the exact source and address/exchange.
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
      // Find session matching this source
      const sessionsResult = await this.sessionRepository.findBySource(params.sourceName);
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessions = sessionsResult.value;
      if (sessions.length === 0) {
        return err(new Error(`No data source  found for ${params.sourceName}`));
      }

      // For blockchain: find session matching the specific address
      // For exchange: use the most recent completed session
      let targetSession: (typeof sessions)[0] | undefined;
      if (params.sourceType === 'blockchain' && params.address) {
        targetSession = findSessionByAddress(sessions, params.address);

        if (!targetSession) {
          return err(new Error(`No data source  found for ${params.sourceName} with address ${params.address}`));
        }
      } else {
        // For exchanges, use the most recent completed session
        targetSession = findMostRecentCompletedSession(sessions);
      }

      // Ensure we found a session
      if (!targetSession) {
        return err(new Error(`No data source  found for ${params.sourceName}`));
      }

      // Build verification metadata
      const calculatedBalancesStr = decimalRecordToStringRecord(calculatedBalances);
      const sourceParams = buildSourceParams(targetSession, params.sourceType, params.address);

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

      // Update the session
      const updateResult = await this.sessionRepository.updateVerificationMetadata(
        targetSession.id,
        verificationMetadata
      );

      if (updateResult.isErr()) {
        return err(updateResult.error);
      }

      logger.info(`Verification results persisted to session ${targetSession.id}`);
      return ok();
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
