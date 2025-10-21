import { createKrakenClient } from '@exitbook/exchanges';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { IImporter, ImportParams, ImportRunResult } from '../../../types/importers.ts';

/**
 * API-based importer for Kraken exchange.
 * Uses createKrakenClient from @exitbook/exchanges to fetch and validate transaction data.
 * The client handles validation, timestamp extraction, and external ID extraction.
 */
export class KrakenApiImporter implements IImporter {
  private readonly logger: Logger;

  constructor() {
    this.logger = getLogger('krakenApiImporter');
  }

  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    this.logger.info('Starting Kraken API import');

    if (!params.credentials) {
      return err(new Error('API credentials are required for Kraken API import'));
    }

    // Initialize Kraken client with credentials
    const clientResult = createKrakenClient(params.credentials);

    if (clientResult.isErr()) {
      return err(clientResult.error);
    }

    const client = clientResult.value;

    // Client returns RawTransactionWithMetadata[] with all fields populated
    // The client handles translating cursor to API-specific parameters (since/until/limit)
    const fetchResult = await client.fetchTransactionData({
      cursor: params.cursor,
    });

    if (fetchResult.isErr()) {
      // Pass through the error (including PartialImportError with successful items)
      // The ingestion service will handle saving successful items and recording errors
      return err(fetchResult.error);
    }

    const exchangeData = fetchResult.value;

    this.logger.info(`Completed Kraken API import: ${exchangeData.length} transactions validated`);

    return ok({
      rawTransactions: fetchResult.value,
    });
  }
}
