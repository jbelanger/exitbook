import type {
  BlockchainProviderManager,
  NearTransaction,
  ProviderError,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { ExternalTransaction } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportRunResult } from '../../../types/importers.js';

/**
 * NEAR transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports NEAR account IDs using multiple providers (NearBlocks).
 * Uses provider manager for failover between multiple blockchain API providers.
 *
 * The provider layer handles all enrichment internally:
 * - Account changes (native NEAR balance deltas) are populated in getAddressTransactions
 * - Token transfers (NEP-141) are fetched via getAddressTokenTransactions
 */
export class NearTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('nearImporter');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for NEAR importer');
    }

    this.providerManager.autoRegisterFromConfig('near', options?.preferredProvider);

    this.logger.info(
      `Initialized NEAR transaction importer - ProvidersCount: ${this.providerManager.getProviders('near').length}`
    );
  }

  /**
   * Import raw transaction data from NEAR blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error('Address required for NEAR transaction import'));
    }

    this.logger.info(`Starting NEAR transaction import for account: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchAllTransactions(params.address);

    return result
      .map((rawTransactions) => {
        this.logger.info(`NEAR import completed: ${rawTransactions.length} transactions`);
        return { rawTransactions: rawTransactions };
      })
      .mapErr((error) => {
        this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${error.message}`);
        return error;
      });
  }

  /**
   * Fetch all transaction types (normal, token) for an address in parallel.
   * Provider layer handles enrichment internally, so transactions are returned
   * with accountChanges and tokenTransfers already populated.
   */
  private async fetchAllTransactions(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    // Fetch both transaction types in parallel for optimal performance
    const [normalResult, tokenResult] = await Promise.all([
      this.fetchNormalTransactions(address),
      this.fetchTokenTransactions(address),
    ]);

    if (normalResult.isErr()) {
      return normalResult;
    }

    if (tokenResult.isErr()) {
      return tokenResult;
    }

    // Combine all successful results
    const allTransactions: ExternalTransaction[] = [...normalResult.value, ...tokenResult.value];

    this.logger.debug(
      `Total transactions fetched: ${allTransactions.length} (${normalResult.value.length} normal, ${tokenResult.value.length} token)`
    );

    return ok(allTransactions);
  }

  /**
   * Fetch normal transactions for an address with provider provenance.
   * Transactions are already enriched with accountChanges by the provider.
   */
  private async fetchNormalTransactions(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('near', {
      address: address,
      getCacheKey: (params) =>
        `near:normal-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<NearTransaction>[];
      const providerName = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        providerName,
        externalId: generateUniqueTransactionId(txWithRaw.normalized),
        transactionTypeHint: 'normal',
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
      }));
    });
  }

  /**
   * Fetch token transactions (NEP-141) for an address with provider provenance.
   * Each token transfer is returned as a separate transaction record.
   */
  private async fetchTokenTransactions(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('near', {
      address: address,
      getCacheKey: (params) =>
        `near:token-txs:${params.type === 'getAddressTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTokenTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTokenTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<NearTransaction>[];
      const providerName = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        providerName,
        externalId: generateUniqueTransactionId(txWithRaw.normalized),
        transactionTypeHint: 'token',
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
      }));
    });
  }
}
