import { createKrakenClient } from '@exitbook/exchanges-providers';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportBatchResult, ImportParams } from '../../../types/importers.js';

/**
 * API-based importer for Kraken exchange.
 * Uses createKrakenClient from @exitbook/exchanges-providers to fetch and validate transaction data.
 * The client handles validation, timestamp extraction, and external ID extraction.
 */
export class KrakenApiImporter implements IImporter {
  private readonly logger: Logger;

  constructor() {
    this.logger = getLogger('krakenApiImporter');
  }

  /**
   * Streaming import - yields batches as they're fetched from Kraken API
   * Memory-bounded processing (O(batch_size) instead of O(total_transactions))
   * Supports mid-import resumption via cursor
   */
  async *importStreaming(params: ImportParams): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
    this.logger.info('Starting Kraken API streaming import');

    if (!params.credentials) {
      yield err(new Error('API credentials are required for Kraken API import'));
      return;
    }

    // Initialize Kraken client with credentials
    const clientResult = createKrakenClient(params.credentials);

    if (clientResult.isErr()) {
      yield err(clientResult.error);
      return;
    }

    const client = clientResult.value;

    // Stream batches from the client
    // The client handles pagination and yields batches with cursor updates
    if (!client.fetchTransactionDataStreaming) {
      yield err(new Error('Kraken client does not support streaming (this should not happen)'));
      return;
    }

    const iterator = client.fetchTransactionDataStreaming({
      cursor: params.cursor,
    });

    for await (const batchResult of iterator) {
      if (batchResult.isErr()) {
        yield err(batchResult.error);
        return;
      }

      const batch = batchResult.value;

      // Map FetchBatchResult to ImportBatchResult
      yield ok({
        rawTransactions: batch.transactions,
        operationType: batch.operationType,
        cursor: batch.cursor,
        isComplete: batch.isComplete,
      });

      // Log progress
      this.logger.info(
        `Kraken batch: ${batch.transactions.length} transactions, total: ${batch.cursor.totalFetched}, complete: ${batch.isComplete}`
      );
    }

    this.logger.info('Kraken API streaming import completed');
  }
}
