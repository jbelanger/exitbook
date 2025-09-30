import type {
  RawTransactionWithMetadata,
  IImporter,
  ImportParams,
  ImportRunResult,
} from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { BlockchainProviderManager, ProviderError } from '../shared/blockchain-provider-manager.js';

/**
 * Ethereum transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports multiple provider types (Alchemy, Moralis) with different data formats.
 * Uses provider manager for failover between multiple Ethereum API providers.
 */
export class EthereumTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('ethereumImporter');

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

  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error('Address required for Ethereum transaction import'));
    }

    const address = params.address;

    this.logger.info(`Starting Ethereum import for ${address.substring(0, 20)}...`);

    const result = await this.fetchAllTransactions(address, params.since);

    return result
      .map((allRawData) => {
        this.logger.info(`Ethereum import completed - Raw transactions collected: ${allRawData.length}`);
        return { rawTransactions: allRawData };
      })
      .mapErr((error) => {
        this.logger.error(`Failed to import transactions for address ${address} - Error: ${error.message}`);
        return error;
      });
  }

  /**
   * Fetch all transaction types (regular and token) for an address.
   */
  private async fetchAllTransactions(
    address: string,
    since?: number
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    // Fetch regular ETH transactions (required)
    const regularTxsResult = await this.fetchRegularTransactions(address, since);

    if (regularTxsResult.isErr()) {
      return regularTxsResult;
    }

    // Fetch ERC-20 token transactions (optional)
    const tokenTxsResult = await this.fetchTokenTransactions(address, since);

    return tokenTxsResult
      .map((tokenTxs) => {
        const allRawData = [...regularTxsResult.value, ...tokenTxs];
        this.logger.debug(
          `Fetched ${regularTxsResult.value.length} regular and ${tokenTxs.length} token transactions for ${address.substring(0, 20)}...`
        );
        return allRawData;
      })
      .orElse((error) => {
        this.logger.debug(`Token transactions not available for ${address.substring(0, 20)}...: ${error.message}`);
        return ok(regularTxsResult.value);
      });
  }

  /**
   * Fetch regular ETH transactions for a single address with provider provenance.
   */
  private async fetchRegularTransactions(
    address: string,
    since?: number
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('ethereum', {
      address: address,
      getCacheKey: (params) =>
        `ethereum:raw-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getRawAddressTransactions',
    });

    return result.map((response) => {
      const rawTransactions = Array.isArray(response.data) ? response.data : [response.data];

      // Create raw data entries with provider provenance
      return rawTransactions.map((tx: unknown) => ({
        metadata: { providerId: response.providerName, sourceAddress: address, transactionType: 'normal' },
        rawData: tx,
      }));
    });
  }

  /**
   * Fetch ERC-20 token transactions for a single address with provider provenance.
   */
  private async fetchTokenTransactions(
    address: string,
    since?: number
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover('ethereum', {
      address: address,
      getCacheKey: (params) =>
        `ethereum:token-txs:${params.type === 'getTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getTokenTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getTokenTransactions',
    });

    return result.map((response) => {
      const rawTokenTransactions = Array.isArray(response.data) ? response.data : [response.data];

      // Create raw data entries with provider provenance
      return rawTokenTransactions.map((tx: unknown) => ({
        metadata: { providerId: response.providerName, sourceAddress: address, transactionType: 'token' },
        rawData: tx,
      }));
    });
  }
}
