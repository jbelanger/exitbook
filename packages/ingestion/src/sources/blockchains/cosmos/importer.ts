import type {
  BlockchainProviderManager,
  CosmosChainConfig,
  CosmosTransaction,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportBatchResult } from '../../../shared/types/importers.js';

/**
 * Generic Cosmos SDK transaction importer that fetches raw transaction data from blockchain APIs.
 * Works with any Cosmos SDK-based chain (Injective, Osmosis, Cosmos Hub, Terra, etc.)
 * Uses provider manager for failover between multiple API providers per chain.
 */
export class CosmosImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;
  private chainConfig: CosmosChainConfig;

  constructor(
    chainConfig: CosmosChainConfig,
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.chainConfig = chainConfig;
    this.logger = getLogger(`cosmosImporter:${chainConfig.chainName}`);

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error(`Provider manager required for ${chainConfig.displayName} importer`);
    }

    this.providerManager.autoRegisterFromConfig(chainConfig.chainName, options?.preferredProvider);

    this.logger.info(
      `Initialized ${chainConfig.displayName} transaction importer - ProvidersCount: ${this.providerManager.getProviders(chainConfig.chainName).length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams transaction batches without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address?.length) {
      yield err(new Error(`Address required for ${this.chainConfig.displayName} transaction import`));
      return;
    }

    // Normalize Cosmos address to lowercase (Cosmos addresses are case-insensitive)
    // This ensures consistency with CosmosAddressSchema normalization and processor expectations
    params.address = params.address.toLowerCase();

    this.logger.info(
      `Starting ${this.chainConfig.displayName} streaming import for address: ${params.address.substring(0, 20)}...`
    );

    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionsForAddress(params.address, normalCursor)) {
      yield batchResult;
    }

    this.logger.info(`${this.chainConfig.displayName} streaming import completed`);
  }

  /**
   * Stream transactions for a single address with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionsForAddress(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<CosmosTransaction>>(
      this.chainConfig.chainName,
      {
        type: 'getAddressTransactions',
        address,
        getCacheKey: (params) =>
          `${this.chainConfig.chainName}:raw-txs:${params.type === 'getAddressTransactions' ? params.address : 'unknown'}:all`,
      },
      resumeCursor
    );

    for await (const providerBatchResult of iterator) {
      if (providerBatchResult.isErr()) {
        yield err(providerBatchResult.error);
        return;
      }

      const providerBatch = providerBatchResult.value;
      const transactionsWithRaw = providerBatch.data;

      // Map to raw transactions
      const rawTransactions = transactionsWithRaw.map((txWithRaw) => ({
        externalId: generateUniqueTransactionId({
          amount: txWithRaw.normalized.amount,
          currency: txWithRaw.normalized.currency,
          from: txWithRaw.normalized.from,
          id: txWithRaw.normalized.id,
          timestamp: txWithRaw.normalized.timestamp,
          to: txWithRaw.normalized.to,
          tokenAddress: txWithRaw.normalized.tokenAddress,
          type: txWithRaw.normalized.messageType || 'transfer',
        }),
        blockchainTransactionHash: txWithRaw.normalized.id,
        normalizedData: txWithRaw.normalized,
        providerName: providerBatch.providerName,
        providerData: txWithRaw.raw,
        sourceAddress: address,
      }));

      yield ok({
        rawTransactions: rawTransactions,
        operationType: 'normal',
        cursor: providerBatch.cursor,
        isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
      });
    }
  }
}
