import type {
  BlockchainProviderManager,
  CosmosChainConfig,
  CosmosTransaction,
  ProviderError,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { ExternalTransaction } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportRunResult } from '../../../types/importers.js';

/**
 * Generic Cosmos SDK transaction importer that fetches raw transaction data from blockchain APIs.
 * Works with any Cosmos SDK-based chain (Injective, Osmosis, Cosmos Hub, Terra, etc.)
 * Uses provider manager for failover between multiple API providers per chain.
 */
export class CosmosImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;
  private chainConfig: CosmosChainConfig;

  constructor(
    chainConfig: CosmosChainConfig,
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`cosmosImporter:${chainConfig.chainName}`);

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error(`Provider manager required for ${chainConfig.displayName} importer`);
    }

    this.providerManager.autoRegisterFromConfig(chainConfig.chainName, options?.preferredProvider);

    this.logger.info(
      `Initialized ${chainConfig.displayName} transaction importer - ProvidersCount: ${this.providerManager.getProviders(chainConfig.chainName).length}`
    );
  }

  /**
   * Import raw transaction data from Cosmos SDK blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address?.length) {
      return err(new Error(`Address required for ${this.chainConfig.displayName} transaction import`));
    }

    // Normalize Cosmos address to lowercase (Cosmos addresses are case-insensitive)
    // This ensures consistency with CosmosAddressSchema normalization and processor expectations
    params.address = params.address.toLowerCase();

    this.logger.info(
      `Starting ${this.chainConfig.displayName} transaction import for address: ${params.address.substring(0, 20)}...`
    );

    const result = await this.fetchRawTransactionsForAddress(params.address);

    return result
      .map((rawTransactions) => {
        this.logger.info(`${this.chainConfig.displayName} import completed: ${rawTransactions.length} transactions`);
        return { rawTransactions: rawTransactions };
      })
      .mapErr((error) => {
        this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${error.message}`);
        return error;
      });
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<CosmosTransaction>[];
      const providerName = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        externalId: generateUniqueTransactionId({
          amount: txWithRaw.normalized.amount,
          currency: txWithRaw.normalized.currency,
          from: txWithRaw.normalized.from,
          id: txWithRaw.normalized.id,
          timestamp: txWithRaw.normalized.timestamp,
          to: txWithRaw.normalized.to,
          tokenAddress: txWithRaw.normalized.tokenAddress,
          type: txWithRaw.normalized.messageType || 'transfer',
        }),
        normalizedData: txWithRaw.normalized,
        providerName,
        rawData: txWithRaw.raw,
        sourceAddress: address,
      }));
    });
  }
}
