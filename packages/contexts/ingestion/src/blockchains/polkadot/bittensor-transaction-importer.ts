import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { ImportParams, ImportRunResult } from '../../shared/importers/interfaces.js';
import type { ApiClientRawData } from '../../shared/processors/interfaces.js';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.js';

// Ensure providers are registered
import './api/index.js';
import type { TaostatsTransaction } from './types.js';

/**
 * Bittensor transaction importer that fetches raw transaction data from Taostats API.
 * Uses provider manager for failover between multiple Bittensor API providers.
 */
export class BittensorTransactionImporter extends BaseImporter<TaostatsTransaction> {
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined },
  ) {
    super('bittensor');

    if (!blockchainProviderManager) {
      throw new Error('Provider manager required for Bittensor importer');
    }

    this.providerManager = blockchainProviderManager;

    // Auto-register providers for bittensor mainnet
    this.providerManager.autoRegisterFromConfig('bittensor', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Bittensor transaction importer - ProvidersCount: ${this.providerManager.getProviders('bittensor').length}`,
    );
  }

  /**
   * Validate that the import source is compatible with Bittensor addresses.
   */
  override async canImport(params: ImportParams): Promise<boolean> {
    return Promise.resolve(this.canImportSpecific(params));
  }

  /**
   * Get transaction ID from Taostats transaction.
   */
  public getTransactionId(transaction: TaostatsTransaction): string {
    return transaction.hash || `${transaction.block_number}-${transaction.block}`;
  }

  /**
   * Import raw transaction data from Bittensor blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<ImportRunResult<TaostatsTransaction>> {
    if (!params.address?.length) {
      throw new Error('Address required for Bittensor transaction import');
    }

    this.logger.info(
      `Starting Bittensor transaction import for address: ${params.address.substring(0, 20)}...`,
    );

    const allRawTransactions: ApiClientRawData<TaostatsTransaction>[] = [];

    this.logger.info(
      `Importing transactions for Bittensor address: ${params.address.substring(0, 20)}...`,
    );

    try {
      const result = await this.providerManager.executeWithFailover('bittensor', {
        address: params.address,
        getCacheKey: (cacheParams) =>
          `tao_raw_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
        since: params.since,
        type: 'getRawAddressTransactions',
      });

      // Transform raw response to individual transactions with provider provenance
      const rawData = result.data;
      if (rawData && typeof rawData === 'object' && 'data' in rawData) {
        const bittensorTxData = rawData as { data: TaostatsTransaction[] };

        if (Array.isArray(bittensorTxData.data)) {
          const rawTransactions: ApiClientRawData<TaostatsTransaction>[] = bittensorTxData.data.map(
            (transaction) => ({
              providerId: result.providerName,
              rawData: transaction,
            }),
          );

          allRawTransactions.push(...rawTransactions);

          this.logger.info(
            `Imported ${rawTransactions.length} raw transactions for address via provider ${result.providerName}`,
          );
        }
      } else {
        this.logger.warn(
          `Unexpected data format from provider ${result.providerName} for address ${params.address}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to import transactions for address ${params.address}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Continue with other addresses rather than failing completely
    }

    // Sort by timestamp or block number (newest first)
    allRawTransactions.sort((a, b) => {
      const timestampA = a.rawData.timestamp || a.rawData.block_number || 0;
      const timestampB = b.rawData.timestamp || b.rawData.block_number || 0;
      return timestampB - timestampA;
    });

    this.logger.info(
      `Bittensor transaction import completed - Total: ${allRawTransactions.length}`,
    );

    return {
      rawData: allRawTransactions,
    };
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.address?.length) {
      this.logger.error('No address provided for Bittensor import');
      return Promise.resolve(false);
    }

    // Basic validation for Bittensor addresses (SS58 format)
    if (!this.isValidBittensorAddress(params.address)) {
      this.logger.error(`Invalid Bittensor address format: ${params.address}`);
      return Promise.resolve(false);
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('bittensor');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      (health) => health.isHealthy && health.circuitState !== 'OPEN',
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Bittensor providers available');
      return Promise.resolve(false);
    }

    this.logger.info('Bittensor source validation passed');
    return Promise.resolve(true);
  }

  /**
   * Validate Bittensor address format (SS58 validation for TAO network).
   */
  private isValidBittensorAddress(address: string): boolean {
    // Bittensor addresses start with '5' and are typically 47-48 characters long using base58 encoding
    return /^5[1-9A-HJ-NP-Za-km-z]{46,47}$/.test(address);
  }
}
