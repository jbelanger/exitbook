import type {
  IImporter,
  ImportParams,
  ImportRunResult,
  RawTransactionWithMetadata,
} from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, type Result } from 'neverthrow';

import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.ts';

import type { CosmosChainConfig } from './chain-config.interface.js';

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

    // Auto-register providers for this chain
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
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getRawAddressTransactions',
    });

    return result.map((response) => {
      const rawTransactions = response.data as unknown[];
      const providerId = response.providerName;

      // Wrap each transaction with provider provenance and source address context
      return rawTransactions.map((rawData) => ({
        metadata: { providerId, sourceAddress: address },
        rawData,
      }));
    });
  }
}
