import type { KyselyDB, VerificationMetadata } from '@exitbook/data';
import { TransactionRepository } from '@exitbook/data';
import { createExchangeClient } from '@exitbook/exchanges';
import {
  calculateBalances,
  compareBalances,
  convertBalancesToDecimals,
  createVerificationResult,
  fetchBlockchainBalance,
  fetchExchangeBalance,
  ImportSessionRepository,
  type BalanceComparison,
  type BalanceVerificationResult,
  type UnifiedBalanceSnapshot,
} from '@exitbook/import';
import { BlockchainProviderManager, loadExplorerConfig, type BlockchainExplorersConfig } from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { BalanceHandlerParams } from './balance-utils.ts';
import {
  buildSourceParams,
  decimalRecordToStringRecord,
  getExchangeCredentialsFromEnv,
  parseImportParams,
  validateBalanceParams,
} from './balance-utils.ts';

// Re-export for convenience
export type { BalanceHandlerParams };

const logger = getLogger('BalanceHandler');

/**
 * Balance handler - fetches live balance and compares against calculated balance.
 * Stores verification results on the most recent import session.
 * Reusable by both CLI command and other contexts.
 */
export class BalanceHandler {
  private providerManager: BlockchainProviderManager;
  private transactionRepository: TransactionRepository;
  private sessionRepository: ImportSessionRepository;

  constructor(database: KyselyDB, explorerConfig?: BlockchainExplorersConfig) {
    // Load explorer config
    const config = explorerConfig || loadExplorerConfig();

    // Initialize services
    this.transactionRepository = new TransactionRepository(database);
    this.sessionRepository = new ImportSessionRepository(database);
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
      const liveBalances = convertBalancesToDecimals(liveSnapshot.balances);

      // 2. Fetch and calculate balance from transactions
      const calculatedBalancesResult = await this.calculateBalancesFromTransactions(params);
      if (calculatedBalancesResult.isErr()) {
        return err(calculatedBalancesResult.error);
      }

      const calculatedBalances = calculatedBalancesResult.value;

      // 3. Compare balances
      const comparisons = compareBalances(calculatedBalances, liveBalances);

      // 4. Get last import timestamp for suggestion generation
      const lastImportTimestamp = await this.getLastImportTimestamp(params);

      // 5. Create verification result
      const verificationResult = createVerificationResult(
        params.sourceName,
        params.sourceType,
        comparisons,
        lastImportTimestamp
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
        const normalizedAddress = params.address.toLowerCase();
        const matchingSession = completedSessions.find((session) => {
          const importParams = parseImportParams(session.import_params);
          return importParams.address?.toLowerCase() === normalizedAddress;
        });

        if (!matchingSession) {
          return undefined;
        }

        return matchingSession.completed_at ? new Date(matchingSession.completed_at).getTime() : undefined;
      }

      // For exchanges, sort by completed_at desc to ensure we get the most recent
      const sortedSessions = completedSessions.sort((a, b) => {
        const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return bTime - aTime;
      });
      const mostRecentSession = sortedSessions[0];
      return mostRecentSession?.completed_at ? new Date(mostRecentSession.completed_at).getTime() : undefined;
    } catch (error) {
      logger.warn(`Error fetching last import timestamp: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /**
   * Calculate balances from transactions in the database.
   * For blockchain: filter by address AND blockchain (critical for EVM addresses shared across chains)
   * For exchange: filter by source_id
   */
  private async calculateBalancesFromTransactions(
    params: BalanceHandlerParams
  ): Promise<Result<Record<string, import('decimal.js').Decimal>, Error>> {
    try {
      let transactionsResult;

      if (params.sourceType === 'blockchain' && params.address) {
        // For blockchain, fetch transactions by address AND blockchain
        // This prevents cross-chain aggregation (e.g., Ethereum + Polygon with same 0x address)
        transactionsResult = await this.transactionRepository.findByAddress(params.address, params.sourceName);
      } else {
        // For exchange, fetch all transactions for this source
        transactionsResult = await this.transactionRepository.getTransactions(params.sourceName);
      }

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
   */
  private async fetchBlockchainBalance(params: BalanceHandlerParams): Promise<Result<UnifiedBalanceSnapshot, Error>> {
    if (!params.address) {
      return err(new Error('Address is required for blockchain balance fetch'));
    }

    const result = await fetchBlockchainBalance(this.providerManager, params.sourceName, params.address);

    if (result.isErr()) {
      return err(result.error);
    }

    return ok(result.value);
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
        return err(new Error(`No import session found for ${params.sourceName}`));
      }

      // For blockchain: find session matching the specific address
      // For exchange: filter to completed sessions and use the most recent
      let targetSession: (typeof sessions)[0] | undefined;
      if (params.sourceType === 'blockchain' && params.address) {
        const normalizedAddress = params.address.toLowerCase();
        targetSession = sessions.find((session: (typeof sessions)[0]) => {
          const importParams = parseImportParams(session.import_params);
          return importParams.address?.toLowerCase() === normalizedAddress;
        });

        if (!targetSession) {
          return err(new Error(`No import session found for ${params.sourceName} with address ${params.address}`));
        }
      } else {
        // For exchanges, filter to completed sessions and sort by completed_at desc
        const completedSessions = sessions
          .filter((session) => session.status === 'completed')
          .sort((a, b) => {
            const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
            const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
            return bTime - aTime;
          });
        targetSession = completedSessions[0];
      }

      // Ensure we found a session
      if (!targetSession) {
        return err(new Error(`No import session found for ${params.sourceName}`));
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
