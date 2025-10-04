import type { RawTransactionWithMetadata } from '@exitbook/data';
import type { IImporter, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import type { BlockchainProviderManager, EvmChainConfig, ProviderError } from '@exitbook/providers';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

/**
 * Generic EVM transaction importer that fetches raw transaction data from blockchain APIs.
 * Works with any EVM-compatible chain (Ethereum, Avalanche, Polygon, BSC, etc.).
 *
 * Fetches three types of transactions in parallel:
 * - Normal (external) transactions - REQUIRED
 * - Internal transactions (contract calls) - OPTIONAL
 * - Token transfers (ERC-20/721/1155) - OPTIONAL
 *
 * Uses provider manager for failover between multiple API providers.
 */
export class EvmImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;
  private chainConfig: EvmChainConfig;

  constructor(
    chainConfig: EvmChainConfig,
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`evmImporter:${chainConfig.chainName}`);

    if (!blockchainProviderManager) {
      throw new Error(`Provider manager required for ${chainConfig.chainName} importer`);
    }

    this.providerManager = blockchainProviderManager;

    // Auto-register providers for this chain
    this.providerManager.autoRegisterFromConfig(chainConfig.chainName, options?.preferredProvider);

    this.logger.info(
      `Initialized ${chainConfig.chainName} transaction importer - ProvidersCount: ${this.providerManager.getProviders(chainConfig.chainName).length}`
    );
  }

  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error(`Address required for ${this.chainConfig.chainName} transaction import`));
    }

    const address = params.address;

    this.logger.info(`Starting ${this.chainConfig.chainName} import for ${address.substring(0, 20)}...`);

    const result = await this.fetchAllTransactions(address, params.since);

    return result
      .map((allRawData) => {
        this.logger.info(
          `${this.chainConfig.chainName} import completed - Raw transactions collected: ${allRawData.length}`
        );
        return { rawTransactions: allRawData };
      })
      .mapErr((error) => {
        this.logger.error(`Failed to import transactions for address ${address} - Error: ${error.message}`);
        return error;
      });
  }

  /**
   * Fetch all transaction types (normal, internal, token) for an address in parallel.
   * Only normal transactions are required; internal and token failures are handled gracefully.
   */
  private async fetchAllTransactions(
    address: string,
    since?: number
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    // Fetch all three transaction types in parallel for optimal performance
    const [normalResult, internalResult, tokenResult] = await Promise.all([
      this.fetchNormalTransactions(address, since),
      this.fetchInternalTransactions(address, since),
      this.fetchTokenTransactions(address, since),
    ]);

    // Normal transactions are required
    if (normalResult.isErr()) {
      return normalResult;
    }

    // Combine all successful results
    const allTransactions: RawTransactionWithMetadata[] = [...normalResult.value];

    // Internal transactions are optional
    if (internalResult.isOk()) {
      allTransactions.push(...internalResult.value);
      this.logger.debug(`Fetched ${internalResult.value.length} internal transactions`);
    } else {
      this.logger.debug(
        `No internal transactions available for ${address.substring(0, 20)}...: ${internalResult.error.message}`
      );
    }

    // Token transactions are optional
    if (tokenResult.isOk()) {
      allTransactions.push(...tokenResult.value);
      this.logger.debug(`Fetched ${tokenResult.value.length} token transactions`);
    } else {
      this.logger.debug(
        `No token transactions available for ${address.substring(0, 20)}...: ${tokenResult.error.message}`
      );
    }

    this.logger.debug(
      `Total transactions fetched: ${allTransactions.length} (${normalResult.value.length} normal, ${internalResult.isOk() ? internalResult.value.length : 0} internal, ${tokenResult.isOk() ? tokenResult.value.length : 0} token)`
    );

    return ok(allTransactions);
  }

  /**
   * Fetch normal (external) transactions for an address with provider provenance.
   */
  private async fetchNormalTransactions(
    address: string,
    since?: number
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:normal-txs:${params.type === 'getRawAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getRawAddressTransactions',
    });

    return result.map((response) => {
      const rawTransactions = Array.isArray(response.data) ? response.data : [response.data];

      // Create raw data entries with provider provenance and source address
      return rawTransactions.map((tx: unknown) => ({
        metadata: {
          providerId: response.providerName,
          sourceAddress: address,
          transactionType: 'normal',
        },
        rawData: tx,
      }));
    });
  }

  /**
   * Fetch internal transactions (contract calls) for an address with provider provenance.
   */
  private async fetchInternalTransactions(
    address: string,
    since?: number
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:internal-txs:${params.type === 'getRawAddressInternalTransactions' ? params.address : 'unknown'}:${params.type === 'getRawAddressInternalTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getRawAddressInternalTransactions',
    });

    return result.map((response) => {
      const rawTransactions = Array.isArray(response.data) ? response.data : [response.data];

      // Create raw data entries with provider provenance and source address
      return rawTransactions.map((tx: unknown) => ({
        metadata: {
          providerId: response.providerName,
          sourceAddress: address,
          transactionType: 'internal',
        },
        rawData: tx,
      }));
    });
  }

  /**
   * Fetch token transactions (ERC-20/721/1155) for an address with provider provenance.
   */
  private async fetchTokenTransactions(
    address: string,
    since?: number
  ): Promise<Result<RawTransactionWithMetadata[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:token-txs:${params.type === 'getTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getTokenTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getTokenTransactions',
    });

    return result.map((response) => {
      const rawTokenTransactions = Array.isArray(response.data) ? response.data : [response.data];

      // Create raw data entries with provider provenance and source address
      return rawTokenTransactions.map((tx: unknown) => ({
        metadata: {
          providerId: response.providerName,
          sourceAddress: address,
          transactionType: 'token',
        },
        rawData: tx,
      }));
    });
  }
}
