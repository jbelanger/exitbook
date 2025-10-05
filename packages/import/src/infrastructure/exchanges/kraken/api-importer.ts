import { KrakenClient } from '@exitbook/exchanges';
import type { IImporter, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

/**
 * API-based importer for Kraken exchange.
 * Uses KrakenClient from @exitbook/exchanges to fetch and validate transaction data.
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

    try {
      // Initialize Kraken client with credentials
      const client = new KrakenClient(params.credentials);

      // Fetch and validate transaction data
      // Client returns RawTransactionWithMetadata[] with all fields populated
      const fetchResult = await client.fetchTransactionData({
        since: params.since,
        until: params.until,
      });

      if (fetchResult.isErr()) {
        // Pass through the error (including PartialImportError with successful items)
        // The ingestion service will handle saving successful items and recording errors
        return err(fetchResult.error);
      }

      const transactions = fetchResult.value;

      this.logger.info(`Completed Kraken API import: ${transactions.length} transactions validated`);

      return ok({
        metadata: {
          importMethod: 'api',
          recordCount: transactions.length,
        },
        rawTransactions: transactions,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Kraken API import failed: ${errorMessage}`);
      return err(new Error(`Kraken API import failed: ${errorMessage}`));
    }
  }
}
