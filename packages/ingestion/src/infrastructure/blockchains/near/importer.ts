import type {
  BlockchainProviderManager,
  NearTransaction,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportBatchResult } from '../../../types/importers.js';

/**
 * NEAR transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports NEAR account IDs using multiple providers (NearBlocks).
 * Uses provider manager for failover between multiple blockchain API providers.
 *
 * The provider layer handles all enrichment internally:
 * - Account changes (native NEAR balance deltas) are populated in getAddressTransactions
 * - Token transfers (NEP-141) are fetched via getAddressTokenTransactions
 */
export class NearTransactionImporter implements IImporter {
  private readonly logger: Logger;
  private providerManager: BlockchainProviderManager;

  constructor(
    blockchainProviderManager: BlockchainProviderManager,
    options?: { preferredProvider?: string | undefined }
  ) {
    this.logger = getLogger('nearImporter');

    this.providerManager = blockchainProviderManager;

    if (!this.providerManager) {
      throw new Error('Provider manager required for NEAR importer');
    }

    this.providerManager.autoRegisterFromConfig('near', options?.preferredProvider);

    this.logger.info(
      `Initialized NEAR transaction importer - ProvidersCount: ${this.providerManager.getProviders('near').length}`
    );
  }

  /**
   * Streaming import implementation
   * Streams NORMAL + TOKEN batches without accumulating everything in memory
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for NEAR transaction import'));
      return;
    }

    this.logger.info(`Starting NEAR streaming import for account: ${params.address.substring(0, 20)}...`);

    // Stream normal transactions (with resume support)
    const normalCursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionType(
      params.address,
      'normal',
      'getAddressTransactions',
      normalCursor
    )) {
      yield batchResult;
    }

    // Stream token transactions (with resume support)
    const tokenCursor = params.cursor?.['token'];
    for await (const batchResult of this.streamTransactionType(
      params.address,
      'token',
      'getAddressTokenTransactions',
      tokenCursor
    )) {
      yield batchResult;
    }

    this.logger.info(`NEAR streaming import completed`);
  }

  /**
   * Stream a specific transaction type with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionType(
    address: string,
    operationType: 'normal' | 'token',
    providerOperationType: 'getAddressTransactions' | 'getAddressTokenTransactions',
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const cacheKeyPrefix = operationType === 'normal' ? 'normal-txs' : 'token-txs';

    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<NearTransaction>>(
      'near',
      {
        type: providerOperationType,
        address,
        getCacheKey: (params) =>
          `near:${cacheKeyPrefix}:${params.type === providerOperationType ? params.address : 'unknown'}:all`,
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
        providerName: providerBatch.providerName,
        externalId: generateUniqueTransactionId(txWithRaw.normalized),
        blockchainTransactionHash: txWithRaw.normalized.id,
        transactionTypeHint: operationType,
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        rawData: txWithRaw.raw,
      }));

      yield ok({
        rawTransactions: rawTransactions,
        operationType,
        cursor: providerBatch.cursor,
        isComplete: providerBatch.cursor.metadata?.isComplete ?? false,
      });
    }
  }
}
