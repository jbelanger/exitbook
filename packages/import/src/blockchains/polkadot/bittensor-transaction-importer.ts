import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams, ImportRunResult } from '../../shared/importers/interfaces.ts';
import type { ApiClientRawData } from '../../shared/processors/interfaces.ts';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
// Ensure providers are registered
import './api/index.ts';
import type { TaostatsTransaction } from './types.ts';

/**
 * Bittensor transaction importer that fetches raw transaction data from Taostats API.
 * Uses provider manager for failover between multiple Bittensor API providers.
 */
export class BittensorTransactionImporter extends BaseImporter<TaostatsTransaction> {
  private providerManager: BlockchainProviderManager;

  constructor(dependencies: IDependencyContainer, options?: { preferredProvider?: string | undefined }) {
    super('bittensor');

    if (!dependencies.providerManager) {
      throw new Error('Provider manager required for Bittensor importer');
    }

    this.providerManager = dependencies.providerManager;

    // Auto-register providers for bittensor mainnet
    this.providerManager.autoRegisterFromConfig('bittensor', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Bittensor transaction importer - ProvidersCount: ${this.providerManager.getProviders('bittensor').length}`
    );
  }

  /**
   * Validate Bittensor address format (SS58 validation for TAO network).
   */
  private isValidBittensorAddress(address: string): boolean {
    // Bittensor addresses start with '5' and are typically 47-48 characters long using base58 encoding
    return /^5[1-9A-HJ-NP-Za-km-z]{46,47}$/.test(address);
  }

  /**
   * Validate that the import source is compatible with Bittensor addresses.
   */
  async canImport(params: ImportParams): Promise<boolean> {
    return this.canImportSpecific(params);
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.addresses?.length) {
      this.logger.error('No addresses provided for Bittensor import');
      return false;
    }

    // Basic validation for Bittensor addresses (SS58 format)
    for (const address of params.addresses) {
      if (!this.isValidBittensorAddress(address)) {
        this.logger.error(`Invalid Bittensor address format: ${address}`);
        return false;
      }
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('bittensor');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      health => health.isHealthy && health.circuitState !== 'OPEN'
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Bittensor providers available');
      return false;
    }

    this.logger.info('Bittensor source validation passed');
    return true;
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
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Bittensor transaction import');
    }

    this.logger.info(`Starting Bittensor transaction import for ${params.addresses.length} addresses`);

    const allRawTransactions: ApiClientRawData<TaostatsTransaction>[] = [];

    for (const address of params.addresses) {
      this.logger.info(`Importing transactions for Bittensor address: ${address.substring(0, 20)}...`);

      try {
        const result = await this.providerManager.executeWithFailover('bittensor', {
          address: address,
          getCacheKey: cacheParams =>
            `tao_raw_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
          since: params.since,
          type: 'getRawAddressTransactions',
        });

        // Transform raw response to individual transactions with provider provenance
        const rawData = result.data;
        if (rawData && typeof rawData === 'object' && 'data' in rawData) {
          const bittensorTxData = rawData as { data: TaostatsTransaction[] };

          if (Array.isArray(bittensorTxData.data)) {
            const rawTransactions: ApiClientRawData<TaostatsTransaction>[] = bittensorTxData.data.map(transaction => ({
              providerId: result.providerName,
              rawData: transaction,
            }));

            allRawTransactions.push(...rawTransactions);

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

    // Remove duplicates based on transaction hash/ID
    const uniqueTransactions = new Map<string, ApiClientRawData<TaostatsTransaction>>();
    for (const tx of allRawTransactions) {
      const txId = this.getTransactionId(tx.rawData);
      if (!uniqueTransactions.has(txId)) {
        uniqueTransactions.set(txId, tx);
      }
    }

    const deduplicatedTransactions = Array.from(uniqueTransactions.values());

    // Sort by timestamp or block number (newest first)
    deduplicatedTransactions.sort((a, b) => {
      const timestampA = a.rawData.timestamp || a.rawData.block_number || 0;
      const timestampB = b.rawData.timestamp || b.rawData.block_number || 0;
      return timestampB - timestampA;
    });

    this.logger.info(
      `Bittensor transaction import completed - Total: ${allRawTransactions.length}, Unique: ${deduplicatedTransactions.length}`
    );

    return {
      rawData: deduplicatedTransactions,
    };
  }
}
