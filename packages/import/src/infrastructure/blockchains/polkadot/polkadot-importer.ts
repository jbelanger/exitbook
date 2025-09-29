import type { ApiClientRawData, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { err, ok, type Result } from 'neverthrow';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

// Ensure providers are registered
import './register-apis.js';
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
   * Validate that the import source is compatible with Polkadot addresses.
   */
  override async canImport(params: ImportParams): Promise<boolean> {
    return this.canImportSpecific(params);
  }

  /**
   * Get transaction ID from Subscan transfer.
   */
  public getTransactionId(transfer: SubscanTransfer): string {
    return transfer.hash;
  }

  /**
   * Import raw transaction data from Polkadot blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<ImportRunResult> {
    if (!params.address?.length) {
      throw new Error('Address required for Polkadot transaction import');
    }

    this.logger.info(`Starting Polkadot transaction import for address: ${params.address.substring(0, 20)}...`);

    const allSourcedTransactions: ApiClientRawData[] = [];

    this.logger.info(`Importing transactions for Polkadot address: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

    if (result.isErr()) {
      this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${result.error.message}`);
      throw result.error;
    }

    const rawTransactions = result.value;
    allSourcedTransactions.push(...rawTransactions);

    this.logger.info(`Polkadot transaction import completed - Total: ${allSourcedTransactions.length}`);

    return {
      rawData: allSourcedTransactions,
    };
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.address?.length) {
      this.logger.error('No address provided for Polkadot import');
      return Promise.resolve(false);
    }

    // Basic validation for Polkadot addresses (SS58 format)
    if (!this.isValidPolkadotAddress(params.address)) {
      this.logger.error(`Invalid Polkadot address format: ${params.address}`);
      return Promise.resolve(false);
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('polkadot');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      (health) => health.isHealthy && health.circuitState !== 'OPEN'
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Polkadot providers available');
      return Promise.resolve(false);
    }

    this.logger.info('Polkadot source validation passed');
    return Promise.resolve(true);
  }
  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<Result<ApiClientRawData[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('polkadot', {
      address,
      getCacheKey: (cacheParams) =>
        `dot_raw_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
      since,
      type: 'getRawAddressTransactions',
    });

    if (result.isErr()) {
      this.logger.error(`Failed to fetch transactions for address ${address}: ${result.error.message}`);
      return err(result.error);
    }

    // Transform raw response to individual transactions with provider provenance
    const rawData = result.value.data;
    if (rawData && typeof rawData === 'object' && 'data' in rawData) {
      const substrateTxData = rawData as { data: SubscanTransfer[] };

      if (Array.isArray(substrateTxData.data)) {
        const rawTransactions: ApiClientRawData[] = substrateTxData.data.map((transfer) => ({
          metadata: { providerId: result.value.providerName },
          rawData: transfer,
        }));

        this.logger.info(
          `Imported ${rawTransactions.length} raw transactions for address via provider ${result.value.providerName}`
        );

        return ok(rawTransactions);
      }
    }

    this.logger.warn(`Unexpected data format from provider ${result.value.providerName} for address ${address}`);
    return ok([]);
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
