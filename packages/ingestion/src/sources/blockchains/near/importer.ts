import type {
  BlockchainProviderManager,
  NearReceiptEvent,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportBatchResult } from '../../../shared/types/importers.js';

/**
 * NEAR transaction importer that fetches raw transaction data from blockchain APIs.
 * Supports NEAR account IDs using multiple providers (NearBlocks).
 * Uses provider manager for failover between multiple blockchain API providers.
 *
 * The provider layer handles all enrichment internally:
 * - Account changes (native NEAR balance deltas) are populated in getAddressTransactions
 * - Token transfers (NEP-141) are enriched into receipt events via batch correlation
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
   * Streams receipt events (includes both native and token transfers)
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for NEAR transaction import'));
      return;
    }

    this.logger.info(`Starting NEAR streaming import for account: ${params.address.substring(0, 20)}...`);

    // Stream all receipt events (includes native balance changes and token transfers)
    const cursor = params.cursor?.['normal'];
    for await (const batchResult of this.streamTransactionType(
      params.address,
      'normal',
      'getAddressTransactions',
      cursor
    )) {
      yield batchResult;
    }

    this.logger.info(`NEAR streaming import completed`);
  }

  /**
   * Stream receipt events with resume support
   * Uses provider manager's streaming failover to handle pagination and provider switching
   */
  private async *streamTransactionType(
    address: string,
    operationType: 'normal',
    providerOperationType: 'getAddressTransactions',
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const cacheKeyPrefix = 'receipt-events';

    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<NearReceiptEvent>>(
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

      // Log batch stats including in-memory deduplication
      if (providerBatch.stats.deduplicated > 0) {
        this.logger.info(
          `Provider batch stats: ${providerBatch.stats.fetched} fetched, ${providerBatch.stats.deduplicated} deduplicated by provider, ${providerBatch.stats.yielded} yielded`
        );
      }

      // Map to raw transactions
      // V2 Note: NearReceiptEvent always has eventId (receiptId), no fallback needed
      const rawTransactions = transactionsWithRaw.map((txWithRaw) => ({
        providerName: providerBatch.providerName,
        eventId: txWithRaw.normalized.eventId, // Receipt ID (always present in V2)
        blockchainTransactionHash: txWithRaw.normalized.id, // Parent transaction hash
        transactionTypeHint: operationType,
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        providerData: txWithRaw.raw,
      }));

      yield ok({
        rawTransactions: rawTransactions,
        operationType,
        cursor: providerBatch.cursor,
        isComplete: providerBatch.isComplete,
      });
    }
  }
}
