import type {
  BlockchainProviderManager,
  EvmChainConfig,
  EvmTransaction,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportBatchResult, ImportParams } from '../../../core/types/importers.ts';

import { mapToRawTransactions } from './evm-importer-utils.js';

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

    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<EvmTransaction>>(
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
      // Provider batch data is TransactionWithRawData[] from executeWithFailover
      const transactionsWithRaw = providerBatch.data;

      // Use pure function for mapping
      const rawTransactions = mapToRawTransactions(
        transactionsWithRaw,
        providerBatch.providerName,
        address,
        operationType
      );

      yield ok({
        rawTransactions: rawTransactions,
        operationType,
        cursor: providerBatch.cursor,
        isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
      });
    }
  }
}
