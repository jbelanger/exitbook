import type { ApiClientRawData, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { err, ok, type Result } from 'neverthrow';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

// Ensure Avalanche API clients are registered
import './register-apis.js';
import type {
  SnowtraceInternalTransaction,
  SnowtraceTransaction,
  SnowtraceTokenTransfer,
} from './snowtrace/snowtrace.types.ts';

/**
 * Avalanche transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports multiple transaction types (regular, internal, token) from Snowtrace providers.
 * Uses provider manager for failover between multiple Avalanche API providers.
 */
export class AvalancheTransactionImporter extends BaseImporter {
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    super('avalanche');

    if (!blockchainProviderManager) {
      throw new Error('Provider manager required for Avalanche importer');
    }

    this.providerManager = blockchainProviderManager;

    // Auto-register providers for avalanche mainnet
    this.providerManager.autoRegisterFromConfig('avalanche', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Avalanche transaction importer - ProvidersCount: ${this.providerManager.getProviders('avalanche').length}`
    );
  }

  /**
   * Import raw transaction data from Avalanche blockchain APIs.
   */
  async import(params: ImportParams): Promise<ImportRunResult> {
    if (!params.address) {
      throw new Error('Address is required for Avalanche import');
    }

    this.logger.info(`Importing transactions for address: ${params.address.substring(0, 20)}...`);

    // Validate Avalanche address
    if (!this.validateAddress(params.address)) {
      this.logger.warn(`Invalid Avalanche address: ${params.address}`);
      return { rawData: [] };
    }

    const result = await this.fetchRawTransactionsForAddress(params.address, params.since);
    if (result.isErr()) {
      this.logger.error(`Failed to import transactions for address ${params.address} - Error: ${result.error.message}`);
      throw result.error;
    }

    const addressTransactions = result.value;

    this.logger.info(`Total transactions imported: ${addressTransactions.length}`);
    return {
      rawData: addressTransactions,
    };
  }

  /**
   * Check if the importer can handle the specified import parameters.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    return Promise.resolve(!!params.address);
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<Result<ApiClientRawData[], ProviderError>> {
    const rawTransactions: ApiClientRawData[] = [];

    // Fetch normal and internal transactions
    const normalResult = await this.providerManager.executeWithFailover('avalanche', {
      address,
      getCacheKey: (params) =>
        `avalanche:normal-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since,
      type: 'getRawAddressTransactions',
    });

    if (normalResult.isErr()) {
      this.logger.error(`Failed to fetch normal transactions for address ${address}: ${normalResult.error.message}`);
      return err(normalResult.error);
    }

    if (normalResult.value.data) {
      const compositeData = normalResult.value.data as {
        internal: SnowtraceInternalTransaction[];
        normal: SnowtraceTransaction[];
      };

      // Process normal transactions
      if (compositeData.normal && Array.isArray(compositeData.normal)) {
        for (const tx of compositeData.normal) {
          rawTransactions.push({
            metadata: { providerId: normalResult.value.providerName, transactionType: 'normal' },
            rawData: tx,
          });
        }
      }

      // Process internal transactions
      if (compositeData.internal && Array.isArray(compositeData.internal)) {
        for (const tx of compositeData.internal) {
          rawTransactions.push({
            metadata: { providerId: normalResult.value.providerName, transactionType: 'internal' },
            rawData: tx,
          });
        }
      }
    }

    // Fetch token transactions separately
    const tokenResult = await this.providerManager.executeWithFailover('avalanche', {
      address,
      getCacheKey: (params) =>
        `avalanche:token-txs:${params.type === 'getTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getTokenTransactions' ? params.since || 'all' : 'unknown'}`,
      since,
      type: 'getTokenTransactions',
    });

    if (tokenResult.isErr()) {
      this.logger.debug(
        `No token transactions available for ${address.substring(0, 20)}...: ${tokenResult.error.message}`
      );
    } else if (tokenResult.value.data && Array.isArray(tokenResult.value.data)) {
      const tokenTransactions = tokenResult.value.data as SnowtraceTokenTransfer[];
      for (const tx of tokenTransactions) {
        rawTransactions.push({
          metadata: { providerId: tokenResult.value.providerName, transactionType: 'token' },
          rawData: tx,
        });
      }
    }

    this.logger.debug(`Fetched ${rawTransactions.length} transactions for address: ${address.substring(0, 20)}...`);
    return ok(rawTransactions);
  }

  /**
   * Validate Avalanche C-Chain address format (Ethereum-style addresses).
   */
  private validateAddress(address: string): boolean {
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
  }
}
