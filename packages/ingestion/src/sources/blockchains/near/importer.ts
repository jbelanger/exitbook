import type {
  BlockchainProviderManager,
  NearStreamEvent,
  NearStreamType,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import { NearStreamTypeSchema } from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportBatchResult } from '../../../shared/types/importers.js';

/**
 * NEAR transaction importer - streams raw unenriched data from 4 discrete endpoints
 *
 * This importer fetches raw data from NearBlocks API in 4 sequential phases:
 * 1. transactions - Base transaction metadata
 * 2. receipts - Receipt execution records
 * 3. balance-changes - Balance changes
 * 4. token-transfers - Token transfers
 *
 * Key characteristics:
 * - Raw data is stored WITHOUT correlation (deferred to processor)
 * - Each phase is independently resumable using transaction type cursors
 * - All 4 phases must complete before processing can begin
 * - Each raw record is saved with a transaction_type_hint for later correlation
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
   * Streaming import implementation - sequential phase execution
   *
   * Streams all 4 stream types sequentially:
   * 1. transactions - Base transaction metadata
   * 2. receipts - Receipt execution records
   * 3. balance-changes - Balance changes
   * 4. token-transfers - Token transfers
   *
   * Each phase must complete before the next begins. Each phase is independently
   * resumable using its stream type cursor.
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for NEAR transaction import'));
      return;
    }

    this.logger.info(`Starting NEAR streaming import for account: ${params.address.substring(0, 20)}...`);

    // Define the 4 transaction types to stream in order
    // Derived from NearStreamTypeSchema - single source of truth
    const transactionTypes = NearStreamTypeSchema.options;

    // Stream each transaction type sequentially
    for (let i = 0; i < transactionTypes.length; i++) {
      const transactionType = transactionTypes[i]!;
      this.logger.info(`Streaming ${transactionType} (${i + 1}/4)`);

      const cursor = params.cursor?.[transactionType];
      for await (const batchResult of this.streamTransactionType(params.address, transactionType, cursor)) {
        yield batchResult;
      }

      this.logger.debug(`Completed ${transactionType} (${i + 1}/4)`);
    }

    this.logger.info(`NEAR streaming import completed - all 4 stream types finished`);
  }

  /**
   * Stream a single transaction type with resume support
   *
   * Uses provider manager's streaming failover to handle pagination and provider switching.
   * Each stream type is streamed independently from its corresponding API endpoint.
   *
   * @param address - NEAR account ID
   * @param transactionType - Stream type from NearStreamTypeSchema
   * @param resumeCursor - Optional cursor to resume from a previous interrupted stream
   */
  private async *streamTransactionType(
    address: string,
    transactionType: NearStreamType,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    const iterator = this.providerManager.executeWithFailover<TransactionWithRawData<NearStreamEvent>>(
      'near',
      {
        type: 'getAddressTransactions',
        address,
        transactionType,
        getCacheKey: (params) => {
          if (params.type !== 'getAddressTransactions') return 'unknown';
          const txType = params.transactionType || 'default';
          return `near:${txType}:${params.address}:all`;
        },
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
      // Each event has deterministic eventId (hash-based for activities/ft-transfers)
      const rawTransactions = transactionsWithRaw.map((txWithRaw) => ({
        providerName: providerBatch.providerName,
        eventId: txWithRaw.normalized.eventId, // Deterministic event ID
        blockchainTransactionHash: txWithRaw.normalized.transactionHash ?? undefined, // Transaction hash from normalized data
        timestamp: txWithRaw.normalized.timestamp,
        transactionTypeHint: transactionType, // Stream type for processor correlation
        sourceAddress: address,
        normalizedData: txWithRaw.normalized,
        providerData: txWithRaw.raw,
      }));

      yield ok({
        rawTransactions: rawTransactions,
        transactionType,
        cursor: providerBatch.cursor,
        isComplete: providerBatch.isComplete,
      });
    }
  }
}
