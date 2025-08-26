import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams } from '../../shared/importers/interfaces.ts';
import type { ApiClientRawData } from '../../shared/processors/interfaces.ts';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
// Ensure Avalanche API clients are registered
import './clients/index.ts';
import type { SnowtraceInternalTransaction, SnowtraceTokenTransfer, SnowtraceTransaction } from './types.ts';

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

  constructor(dependencies: IDependencyContainer) {
    super('avalanche');

    if (!dependencies.providerManager || !dependencies.explorerConfig) {
      throw new Error('Provider manager and explorer config required for Avalanche importer');
    }

    this.providerManager = dependencies.providerManager;

    // Auto-register providers for avalanche mainnet
    this.providerManager.autoRegisterFromConfig('avalanche', 'mainnet');

    this.logger.info(
      `Initialized Avalanche transaction importer - ProvidersCount: ${this.providerManager.getProviders('avalanche').length}`
    );
  }

  /**
   * Fetch raw transactions for a single address with provider provenance.
   */
  private async fetchRawTransactionsForAddress(
    address: string,
    since?: number
  ): Promise<ApiClientRawData<AvalancheRawTransactionData>[]> {
    const sourcedTransactions: ApiClientRawData<AvalancheRawTransactionData>[] = [];

    try {
      // Fetch normal and internal transactions
      const normalResult = await this.providerManager.executeWithFailover('avalanche', {
        address,
        getCacheKey: params =>
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
            sourcedTransactions.push({
              providerId: normalResult.providerName,
              rawData: tx,
            });
          }
        }

        // Process internal transactions
        if (compositeData.internal && Array.isArray(compositeData.internal)) {
          for (const tx of compositeData.internal) {
            sourcedTransactions.push({
              providerId: 'snowtrace-internal',
              rawData: tx,
            });
          }
        }
      }

      // Fetch token transactions separately
      try {
        const tokenResult = await this.providerManager.executeWithFailover('avalanche', {
          address,
          getCacheKey: params =>
            `avalanche:token-txs:${params.type === 'getTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getTokenTransactions' ? params.since || 'all' : 'unknown'}`,
          since,
          type: 'getTokenTransactions',
        });

        if (tokenResult.data && Array.isArray(tokenResult.data)) {
          const tokenTransactions = tokenResult.data as SnowtraceTokenTransfer[];
          for (const tx of tokenTransactions) {
            sourcedTransactions.push({
              providerId: 'snowtrace-token',
              rawData: tx,
            });
          }
        }
      } catch (error) {
        this.logger.debug(`No token transactions available for ${address.substring(0, 20)}...: ${error}`);
      }

      this.logger.debug(
        `Fetched ${sourcedTransactions.length} transactions for address: ${address.substring(0, 20)}...`
      );
      return sourcedTransactions;
    } catch (error) {
      this.logger.error(`Failed to fetch transactions for address ${address}: ${error}`);
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

  /**
   * Check if the importer can handle the specified import parameters.
   */
  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    return Boolean(params.addresses?.length);
  }

  /**
   * Extract unique transaction identifier from raw transaction data.
   */
  protected getTransactionId(rawData: AvalancheRawTransactionData): string {
    return rawData.hash;
  }

  /**
   * Import raw transaction data from Avalanche blockchain APIs.
   */
  async import(params: ImportParams): Promise<ApiClientRawData<AvalancheRawTransactionData>[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Avalanche import');
    }

    const allSourcedTransactions: ApiClientRawData<AvalancheRawTransactionData>[] = [];

    for (const address of params.addresses) {
      this.logger.info(`Importing transactions for address: ${address.substring(0, 20)}...`);

      // Validate Avalanche address
      if (!this.validateAddress(address)) {
        this.logger.warn(`Invalid Avalanche address: ${address}`);
        continue;
      }

      const addressTransactions = await this.fetchRawTransactionsForAddress(address, params.since);
      allSourcedTransactions.push(...addressTransactions);
    }

    // Remove duplicates and sort by timestamp
    const uniqueTransactions = new Map<string, ApiClientRawData<AvalancheRawTransactionData>>();
    for (const tx of allSourcedTransactions) {
      const id = this.getTransactionId(tx.rawData);
      if (!uniqueTransactions.has(id)) {
        uniqueTransactions.set(id, tx);
      }
    }

    const sortedTransactions = Array.from(uniqueTransactions.values()).sort((a, b) => {
      const timestampA = parseInt(a.rawData.timeStamp);
      const timestampB = parseInt(b.rawData.timeStamp);
      return timestampB - timestampA;
    });

    this.logger.info(`Total unique transactions imported: ${sortedTransactions.length}`);
    return sortedTransactions;
  }
}
