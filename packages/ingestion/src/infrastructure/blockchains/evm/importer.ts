import type {
  BlockchainProviderManager,
  EvmChainConfig,
  EvmTransaction,
  ProviderError,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import type { CursorState, ExternalTransaction } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportBatchResult, ImportParams, ImportRunResult } from '../../../types/importers.js';

import { mapToExternalTransactions } from './evm-importer-utils.js';

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

  /**
   * Streaming import implementation
   * Streams NORMAL + INTERNAL + TOKEN batches without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error(`Address required for ${this.chainConfig.chainName} transaction import`));
      return;
    }

    const address = params.address;

    if (params.cursor) {
      this.logger.info(
        `Starting ${this.chainConfig.chainName} streaming import for ${address.substring(0, 20)}... (resuming from cursor)`
      );
    } else {
      this.logger.info(`Starting ${this.chainConfig.chainName} streaming import for ${address.substring(0, 20)}...`);
    }

    try {
      // Stream normal transactions (with resume support)
      const normalCursor = params.cursor?.['normal'];
      for await (const batchResult of this.streamTransactionType(
        address,
        'normal',
        'getAddressTransactions',
        normalCursor
      )) {
        yield batchResult;
      }

      // Stream internal transactions (with resume support)
      const internalCursor = params.cursor?.['internal'];
      for await (const batchResult of this.streamTransactionType(
        address,
        'internal',
        'getAddressInternalTransactions',
        internalCursor
      )) {
        yield batchResult;
      }

      // Stream token transactions (with resume support)
      const tokenCursor = params.cursor?.['token'];
      for await (const batchResult of this.streamTransactionType(
        address,
        'token',
        'getAddressTokenTransactions',
        tokenCursor
      )) {
        yield batchResult;
      }

      this.logger.info(`${this.chainConfig.chainName} streaming import completed`);
    } catch (error) {
      this.logger.error(`Failed to stream transactions for address ${address}: ${getErrorMessage(error)}`);
      yield err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Legacy batch import (deprecated)
   * Accumulates all batches from streaming implementation
   * @deprecated Use importStreaming instead
   */
  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    if (!params.address) {
      return err(new Error(`Address required for ${this.chainConfig.chainName} transaction import`));
    }

    const address = params.address;

    this.logger.info(`Starting ${this.chainConfig.chainName} import for ${address.substring(0, 20)}...`);

    const allTransactions: ExternalTransaction[] = [];
    const cursorUpdates: Record<string, CursorState> = {};

    // Consume streaming iterator
    for await (const batchResult of this.importStreaming(params)) {
      if (batchResult.isErr()) {
        return err(batchResult.error);
      }

      const batch = batchResult.value;
      allTransactions.push(...batch.rawTransactions);
      cursorUpdates[batch.operationType] = batch.cursor;
    }

    this.logger.info(
      `${this.chainConfig.chainName} import completed - Raw transactions collected: ${allTransactions.length}`
    );

    return ok({
      rawTransactions: allTransactions,
      cursorUpdates,
    });
  }

  /**
   * Stream a specific transaction type with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionType(
    address: string,
    operationType: 'normal' | 'internal' | 'token',
    providerOperationType: 'getAddressTransactions' | 'getAddressInternalTransactions' | 'getAddressTokenTransactions',
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const cacheKeyPrefix =
      operationType === 'normal' ? 'normal-txs' : operationType === 'internal' ? 'internal-txs' : 'token-txs';

    const iterator = this.providerManager.executeWithFailoverStreaming<TransactionWithRawData<EvmTransaction>>(
      this.chainConfig.chainName,
      {
        type: providerOperationType,
        address,
        getCacheKey: (params) =>
          `${this.chainConfig.chainName}:${cacheKeyPrefix}:${params.type === providerOperationType ? params.address : 'unknown'}:all`,
      },
      resumeCursor
    );

    for await (const providerBatchResult of iterator) {
      if (providerBatchResult.isErr()) {
        yield err(providerBatchResult.error);
        return;
      }

      const providerBatch = providerBatchResult.value;
      // Provider batch data is TransactionWithRawData[] from executeWithFailoverStreaming
      const transactionsWithRaw = providerBatch.data;

      // Use pure function for mapping
      const externalTransactions = mapToExternalTransactions(
        transactionsWithRaw,
        providerBatch.providerName,
        address,
        operationType
      );

      yield ok({
        rawTransactions: externalTransactions,
        operationType,
        cursor: providerBatch.cursor,
        isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
      });
    }
  }

  /**
   * Fetch all transaction types (normal, internal, token) for an address in parallel.
   * Only normal transactions are required; internal and token failures are handled gracefully.
   * @deprecated Use streamTransactionType instead
   */
  private async fetchAllTransactions(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    // Fetch all three transaction types in parallel for optimal performance
    const [normalResult, internalResult, tokenResult] = await Promise.all([
      this.fetchNormalTransactions(address),
      this.fetchInternalTransactions(address),
      this.fetchTokenTransactions(address),
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
   * @deprecated Legacy method - use streamTransactionType instead
   */
  private async fetchNormalTransactions(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:normal-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<EvmTransaction>[];
      return mapToExternalTransactions(transactionsWithRaw, response.providerName, address, 'normal');
    });
  }

  /**
   * Fetch internal transactions (contract calls) for an address with provider provenance.
   * @deprecated Legacy method - use streamTransactionType instead
   */
  private async fetchInternalTransactions(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:internal-txs:${params.type === 'getAddressInternalTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressInternalTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressInternalTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<EvmTransaction>[];
      return mapToExternalTransactions(transactionsWithRaw, response.providerName, address, 'internal');
    });
  }

  /**
   * Fetch token transactions (ERC-20/721/1155) for an address with provider provenance.
   * @deprecated Legacy method - use streamTransactionType instead
   */
  private async fetchTokenTransactions(address: string): Promise<Result<ExternalTransaction[], ProviderError>> {
    const result = await this.providerManager.executeWithFailover(this.chainConfig.chainName, {
      address: address,
      getCacheKey: (params) =>
        `${this.chainConfig.chainName}:token-txs:${params.type === 'getAddressTokenTransactions' ? params.address : 'unknown'}:${params.type === 'getAddressTokenTransactions' ? 'all' : 'unknown'}`,
      type: 'getAddressTokenTransactions',
    });

    return result.map((response) => {
      const transactionsWithRaw = response.data as TransactionWithRawData<EvmTransaction>[];
      return mapToExternalTransactions(transactionsWithRaw, response.providerName, address, 'token');
    });
  }
}
