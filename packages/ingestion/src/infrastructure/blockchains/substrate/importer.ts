import type { ExternalTransaction } from '@exitbook/core';
import type {
  BlockchainProviderManager,
  ProviderError,
  SubstrateChainConfig,
  SubstrateTransaction,
  TransactionWithRawData,
} from '@exitbook/providers';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportRunResult } from '../../../types/importers.ts';

/**
 * Generic Substrate transaction importer that fetches raw transaction data from blockchain APIs.
 * Works with any Substrate-based chain (Polkadot, Kusama, Bittensor, etc.).
 *
 * Uses provider manager for failover between multiple API providers.
 */
export class SubstrateImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;
  private chainConfig: SubstrateChainConfig;

  constructor(
    chainConfig: SubstrateChainConfig,
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`substrateImporter:${chainConfig.chainName}`);

    if (!blockchainProviderManager) {
      throw new Error(`Provider manager required for ${chainConfig.chainName} importer`);
    }

    this.providerManager = blockchainProviderManager;

    this.providerManager.autoRegisterFromConfig(chainConfig.chainName, options?.preferredProvider);

    this.logger.info(
      `Initialized ${chainConfig.displayName} transaction importer - ProvidersCount: ${this.providerManager.getProviders(chainConfig.chainName).length}`
    );
  }

  /**
   * Import raw transaction data from Substrate blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address?.length) {
      return err(new Error(`Address required for ${this.chainConfig.chainName} transaction import`));
    }

    this.logger.info(
      `Starting ${this.chainConfig.chainName} transaction import for address: ${params.address.substring(0, 20)}...`
    );

    const result = await this.fetchRawTransactionsForAddress(params.address);

    return result
      .map((rawTransactions) => {
        this.logger.info(
          `${this.chainConfig.chainName} transaction import completed - Total: ${rawTransactions.length}`
        );
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
      address,
      getCacheKey: (cacheParams) =>
        `${this.chainConfig.chainName}${cacheParams.type === 'getAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getAddressTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<SubstrateTransaction>[];
      const providerId = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        providerId,
        sourceAddress: address,
        externalId: txWithRaw.normalized.id,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
      }));
    });
  }
}
