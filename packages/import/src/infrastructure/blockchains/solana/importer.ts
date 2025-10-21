import type { RawTransactionWithMetadata } from '@exitbook/core';
import type { BlockchainImportParams, IImporter, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import type {
  BlockchainProviderManager,
  ProviderError,
  SolanaTransaction,
  TransactionWithRawData,
} from '@exitbook/providers';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, type Result } from 'neverthrow';

/**
 * Solana transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports Solana addresses using multiple providers (Helius, Solscan, SolanaRPC).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class SolanaTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('solanaImporter');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for Solana importer');
    }

    this.providerManager.autoRegisterFromConfig('solana', options?.preferredProvider);

    this.logger.info(
      `Initialized Solana transaction importer - ProvidersCount: ${this.providerManager.getProviders('solana').length}`
    );
  }

  /**
   * Import raw transaction data from Solana blockchain APIs with provider provenance.
   */
  async import(params: BlockchainImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error('Address required for Solana transaction import'));
    }

    this.logger.info(`Starting Solana transaction import for address: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

    return result
      .map((rawTransactions) => {
        this.logger.info(`Solana import completed: ${rawTransactions.length} transactions`);
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
    const result = await this.providerManager.executeWithFailover('solana', {
      address: address,
      getCacheKey: (params) =>
        `solana:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<SolanaTransaction>[];
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
