import type { ExternalTransaction } from '@exitbook/core';
import type { BlockchainImportParams, IImporter, ImportRunResult } from '@exitbook/ingestion/app/ports/importers.js';
import type {
  BlockchainProviderManager,
  CosmosChainConfig,
  CosmosTransaction,
  ProviderError,
  TransactionWithRawData,
} from '@exitbook/providers';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, type Result } from 'neverthrow';

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
  async import(params: BlockchainImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address?.length) {
      return err(new Error(`Address required for ${this.chainConfig.displayName} transaction import`));
    }

    this.logger.info(
      `Starting ${this.chainConfig.displayName} transaction import for address: ${params.address.substring(0, 20)}...`
    );

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

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
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<CosmosTransaction>[];
      const providerId = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        providerId,
        externalId: txWithRaw.normalized.id,
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw, // Keep original provider response for audit trail
      }));
    });
  }
}
