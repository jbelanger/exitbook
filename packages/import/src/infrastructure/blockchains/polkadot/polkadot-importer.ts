import type { ApiClientRawTransaction, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { err, type Result } from 'neverthrow';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

import type { SubscanTransfer } from './substrate/substrate.types.js';

/**
 * Polkadot transaction importer that fetches raw transaction data from Subscan API.
 * Uses provider manager for failover between multiple Substrate API providers.
 */
export class PolkadotTransactionImporter extends BaseImporter {
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    super('polkadot');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for Polkadot importer');
    }

    // Auto-register providers for polkadot mainnet
    this.providerManager.autoRegisterFromConfig('polkadot', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Polkadot transaction importer - ProvidersCount: ${this.providerManager.getProviders('polkadot').length}`
    );
  }

  /**
   * Import raw transaction data from Polkadot blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address?.length) {
      return err(new Error('Address required for Polkadot transaction import'));
    }

    this.logger.info(`Starting Polkadot transaction import for address: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

    return result
      .map((rawTransactions) => {
        this.logger.info(`Polkadot transaction import completed - Total: ${rawTransactions.length}`);
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
    const result = await this.providerManager.executeWithFailover('polkadot', {
      address,
      getCacheKey: (cacheParams) =>
        `dot_raw_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
      since,
      type: 'getRawAddressTransactions',
    });

    return result.map((response) => {
      // Transform raw response to individual transactions with provider provenance
      const rawData = response.data;
      if (rawData && typeof rawData === 'object' && 'data' in rawData) {
        const substrateTxData = rawData as { data: SubscanTransfer[] };

        if (Array.isArray(substrateTxData.data)) {
          const rawTransactions: ApiClientRawTransaction[] = substrateTxData.data.map((transfer) => ({
            metadata: { providerId: response.providerName },
            rawData: transfer,
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
   * Validate Polkadot address format (basic SS58 validation).
   */
  private isValidPolkadotAddress(address: string): boolean {
    // Polkadot addresses can start with '1' (generic SS58) or other prefixes like '5'
    // and are typically 47-48 characters long using base58 encoding
    return /^[1-9A-HJ-NP-Za-km-z]{47,48}$/.test(address);
  }
}
