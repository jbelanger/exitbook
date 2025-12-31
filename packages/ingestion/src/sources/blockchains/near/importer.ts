import type {
  BlockchainProviderManager,
  NearStreamEvent,
  TransactionWithRawData,
} from '@exitbook/blockchain-providers';
import type { CursorState } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportBatchResult } from '../../../shared/types/importers.js';

/**
 * NEAR transaction importer V3 - streams raw unenriched data from 4 discrete endpoints
 *
 * This importer fetches raw data from NearBlocks API in 4 sequential phases:
 * 1. transactions - Base transaction metadata from /txns-only
 * 2. receipts - Receipt execution records from /receipts
 * 3. activities - Balance changes from /activities
 * 4. ft-transfers - Token transfers from /ft-txns
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
   * Streaming import implementation - V3 sequential phase execution
   *
   * Streams all 4 transaction types sequentially:
   * 1. transactions - Base transaction metadata
   * 2. receipts - Receipt execution records
   * 3. activities - Balance changes
   * 4. ft-transfers - Token transfers
   *
   * Each phase must complete before the next begins. Each phase is independently
   * resumable using its transaction type cursor.
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    if (!params.address) {
      yield err(new Error('Address required for NEAR transaction import'));
      return;
    }

    this.logger.info(`Starting NEAR V3 streaming import for account: ${params.address.substring(0, 20)}...`);

    // Define the 4 transaction types to stream in order
    // Must match provider's supportedTransactionTypes for provider selection to work
    const transactionTypes: string[] = ['transactions', 'receipts', 'balance-changes', 'token-transfers'];

    // Stream each transaction type sequentially
    for (let i = 0; i < transactionTypes.length; i++) {
      const transactionType = transactionTypes[i]!;
      this.logger.info(`Phase ${i + 1}/4: Streaming ${transactionType}`);

      const cursor = params.cursor?.[transactionType];
      for await (const batchResult of this.streamTransactionType(params.address, transactionType, cursor)) {
        yield batchResult;
      }

      this.logger.info(`Phase ${i + 1}/4: Completed ${transactionType}`);
    }

    this.logger.info(`NEAR V3 streaming import completed - all 4 phases finished`);
  }

  /**
   * Stream a single transaction type with resume support
   *
   * Uses provider manager's streaming failover to handle pagination and provider switching.
   * Each transaction type (transactions, receipts, activities, ft-transfers) is streamed
   * independently from its corresponding API endpoint.
   *
   * @param address - NEAR account ID
   * @param transactionType - One of: 'transactions', 'receipts', 'activities', 'ft-transfers'
   * @param resumeCursor - Optional cursor to resume from a previous interrupted stream
   */
  private async *streamTransactionType(
    address: string,
    transactionType: string,
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
      // V3: Each event has deterministic eventId (hash-based for activities/ft-transfers)
      const rawTransactions = transactionsWithRaw.map((txWithRaw) => ({
        providerName: providerBatch.providerName,
        eventId: txWithRaw.normalized.eventId, // Deterministic event ID
        blockchainTransactionHash: txWithRaw.normalized.id, // Parent transaction hash
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
