import { createKuCoinClient } from '@exitbook/exchanges';
import type { IImporter, ImportParams, ImportRunResult } from '@exitbook/ingestion/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

/**
 * API-based importer for KuCoin exchange.
 * Uses createKuCoinClient from @exitbook/exchanges to fetch and validate transaction data.
 * The client handles validation, timestamp extraction, and external ID extraction.
 */
export class KuCoinApiImporter implements IImporter {
  private readonly logger: Logger;

  constructor() {
    this.logger = getLogger('KuCoinApiImporter');
  }

  async import(params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    this.logger.info('Starting KuCoin API import');

    if (!params.credentials) {
      return err(new Error('API credentials are required for KuCoin API import'));
    }

    // Initialize KuCoin client with credentials
    const clientResult = createKuCoinClient(params.credentials);

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

    this.logger.info(`Completed KuCoin API import: ${exchangeData.length} transactions validated`);

    return ok({
      rawTransactions: fetchResult.value,
    });
  }
}
