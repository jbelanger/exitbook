import type {
  ImportParams,
  ImportRunResult,
  RawTransactionWithMetadata,
  IImporter,
} from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, type Result } from 'neverthrow';

import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

/**
 * Injective transaction importer that fetches raw transaction data from blockchain APIs.
 * Uses provider manager for failover between multiple Injective API providers (Explorer API, LCD API).
 */
export class InjectiveTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('injectiveImporter');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for Injective importer');
    }

    this.providerManager = blockchainProviderManager;

    // Auto-register providers for injective mainnet
    this.providerManager.autoRegisterFromConfig('injective', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Injective transaction importer - ProvidersCount: ${this.providerManager.getProviders('injective').length}`
    );
  }

  /**
   * Import raw transaction data from Injective blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address?.length) {
      return err(new Error('Address required for Injective transaction import'));
    }

    this.logger.info(`Starting Injective transaction import for address: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

    return result
      .map((rawTransactions) => {
        this.logger.info(`Injective import completed: ${rawTransactions.length} transactions`);
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
    const result = await this.providerManager.executeWithFailover('injective', {
      address: address,
      getCacheKey: (params) =>
        `injective:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
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
