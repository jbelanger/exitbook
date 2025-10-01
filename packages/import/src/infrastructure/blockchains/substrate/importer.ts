import type {
  RawTransactionWithMetadata,
  IImporter,
  ImportParams,
  ImportRunResult,
} from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, type Result } from 'neverthrow';

import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

import type { SubstrateChainConfig } from './chain-config.interface.js';

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

    // Auto-register providers for this chain
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

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

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
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address,
      getCacheKey: (cacheParams) =>
        `${this.chainConfig.chainName}${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
      since,
      type: 'getRawAddressTransactions',
    });

    return result.map((response) => {
      // Ensure data is an array (same pattern as EVM importer)
      const rawTransactions = Array.isArray(response.data) ? response.data : [response.data];

      // Wrap each transaction with provider metadata - no format assumptions
      const txsWithMetadata = rawTransactions.map((tx: unknown) => ({
        metadata: { providerId: response.providerName },
        rawData: tx,
      }));

      this.logger.debug(
        `Imported ${txsWithMetadata.length} raw transactions for address via provider ${response.providerName}`
      );

      return txsWithMetadata;
    });
  }
}
