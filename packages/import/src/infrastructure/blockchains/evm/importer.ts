import type { ExternalTransaction } from '@exitbook/core';
import type { BlockchainImportParams, IImporter, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import type {
  BlockchainProviderManager,
  EvmChainConfig,
  EvmTransaction,
  ProviderError,
  TransactionWithRawData,
} from '@exitbook/providers';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

/**
 * Generic EVM transaction importer that fetches raw transaction data from blockchain APIs.
 * Works with any EVM-compatible chain (Ethereum, Avalanche, Polygon, BSC, etc.).
 *
 * Fetches three types of transactions in parallel:
 * - Normal (external) transactions
 * - Internal transactions (contract calls)
 * - Token transfers (ERC-20/721/1155)
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

    this.providerManager.autoRegisterFromConfig(chainConfig.chainName, options?.preferredProvider);

    this.logger.info(
      `Initialized ${chainConfig.chainName} transaction importer - ProvidersCount: ${this.providerManager.getProviders(chainConfig.chainName).length}`
    );
  }

  async import(params: BlockchainImportParams): Promise<Result<ImportRunResult, Error>> {
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
  ): Promise<Result<ExternalTransaction[], ProviderError>> {
    // Fetch all three transaction types in parallel for optimal performance
    const [normalResult, internalResult, tokenResult] = await Promise.all([
      this.fetchNormalTransactions(address, since),
      this.fetchInternalTransactions(address, since),
      this.fetchTokenTransactions(address, since),
    ]);

    if (normalResult.isErr()) {
      return normalResult;
    }

    if (internalResult.isErr()) {
      return internalResult;
    }

    if (tokenResult.isErr()) {
      return tokenResult;
    }

    // Combine all successful results
    const allTransactions: ExternalTransaction[] = [
      ...normalResult.value,
      ...internalResult.value,
      ...tokenResult.value,
    ];

    this.logger.debug(
      `Total transactions fetched: ${allTransactions.length} (${normalResult.value.length} normal, ${internalResult.value.length} internal, ${tokenResult.value.length} token)`
    );

    return ok(allTransactions);
  }

  /**
   * Fetch normal (external) transactions for an address with provider provenance.
   */
  private async fetchNormalTransactions(
    address: string,
    since?: number
  ): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:normal-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<EvmTransaction>[];
      const providerId = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        providerId,
        externalId: txWithRaw.normalized.id,
        transactionType: 'normal',
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
      }));
    });
  }

  /**
   * Fetch internal transactions (contract calls) for an address with provider provenance.
   */
  private async fetchInternalTransactions(
    address: string,
    since?: number
  ): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:internal-txs:${params.type === 'getAddressInternalTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressInternalTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getAddressInternalTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<EvmTransaction>[];
      const providerId = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        providerId,
        externalId: txWithRaw.normalized.id,
        transactionType: 'internal',
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
      }));
    });
  }

  /**
   * Fetch token transactions (ERC-20/721/1155) for an address with provider provenance.
   */
  private async fetchTokenTransactions(
    address: string,
    since?: number
  ): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:token-txs:${params.type === 'getAddressTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTokenTransactions' ? params.since || 'all' : 'unknown'}`,
      since: since,
      type: 'getAddressTokenTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<EvmTransaction>[];
      const providerId = response.providerName;

      return transactionsWithRaw.map((txWithRaw) => ({
        providerId,
        externalId: txWithRaw.normalized.id,
        transactionType: 'token',
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
      }));
    });
  }
}
