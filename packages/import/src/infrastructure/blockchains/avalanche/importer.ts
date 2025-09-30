import type {
  RawTransactionWithMetadata,
  IImporter,
  ImportParams,
  ImportRunResult,
} from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

import type {
  SnowtraceInternalTransaction,
  SnowtraceTransaction,
  SnowtraceTokenTransfer,
} from './snowtrace/snowtrace.types.ts';

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

    // Auto-register providers for avalanche mainnet
    this.providerManager.autoRegisterFromConfig('avalanche', 'mainnet', options?.preferredProvider);

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
    // Fetch normal and internal transactions
    const normalResult = await this.providerManager.executeWithFailover('avalanche', {
      address,
      getCacheKey: (params) =>
        `avalanche:normal-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since,
      type: 'getRawAddressTransactions',
    });

    const processedNormalResult = normalResult.map((response) => this.processCompositeTransactions(response));

    if (processedNormalResult.isErr()) {
      return processedNormalResult;
    }

    // Fetch token transactions separately
    const tokenResult = await this.providerManager.executeWithFailover('avalanche', {
      address,
      getCacheKey: (params) =>
        `avalanche:token-txs:${params.type === 'getTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getTokenTransactions' ? params.since || 'all' : 'unknown'}`,
      since,
      type: 'getTokenTransactions',
    });

    return tokenResult
      .map((response) => {
        const allTransactions = [...processedNormalResult.value, ...this.processTokenTransactions(response)];

        this.logger.debug(`Fetched ${allTransactions.length} transactions for address: ${address.substring(0, 20)}...`);
        return allTransactions;
      })
      .orElse((error) => {
        // Token transactions are optional, so if they fail, just return normal transactions
        this.logger.debug(`No token transactions available for ${address.substring(0, 20)}...: ${error.message}`);
        return ok(processedNormalResult.value);
      });
  }

  /**
   * Process composite response containing normal and internal transactions.
   */
  private processCompositeTransactions(response: {
    data: unknown;
    providerName: string;
  }): RawTransactionWithMetadata[] {
    const rawTransactions: RawTransactionWithMetadata[] = [];

    if (!response.data) return rawTransactions;

    const compositeData = response.data as {
      internal: SnowtraceInternalTransaction[];
      normal: SnowtraceTransaction[];
    };

    if (compositeData.normal?.length) {
      rawTransactions.push(
        ...compositeData.normal.map((tx) => ({
          metadata: { providerId: response.providerName, transactionType: 'normal' as const },
          rawData: tx,
        }))
      );
    }

    if (compositeData.internal?.length) {
      rawTransactions.push(
        ...compositeData.internal.map((tx) => ({
          metadata: { providerId: response.providerName, transactionType: 'internal' as const },
          rawData: tx,
        }))
      );
    }

    return rawTransactions;
  }

  /**
   * Process token transaction response.
   */
  private processTokenTransactions(response: { data: unknown; providerName: string }): RawTransactionWithMetadata[] {
    if (!response.data || !Array.isArray(response.data)) return [];

    const tokenTransactions = response.data as SnowtraceTokenTransfer[];
    return tokenTransactions.map((tx) => ({
      metadata: { providerId: response.providerName, transactionType: 'token' as const },
      rawData: tx,
    }));
  }
}
