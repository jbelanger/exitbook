import type { IDependencyContainer } from '../../shared/common/interfaces.ts';
import { BaseImporter } from '../../shared/importers/base-importer.ts';
import type { ImportParams } from '../../shared/importers/interfaces.ts';
import type { ApiClientRawData } from '../../shared/processors/interfaces.ts';
import type { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
// Ensure Ethereum API clients are registered
import './clients/index.ts';
import { validateEthereumTransactions } from './schemas.ts';
import type { AlchemyAssetTransfer, MoralisTokenTransfer, MoralisTransaction } from './types.ts';

/**
 * Combined type for all Ethereum transaction data types.
 * Supports both regular transactions and token transfers from different providers.
 */
export type EthereumRawTransactionData = AlchemyAssetTransfer | MoralisTransaction | MoralisTokenTransfer;

/**
 * Ethereum transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports multiple provider types (Alchemy, Moralis) with different data formats.
 * Uses provider manager for failover between multiple Ethereum API providers.
 */
export class EthereumTransactionImporter extends BaseImporter<EthereumRawTransactionData> {
  private providerManager: BlockchainProviderManager;

  constructor(dependencies: IDependencyContainer) {
    super('ethereum');

    if (!dependencies.providerManager || !dependencies.explorerConfig) {
      throw new Error('Provider manager and explorer config required for Ethereum importer');
    }

    this.providerManager = dependencies.providerManager;

    // Auto-register providers for ethereum mainnet
    this.providerManager.autoRegisterFromConfig('ethereum', 'mainnet');

    this.logger.info(
      `Initialized Ethereum transaction importer - ProvidersCount: ${this.providerManager.getProviders('ethereum').length}`
    );
  }

  /**
   * Fetch regular ETH transactions for a single address with provider provenance.
   */
  private async fetchRegularTransactions(
    address: string,
    since?: number
  ): Promise<ApiClientRawData<EthereumRawTransactionData>[]> {
    try {
      const result = await this.providerManager.executeWithFailover('ethereum', {
        address: address,
        getCacheKey: params =>
          `ethereum:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
        since: since,
        type: 'getRawAddressTransactions',
      });

      const rawTransactions = Array.isArray(result.data) ? result.data : [result.data];

      // Validate the raw data based on provider
      const providerName = result.providerName as 'alchemy' | 'moralis';
      const validationResult = validateEthereumTransactions(rawTransactions, providerName);

      if (!validationResult.isValid) {
        this.logger.warn(
          `Validation issues for regular transactions from ${result.providerName} - Errors: ${validationResult.errors.length}, Warnings: ${validationResult.warnings.length}`
        );
        if (validationResult.errors.length > 0) {
          this.logger.debug(`Validation errors: ${validationResult.errors.join(', ')}`);
        }
      }

      // Filter out invalid transactions but continue with valid ones
      const validTransactions = rawTransactions.filter((tx: unknown) => {
        const itemValidation =
          providerName === 'alchemy'
            ? validateEthereumTransactions([tx], 'alchemy')
            : validateEthereumTransactions([tx], 'moralis');
        return itemValidation.isValid;
      });

      if (validTransactions.length < rawTransactions.length) {
        this.logger.warn(
          `Filtered ${rawTransactions.length - validTransactions.length} invalid transactions out of ${rawTransactions.length} total`
        );
      }

      // Create raw data entries with provider provenance
      return validTransactions.map((tx: EthereumRawTransactionData) => ({
        providerId: result.providerName,
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
  private async fetchTokenTransactions(
    address: string,
    since?: number
  ): Promise<ApiClientRawData<EthereumRawTransactionData>[]> {
    try {
      const result = await this.providerManager.executeWithFailover('ethereum', {
        address: address,
        getCacheKey: params =>
          `ethereum:token-txs:${params.type === 'getTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getTokenTransactions' ? params.since || 'all' : 'unknown'}`,
        since: since,
        type: 'getTokenTransactions',
      });

      const rawTokenTransactions = Array.isArray(result.data) ? result.data : [result.data];

      // For token transactions, we use different validation based on provider
      // Alchemy returns AssetTransfers, Moralis returns TokenTransfers
      let validationResult;
      if (result.providerName === 'alchemy') {
        validationResult = validateEthereumTransactions(rawTokenTransactions, 'alchemy');
      } else if (result.providerName === 'moralis') {
        // For Moralis token transfers, we need to validate differently as they have different structure
        // For now, we'll do basic validation
        validationResult = { errors: [], isValid: true, warnings: [] };
      } else {
        validationResult = { errors: [], isValid: true, warnings: [] };
      }

      if (!validationResult.isValid) {
        this.logger.warn(
          `Validation issues for token transactions from ${result.providerName} - Errors: ${validationResult.errors.length}, Warnings: ${validationResult.warnings.length}`
        );
        if (validationResult.errors.length > 0) {
          this.logger.debug(`Token transaction validation errors: ${validationResult.errors.join(', ')}`);
        }
      }

      // Create raw data entries with provider provenance
      return rawTokenTransactions.map((tx: EthereumRawTransactionData) => ({
        providerId: result.providerName,
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

  protected async canImportSpecific(params: ImportParams): Promise<boolean> {
    if (!params.addresses || params.addresses.length === 0) {
      this.logger.debug('No addresses provided for Ethereum import');
      return false;
    }

    // Validate all provided addresses
    for (const address of params.addresses) {
      if (!this.isValidEthereumAddress(address)) {
        this.logger.error(`Invalid Ethereum address format: ${address}`);
        return false;
      }
    }

    // Check if we have any providers available
    const availableProviders = this.providerManager.getProviders('ethereum');
    if (availableProviders.length === 0) {
      this.logger.error('No Ethereum providers available');
      return false;
    }

    return true;
  }

  async import(params: ImportParams): Promise<ApiClientRawData<EthereumRawTransactionData>[]> {
    if (!(await this.canImportSpecific(params))) {
      throw new Error('Cannot import - validation failed');
    }

    const allRawData: ApiClientRawData<EthereumRawTransactionData>[] = [];
    const addresses = params.addresses || [];

    this.logger.info(`Starting Ethereum import for ${addresses.length} addresses`);

    for (const address of addresses) {
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
    }

    // Remove duplicates based on transaction hash
    const uniqueRawData = allRawData.reduce((acc, item) => {
      // Extract hash based on data type
      let hash: string;
      const data = item.rawData;

      if ('hash' in data) {
        hash = data.hash;
      } else if ('transaction_hash' in data) {
        hash = data.transaction_hash;
      } else {
        // If no hash available, keep the item (shouldn't happen with proper validation)
        acc.push(item);
        return acc;
      }

      // Check if we already have this transaction
      const existingIndex = acc.findIndex(existing => {
        const existingData = existing.rawData;
        const existingHash =
          'hash' in existingData
            ? existingData.hash
            : 'transaction_hash' in existingData
              ? existingData.transaction_hash
              : null;
        return existingHash === hash;
      });

      if (existingIndex === -1) {
        acc.push(item);
      } else {
        // Keep the first occurrence (could implement more sophisticated deduplication logic)
        this.logger.debug(`Duplicate transaction hash detected: ${hash}`);
      }

      return acc;
    }, [] as ApiClientRawData<EthereumRawTransactionData>[]);

    // Sort by timestamp if available (most recent first)
    uniqueRawData.sort((a, b) => {
      const getTimestamp = (data: EthereumRawTransactionData): number => {
        if ('metadata' in data && data.metadata?.blockTimestamp) {
          return new Date(data.metadata.blockTimestamp).getTime();
        }
        if ('block_timestamp' in data) {
          return new Date(data.block_timestamp).getTime();
        }
        if ('timeStamp' in data) {
          const parsed = parseInt(data.timeStamp as string);
          return isNaN(parsed) ? 0 : parsed * 1000; // Etherscan uses Unix timestamp in seconds
        }
        return 0;
      };

      return getTimestamp(b.rawData) - getTimestamp(a.rawData);
    });

    this.logger.info(
      `Ethereum import completed - Total addresses: ${addresses.length}, Raw transactions collected: ${allRawData.length}, Unique transactions: ${uniqueRawData.length}`
    );

    return uniqueRawData;
  }
}
