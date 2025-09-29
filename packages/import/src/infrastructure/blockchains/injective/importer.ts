import type { ImportParams, ImportRunResult, ApiClientRawData } from '@exitbook/import/app/ports/importers.js';
import { err, ok, type Result } from 'neverthrow';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

import type { InjectiveExplorerTransaction } from './injective-explorer/injective-explorer.types.js';
// Ensure Injective API clients are registered
import './register-apis.js';

/**
 * Injective transaction importer that fetches raw transaction data from blockchain APIs.
 * Uses provider manager for failover between multiple Injective API providers (Explorer API, LCD API).
 */
export class InjectiveTransactionImporter extends BaseImporter {
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    super('injective');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for Injective importer');
    }

    this.providerManager = blockchainProviderManager;

    // Auto-register providers for injective mainnet
    this.providerManager.autoRegisterFromConfig('injective', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Injective transaction importer - ProvidersCount: ${this.providerManager.getProviders('injective').length}`
    );
  }

  /**
   * Import raw transaction data from Injective blockchain APIs with provider provenance.
   */
  async import(params: ImportParams): Promise<ImportRunResult> {
    if (!params.address?.length) {
      throw new Error('Address required for Injective transaction import');
    }

    this.logger.info(`Starting Injective transaction import for address: ${params.address.substring(0, 20)}...`);

    this.logger.info(`Importing transactions for address: ${params.address.substring(0, 20)}...`);

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);

    if (result.isErr()) {
      this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${result.error.message}`);
      throw result.error;
    }

    const rawTransactions = result.value;

    this.logger.info(`Found ${rawTransactions.length} transactions for address ${params.address.substring(0, 20)}...`);

    this.logger.info(`Injective import completed: ${rawTransactions.length} transactions`);
    return {
      rawData: rawTransactions,
    };
  }

  /**
   * Validate source parameters and connectivity.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.address?.length) {
      this.logger.error('No address provided for Injective import');
      return false;
    }

    // Validate address formats
    if (!this.isValidInjectiveAddress(params.address)) {
      this.logger.error(`Invalid Injective address format: ${params.address}`);
      return false;
    }

    // Test provider connectivity
    const healthStatus = this.providerManager.getProviderHealth('injective');
    const hasHealthyProvider = Array.from(healthStatus.values()).some(
      (health) => health.isHealthy && health.circuitState !== 'OPEN'
    );

    if (!hasHealthyProvider) {
      this.logger.error('No healthy Injective providers available');
      return false;
    }

    this.logger.info('Injective source validation passed');
    return Promise.resolve(true);
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<Result<ApiClientRawData[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('injective', {
      address: address,
      getCacheKey: (params) =>
        `injective:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getRawAddressTransactions',
    });

    if (result.isErr()) {
      this.logger.error(`Provider manager failed to fetch transactions for ${address}: ${result.error.message}`);
      return err(result.error);
    }

    const rawTransactions = result.value.data as InjectiveExplorerTransaction[];
    const providerId = result.value.providerName;

    // Wrap each transaction with provider provenance and source address context
    return ok(
      rawTransactions.map((rawData) => ({
        metadata: { providerId, sourceAddress: address },
        rawData,
      }))
    );
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
}
