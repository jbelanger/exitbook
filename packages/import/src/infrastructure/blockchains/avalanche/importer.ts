import type {
  RawTransactionWithMetadata,
  IImporter,
  ImportParams,
  ImportRunResult,
} from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

/**
 * Avalanche transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports multiple transaction types (regular, internal, token) from Snowtrace providers.
 * Uses provider manager for failover between multiple Avalanche API providers.
 */
export class AvalancheTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('avalancheImporter');

    if (!blockchainProviderManager) {
      throw new Error('Provider manager required for Avalanche importer');
    }

    this.providerManager = blockchainProviderManager;

    // Auto-register providers for avalanche
    this.providerManager.autoRegisterFromConfig('avalanche', options?.preferredProvider);

    this.logger.info(
      `Initialized Avalanche transaction importer - ProvidersCount: ${this.providerManager.getProviders('avalanche').length}`
    );
  }

  /**
   * Import raw transaction data from Avalanche blockchain APIs.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error('Address required for Avalanche transaction import'));
    }

    this.logger.info(`Importing transactions for address: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

    return result
      .map((addressTransactions) => {
        this.logger.info(`Total transactions imported: ${addressTransactions.length}`);
        return { rawTransactions: addressTransactions };
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
    const [normalResult, internalResult, tokenResult] = await Promise.all([
      this.providerManager.executeWithFailover('avalanche', {
        address,
        getCacheKey: (params) =>
          `avalanche:normal-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${
            params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'
          }`,
        since,
        type: 'getRawAddressTransactions',
      }),
      this.providerManager.executeWithFailover('avalanche', {
        address,
        getCacheKey: (params) =>
          `avalanche:internal-txs:${params.type === 'getRawAddressInternalTransactions' ? params.address : 'unknown'}:${
            params.type === 'getRawAddressInternalTransactions' ? params.since || 'all' : 'unknown'
          }`,
        since,
        type: 'getRawAddressInternalTransactions',
      }),
      this.providerManager.executeWithFailover('avalanche', {
        address,
        getCacheKey: (params) =>
          `avalanche:token-txs:${params.type === 'getTokenTransactions' ? params.address : 'unknown'}:${
            params.type === 'getTokenTransactions' ? params.since || 'all' : 'unknown'
          }`,
        since,
        type: 'getTokenTransactions',
      }),
    ]);

    if (normalResult.isErr()) {
      return err(normalResult.error);
    }

    const allTransactions: RawTransactionWithMetadata[] = this.mapTransactions(normalResult.value, address, 'normal');

    if (internalResult.isOk()) {
      const internalTransactions = this.mapTransactions(internalResult.value, address, 'internal');
      allTransactions.push(...internalTransactions);
      this.logger.debug(
        `Fetched ${internalTransactions.length} internal transactions for ${address.substring(0, 20)}...`
      );
    } else {
      this.logger.debug(
        `No internal transactions available for ${address.substring(0, 20)}...: ${internalResult.error.message}`
      );
    }

    if (tokenResult.isOk()) {
      const tokenTransactions = this.mapTransactions(tokenResult.value, address, 'token');
      allTransactions.push(...tokenTransactions);
      this.logger.debug(`Fetched ${tokenTransactions.length} token transactions for ${address.substring(0, 20)}...`);
    } else {
      this.logger.debug(
        `No token transactions available for ${address.substring(0, 20)}...: ${tokenResult.error.message}`
      );
    }

    this.logger.debug(
      `Fetched ${allTransactions.length} total transactions for address: ${address.substring(0, 20)}...`
    );

    return ok(allTransactions);
  }

  /**
   * Normalize provider response to RawTransactionWithMetadata entries.
   */
  private mapTransactions(
    response: { data: unknown; providerName: string },
    address: string,
    transactionType: 'internal' | 'normal' | 'token'
  ): RawTransactionWithMetadata[] {
    if (!response.data) {
      return [];
    }

    const rawEntries = Array.isArray(response.data) ? response.data : [response.data];

    return rawEntries.map((tx: unknown) => ({
      metadata: {
        providerId: response.providerName,
        sourceAddress: address,
        transactionType,
      },
      rawData: tx,
    }));
  }
}
