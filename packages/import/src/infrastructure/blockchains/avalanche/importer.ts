import type { ApiClientRawData, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.js';

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

    const addressTransactions = await this.fetchRawTransactionsForAddress(params.address, params.since);

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
  private async fetchRawTransactionsForAddress(address: string, since?: number): Promise<ApiClientRawData[]> {
    const rawTransactions: ApiClientRawData[] = [];

    try {
      // Fetch normal and internal transactions
      const normalResult = await this.providerManager.executeWithFailover('avalanche', {
        address,
        getCacheKey: (params) =>
          `avalanche:normal-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
        since,
        type: 'getRawAddressTransactions',
      });

      if (normalResult.data) {
        const compositeData = normalResult.data as {
          internal: SnowtraceInternalTransaction[];
          normal: SnowtraceTransaction[];
        };

        // Process normal transactions
        if (compositeData.normal && Array.isArray(compositeData.normal)) {
          for (const tx of compositeData.normal) {
            rawTransactions.push({
              metadata: { providerId: normalResult.providerName, transactionType: 'normal' },
              rawData: tx,
            });
          }
        }

        // Process internal transactions
        if (compositeData.internal && Array.isArray(compositeData.internal)) {
          for (const tx of compositeData.internal) {
            rawTransactions.push({
              metadata: { providerId: normalResult.providerName, transactionType: 'internal' },
              rawData: tx,
            });
          }
        }
      }

      // Fetch token transactions separately
      try {
        const tokenResult = await this.providerManager.executeWithFailover('avalanche', {
          address,
          getCacheKey: (params) =>
            `avalanche:token-txs:${params.type === 'getTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getTokenTransactions' ? params.since || 'all' : 'unknown'}`,
          since,
          type: 'getTokenTransactions',
        });

        if (tokenResult.data && Array.isArray(tokenResult.data)) {
          const tokenTransactions = tokenResult.data as SnowtraceTokenTransfer[];
          for (const tx of tokenTransactions) {
            rawTransactions.push({
              metadata: { providerId: tokenResult.providerName, transactionType: 'token' },
              rawData: tx,
            });
          }
        }
      } catch (error) {
        this.logger.debug(`No token transactions available for ${address.substring(0, 20)}...: ${String(error)}`);
      }

      this.logger.debug(`Fetched ${rawTransactions.length} transactions for address: ${address.substring(0, 20)}...`);
      return rawTransactions;
    } catch (error) {
      this.logger.error(`Failed to fetch transactions for address ${address}: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Validate Avalanche C-Chain address format (Ethereum-style addresses).
   */
  private validateAddress(address: string): boolean {
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
  }
}
