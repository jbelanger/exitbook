import type { ApiClientRawTransaction, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { err, type Result } from 'neverthrow';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

import type { TaostatsTransaction } from './substrate/substrate.types.js';

/**
 * Bittensor transaction importer that fetches raw transaction data from Taostats API.
 * Uses provider manager for failover between multiple Bittensor API providers.
 */
export class BittensorTransactionImporter extends BaseImporter {
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    super('bittensor');

    if (!blockchainProviderManager) {
      throw new Error('Provider manager required for Bittensor importer');
    }

    this.providerManager = blockchainProviderManager;

    // Auto-register providers for bittensor mainnet
    this.providerManager.autoRegisterFromConfig('bittensor', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Bittensor transaction importer - ProvidersCount: ${this.providerManager.getProviders('bittensor').length}`
    );
  }

  /**
   * Import raw transaction data from Bittensor blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address?.length) {
      return err(new Error('Address required for Bittensor transaction import'));
    }

    this.logger.info(`Starting Bittensor transaction import for address: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

    return result
      .map((rawTransactions) => {
        this.logger.info(`Bittensor transaction import completed - Total: ${rawTransactions.length}`);
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
    const result = await this.providerManager.executeWithFailover('bittensor', {
      address,
      getCacheKey: (cacheParams) =>
        `tao_raw_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
      since,
      type: 'getRawAddressTransactions',
    });

    return result.map((response) => {
      // Transform raw response to individual transactions with provider provenance
      const rawData = response.data;
      if (rawData && typeof rawData === 'object' && 'data' in rawData) {
        const bittensorTxData = rawData as { data: TaostatsTransaction[] };

        if (Array.isArray(bittensorTxData.data)) {
          const rawTransactions: ApiClientRawTransaction[] = bittensorTxData.data.map((transaction) => ({
            metadata: { providerId: response.providerName },
            rawData: transaction,
          }));

          this.logger.debug(
            `Imported ${rawTransactions.length} raw transactions for address via provider ${response.providerName}`
          );

          return rawTransactions;
        }
      }

      this.logger.warn(`Unexpected data format from provider ${response.providerName} for address ${address}`);
      return [];
    });
  }

  /**
   * Validate Bittensor address format (SS58 validation for TAO network).
   */
  private isValidBittensorAddress(address: string): boolean {
    // Bittensor addresses start with '5' and are typically 47-48 characters long using base58 encoding
    return /^5[1-9A-HJ-NP-Za-km-z]{46,47}$/.test(address);
  }
}
