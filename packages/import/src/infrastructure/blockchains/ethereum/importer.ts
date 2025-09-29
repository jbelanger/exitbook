import type { ApiClientRawData, ImportParams, ImportRunResult } from '../../../app/ports/importers.ts';
import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';

// Ensure Ethereum API clients are registered
import './register-apis.ts';

/**
 * Ethereum transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports multiple provider types (Alchemy, Moralis) with different data formats.
 * Uses provider manager for failover between multiple Ethereum API providers.
 */
export class EthereumTransactionImporter extends BaseImporter {
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    super('ethereum');

    if (!blockchainProviderManager) {
      throw new Error('Provider manager required for Ethereum importer');
    }

    this.providerManager = blockchainProviderManager;

    // Auto-register providers for ethereum mainnet
    this.providerManager.autoRegisterFromConfig('ethereum', 'mainnet', options?.preferredProvider);

    this.logger.info(
      `Initialized Ethereum transaction importer - ProvidersCount: ${this.providerManager.getProviders('ethereum').length}`
    );
  }

  async import(params: ImportParams): Promise<ImportRunResult> {
    if (!(await this.canImportSpecific(params))) {
      throw new Error('Cannot import - validation failed');
    }

    const allRawData: ApiClientRawData[] = [];

    if (!params.address) {
      return {
        rawData: [],
      };
    }

    const address = params.address;

    this.logger.info(`Starting Ethereum import for ${address}`);

    this.logger.info(`Fetching Ethereum transactions for address: ${address.substring(0, 20)}...`);

    try {
      // Fetch regular ETH transactions
      const regularTxs = await this.fetchRegularTransactions(address, params.since);
      allRawData.push(...regularTxs);

      // Fetch ERC-20 token transactions (if supported by provider)
      const tokenTxs = await this.fetchTokenTransactions(address, params.since);
      allRawData.push(...tokenTxs);

      this.logger.info(
        `Ethereum import for ${address.substring(0, 20)}... - Regular: ${regularTxs.length}, Token: ${tokenTxs.length}, Total: ${regularTxs.length + tokenTxs.length}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to import transactions for address ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }

    this.logger.info(`Ethereum import completed - Raw transactions collected: ${allRawData.length}`);

    return {
      rawData: allRawData,
    };
  }

  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.address || params.address?.length === 0) {
      this.logger.debug('No address provided for Ethereum import');
      return false;
    }

    // Validate all provided addresses
    if (!this.isValidEthereumAddress(params.address)) {
      this.logger.error(`Invalid Ethereum address format: ${params.address}`);
      return false;
    }

    // Check if we have any providers available
    const availableProviders = this.providerManager.getProviders('ethereum');
    if (availableProviders.length === 0) {
      this.logger.error('No Ethereum providers available');
      return false;
    }

    return Promise.resolve(true);
  }

  /**
   * Fetch regular ETH transactions for a single address with provider provenance.
   */
  private async fetchRegularTransactions(address: string, since?: number): Promise<ApiClientRawData[]> {
    try {
      const result = await this.providerManager.executeWithFailover('ethereum', {
        address: address,
        getCacheKey: (params) =>
          `ethereum:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
        since: since,
        type: 'getRawAddressTransactions',
      });

      const rawTransactions = Array.isArray(result.data) ? result.data : [result.data];

      // Create raw data entries with provider provenance
      return rawTransactions.map((tx: unknown) => ({
        metadata: { providerId: result.providerName, sourceAddress: address, transactionType: 'normal' },
        rawData: tx,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch regular transactions for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Fetch ERC-20 token transactions for a single address with provider provenance.
   */
  private async fetchTokenTransactions(address: string, since?: number): Promise<ApiClientRawData[]> {
    try {
      const result = await this.providerManager.executeWithFailover('ethereum', {
        address: address,
        getCacheKey: (params) =>
          `ethereum:token-txs:${params.type === 'getTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getTokenTransactions' ? params.since || 'all' : 'unknown'}`,
        since: since,
        type: 'getTokenTransactions',
      });

      const rawTokenTransactions = Array.isArray(result.data) ? result.data : [result.data];

      // Create raw data entries with provider provenance
      return rawTokenTransactions.map((tx: unknown) => ({
        metadata: { providerId: result.providerName, sourceAddress: address, transactionType: 'token' },
        rawData: tx,
      }));
    } catch (error) {
      // Token transactions are optional - providers may not support them
      this.logger.debug(
        `Token transactions not available for ${address} or provider doesn't support them - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /**
   * Validate Ethereum address format.
   */
  private isValidEthereumAddress(address: string): boolean {
    // Ethereum addresses are 42 characters long (including 0x prefix) and hexadecimal
    const ethereumAddressPattern = /^0x[a-fA-F0-9]{40}$/;
    return ethereumAddressPattern.test(address);
  }
}
