import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams, ImportRunResult } from '../../shared/importers/interfaces.ts';
import type { ApiClientRawData } from '../../shared/processors/interfaces.ts';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
// Ensure providers are registered
import './api/index.ts';
import type { SubscanTransfer } from './types.ts';

/**
 * Polkadot transaction importer that fetches raw transaction data from Subscan API.
 * Uses provider manager for failover between multiple Substrate API providers.
 */
export class PolkadotTransactionImporter extends BaseImporter<SubscanTransfer> {
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
   * Validate Polkadot address format (basic SS58 validation).
   */
  private isValidPolkadotAddress(address: string): boolean {
    // Polkadot addresses can start with '1' (generic SS58) or other prefixes like '5'
    // and are typically 47-48 characters long using base58 encoding
    return /^[1-9A-HJ-NP-Za-km-z]{47,48}$/.test(address);
  }

  /**
   * Validate that the import source is compatible with Polkadot addresses.
   */
  async canImport(params: ImportParams): Promise<boolean> {
    return this.canImportSpecific(params);
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.addresses?.length) {
      this.logger.error('No addresses provided for Polkadot import');
      return false;
    }

    // Basic validation for Polkadot addresses (SS58 format)
    for (const address of params.addresses) {
      if (!this.isValidPolkadotAddress(address)) {
        this.logger.error(`Invalid Polkadot address format: ${address}`);
        return false;
      }
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('polkadot');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      health => health.isHealthy && health.circuitState !== 'OPEN'
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Polkadot providers available');
      return false;
    }

    this.logger.info('Polkadot source validation passed');
    return true;
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
  async import(params: ImportParams): Promise<ImportRunResult<SubscanTransfer>> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Polkadot transaction import');
    }

    this.logger.info(`Starting Polkadot transaction import for ${params.addresses.length} addresses`);

    const allSourcedTransactions: ApiClientRawData<SubscanTransfer>[] = [];

    for (const address of params.addresses) {
      this.logger.info(`Importing transactions for Polkadot address: ${address.substring(0, 20)}...`);

      try {
        const result = await this.providerManager.executeWithFailover('polkadot', {
          address: address,
          getCacheKey: cacheParams =>
            `dot_raw_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
          since: params.since,
          type: 'getRawAddressTransactions',
        });

        // Transform raw response to individual transactions with provider provenance
        const rawData = result.data;
        if (rawData && typeof rawData === 'object' && 'data' in rawData) {
          const substrateTxData = rawData as { data: SubscanTransfer[] };

          if (Array.isArray(substrateTxData.data)) {
            const rawTransactions: ApiClientRawData<SubscanTransfer>[] = substrateTxData.data.map(transfer => ({
              providerId: result.providerName,
              rawData: transfer,
            }));

            allSourcedTransactions.push(...rawTransactions);

            this.logger.info(
              `Imported ${rawTransactions.length} raw transactions for address via provider ${result.providerName}`
            );
          }
        } else {
          this.logger.warn(`Unexpected data format from provider ${result.providerName} for address ${address}`);
        }
      } catch (error) {
        this.logger.error(
          `Failed to import transactions for address ${address}: ${error instanceof Error ? error.message : String(error)}`
        );
        // Continue with other addresses rather than failing completely
      }
    }

    // Sort by timestamp (newest first)
    allSourcedTransactions.sort((a, b) => {
      const timestampA = a.rawData.block_timestamp || 0;
      const timestampB = b.rawData.block_timestamp || 0;
      return timestampB - timestampA;
    });

    this.logger.info(`Polkadot transaction import completed - Total: ${allSourcedTransactions.length}`);

    return {
      rawData: allSourcedTransactions,
    };
  }
}
