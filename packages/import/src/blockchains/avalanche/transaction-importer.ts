import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { ImportParams, ImportRunResult } from '../../shared/importers/interfaces.js';
import type { ApiClientRawData } from '../../shared/processors/interfaces.js';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.js';

// Ensure Avalanche API clients are registered
import './api/index.js';
import type { SnowtraceInternalTransaction, SnowtraceTokenTransfer, SnowtraceTransaction } from './types.js';

/**
 * Combined type for all Avalanche transaction data types.
 * Supports regular transactions, internal transactions, and token transfers from Snowtrace.
 */
export type AvalancheRawTransactionData = SnowtraceTransaction | SnowtraceInternalTransaction | SnowtraceTokenTransfer;

/**
 * Avalanche transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports multiple transaction types (regular, internal, token) from Snowtrace providers.
 * Uses provider manager for failover between multiple Avalanche API providers.
 */
export class AvalancheTransactionImporter extends BaseImporter<AvalancheRawTransactionData> {
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
  async import(params: ImportParams): Promise<ImportRunResult<AvalancheRawTransactionData>> {
    if (!params.address) {
      throw new Error('Address is required for Avalanche import');
    }

    const allSourcedTransactions: ApiClientRawData<AvalancheRawTransactionData>[] = [];

    this.logger.info(`Importing transactions for address: ${params.address.substring(0, 20)}...`);

    // Validate Avalanche address
    if (!this.validateAddress(params.address)) {
      this.logger.warn(`Invalid Avalanche address: ${params.address}`);
      return { rawData: [] };
    }

    const addressTransactions = await this.fetchRawTransactionsForAddress(params.address, params.since);
    allSourcedTransactions.push(...addressTransactions);

    // Sort by timestamp
    const sortedTransactions = allSourcedTransactions.sort((a, b) => {
      const timestampA = parseInt(a.rawData.timeStamp);
      const timestampB = parseInt(b.rawData.timeStamp);
      return timestampB - timestampA;
    });

    this.logger.info(`Total transactions imported: ${sortedTransactions.length}`);
    return {
      rawData: sortedTransactions,
    };
  }

  /**
   * Check if the importer can handle the specified import parameters.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    return Promise.resolve(!!params.address);
  }

  /**
   * Extract unique transaction identifier from raw transaction data.
   * Include provider type to prevent deduplication of different transaction types with same hash.
   */
  protected getTransactionId(rawData: AvalancheRawTransactionData): string {
    // Determine transaction type based on structure to create unique keys
    if ('tokenSymbol' in rawData) {
      return `${rawData.hash}-token`;
    } else if ('type' in rawData && rawData.type === 'call') {
      return `${rawData.hash}-internal`;
    } else {
      return `${rawData.hash}-normal`;
    }
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<ApiClientRawData<AvalancheRawTransactionData>[]> {
    const rawTransactions: ApiClientRawData<AvalancheRawTransactionData>[] = [];

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
              providerId: normalResult.providerName,
              rawData: tx,
              transactionType: 'normal',
            });
          }
        }

        // Process internal transactions
        if (compositeData.internal && Array.isArray(compositeData.internal)) {
          for (const tx of compositeData.internal) {
            rawTransactions.push({
              providerId: normalResult.providerName,
              rawData: tx,
              transactionType: 'internal',
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
              providerId: tokenResult.providerName,
              rawData: tx,
              transactionType: 'token',
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
