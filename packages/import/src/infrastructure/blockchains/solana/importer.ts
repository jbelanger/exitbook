import type { ApiClientRawTransaction, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { err, type Result } from 'neverthrow';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

import type { SolanaRawTransactionData } from './helius/helius.api-client.js';

/**
 * Solana transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports Solana addresses using multiple providers (Helius, Solscan, SolanaRPC).
 * Uses provider manager for failover between multiple blockchain API providers.
 */
export class SolanaTransactionImporter extends BaseImporter {
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    super('solana');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for Solana importer');
    }

    // Auto-register providers for solana mainnet
    this.providerManager.autoRegisterFromConfig('solana', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Solana transaction importer - ProvidersCount: ${this.providerManager.getProviders('solana').length}`
    );
  }

  /**
   * Import raw transaction data from Solana blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
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
  ): Promise<Result<ApiClientRawTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('solana', {
      address: address,
      getCacheKey: (params) =>
        `solana:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getRawAddressTransactions',
    });

    return result.map((response) => {
      const rawTransactionData = response.data as SolanaRawTransactionData;
      const providerId = response.providerName;

      // Return as array with single element containing all transactions
      return [
        {
          metadata: { providerId, sourceAddress: address },
          rawData: rawTransactionData,
        },
      ];
    });
  }
}
