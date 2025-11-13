import { createCoinbaseClient } from '@exitbook/exchanges-providers';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportRunResult } from '../../../types/importers.js';

/**
 * API-based importer for Coinbase exchange.
 * Uses createCoinbaseClient from @exitbook/exchanges-providers to fetch and validate transaction data.
 * The client handles validation, timestamp extraction, and external ID extraction.
 */
export class CoinbaseApiImporter implements IImporter {
  private readonly logger: Logger;

  constructor() {
    this.logger = getLogger('CoinbaseApiImporter');
  }

  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    this.logger.info('Starting Coinbase API import');

    if (!params.credentials) {
      return err(new Error('API credentials are required for Coinbase API import'));
    }

    // Initialize Coinbase client with credentials
    const clientResult = createCoinbaseClient(params.credentials);

    if (clientResult.isErr()) {
      return err(clientResult.error);
    }

    const client = clientResult.value;

    // Client returns transactions and cursor updates
    // The client handles translating cursor to API-specific parameters (since/until/limit)
    const fetchResult = await client.fetchTransactionData({
      cursor: params.cursor,
    });

    if (fetchResult.isErr()) {
      // Pass through the error (including PartialImportError with successful items)
      // The ingestion service will handle saving successful items and recording errors
      return err(fetchResult.error);
    }

    const { transactions, cursorUpdates } = fetchResult.value;

    this.logger.info(`Completed Coinbase API import: ${transactions.length} transactions validated`);
    this.logger.info(`Cursor updates for ${Object.keys(cursorUpdates).length} accounts`);

    return ok({
      rawTransactions: transactions,
      cursorUpdates, // Return ALL account cursors, not just the first one
    });
  }
}
