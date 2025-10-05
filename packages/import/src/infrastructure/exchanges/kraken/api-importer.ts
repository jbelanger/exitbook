import type { RawTransactionWithMetadata } from '@exitbook/data';
import { KrakenClient } from '@exitbook/exchanges';
import type { IImporter, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

/**
 * API-based importer for Kraken exchange.
 * Uses KrakenClient from @exitbook/exchanges to fetch transaction data via ccxt.
 */
export class KrakenApiImporter implements IImporter {
  private readonly logger: Logger;
  private readonly sourceId = 'kraken';

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

      // Fetch transaction data
      const fetchResult = await client.fetchTransactionData({
        since: params.since,
        until: params.until,
      });

      if (fetchResult.isErr()) {
        this.logger.error(`Failed to fetch Kraken data: ${fetchResult.error.message}`);
        return err(fetchResult.error);
      }

      const rawData = fetchResult.value;

      // Transform to RawTransactionWithMetadata
      const transactions: RawTransactionWithMetadata[] = rawData.map((item) => ({
        metadata: {
          providerId: this.sourceId,
          source: 'api',
        },
        rawData: item.data,
      }));

      this.logger.info(`Completed Kraken API import: ${transactions.length} transactions fetched`);

      return ok({
        rawTransactions: transactions,
        metadata: {
          importMethod: 'api',
          recordCount: transactions.length,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Kraken API import failed: ${errorMessage}`);
      return err(new Error(`${this.sourceId} API import failed: ${errorMessage}`));
    }
  }
}
