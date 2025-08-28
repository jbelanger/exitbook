import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams, ImportRunResult } from '../../shared/importers/interfaces.ts';
import type { ApiClientRawData } from '../../shared/processors/interfaces.ts';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
// Ensure Injective API clients are registered
import './api/index.ts';
import type { InjectiveTransaction } from './types.ts';

/**
 * Injective transaction importer that fetches raw transaction data from blockchain APIs.
 * Uses provider manager for failover between multiple Injective API providers (Explorer API, LCD API).
 */
export class InjectiveTransactionImporter extends BaseImporter<InjectiveTransaction> {
  private providerManager: BlockchainProviderManager;

  constructor(dependencies: IDependencyContainer) {
    super('injective');

    if (!dependencies.providerManager || !dependencies.explorerConfig) {
      throw new Error('Provider manager and explorer config required for Injective importer');
    }

    this.providerManager = dependencies.providerManager;

    // Auto-register providers for injective mainnet
    this.providerManager.autoRegisterFromConfig('injective', 'mainnet');

    this.logger.info(
      `Initialized Injective transaction importer - ProvidersCount: ${this.providerManager.getProviders('injective').length}`
    );
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<ApiClientRawData<InjectiveTransaction>[]> {
    try {
      const result = await this.providerManager.executeWithFailover('injective', {
        address: address,
        getCacheKey: params =>
          `injective:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
        since: since,
        type: 'getRawAddressTransactions',
      });

      const rawTransactions = result.data as InjectiveTransaction[];
      const providerId = result.providerName;

      // Wrap each transaction with provider provenance and source address context
      return rawTransactions.map(rawData => ({
        providerId,
        rawData,
        sourceAddress: address,
      }));
    } catch (error) {
      this.logger.error(`Provider manager failed to fetch transactions for ${address}: ${error}`);
      throw error;
    }
  }

  /**
   * Validate Injective address format.
   */
  private isValidInjectiveAddress(address: string): boolean {
    try {
      // Injective addresses start with 'inj' and are bech32 encoded (39 characters total)
      if (!/^inj1[a-z0-9]{38}$/.test(address)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove duplicate transactions based on hash.
   */
  private removeDuplicateTransactions(
    rawTransactions: ApiClientRawData<InjectiveTransaction>[]
  ): ApiClientRawData<InjectiveTransaction>[] {
    const uniqueTransactions = new Map<string, ApiClientRawData<InjectiveTransaction>>();

    for (const rawTx of rawTransactions) {
      const txHash = rawTx.rawData.hash;
      if (!uniqueTransactions.has(txHash)) {
        uniqueTransactions.set(txHash, rawTx);
      }
    }

    return Array.from(uniqueTransactions.values());
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.addresses?.length) {
      this.logger.error('No addresses provided for Injective import');
      return false;
    }

    // Validate address formats
    for (const address of params.addresses) {
      if (!this.isValidInjectiveAddress(address)) {
        this.logger.error(`Invalid Injective address format: ${address}`);
        return false;
      }
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('injective');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      health => health.isHealthy && health.circuitState !== 'OPEN'
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Injective providers available');
      return false;
    }

    this.logger.info('Injective source validation passed');
    return true;
  }

  /**
   * Import raw transaction data from Injective blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<ImportRunResult<InjectiveTransaction>> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Injective transaction import');
    }

    this.logger.info(`Starting Injective transaction import for ${params.addresses.length} addresses`);

    const allSourcedTransactions: ApiClientRawData<InjectiveTransaction>[] = [];

    for (const address of params.addresses) {
      this.logger.info(`Importing transactions for address: ${address.substring(0, 20)}...`);

      try {
        const rawTransactions = await this.fetchRawTransactionsForAddress(address, params.since);
        allSourcedTransactions.push(...rawTransactions);

        this.logger.info(`Found ${rawTransactions.length} transactions for address ${address.substring(0, 20)}...`);
      } catch (error) {
        this.handleImportError(error, `fetching transactions for ${address}`);
      }
    }

    // Remove duplicates based on hash
    const uniqueTransactions = this.removeDuplicateTransactions(allSourcedTransactions);

    // Sort by block timestamp (newest first)
    uniqueTransactions.sort((a, b) => {
      const timestampA = new Date(a.rawData.block_timestamp).getTime();
      const timestampB = new Date(b.rawData.block_timestamp).getTime();
      return timestampB - timestampA;
    });

    this.logger.info(`Injective import completed: ${uniqueTransactions.length} unique transactions`);
    return {
      rawData: uniqueTransactions,
    };
  }
}
