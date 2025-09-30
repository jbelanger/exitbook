import type { IImporter, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, type Result } from 'neverthrow';

/**
 * Importer for Coinbase transactions using CCXT adapter.
 * Fetches transactions directly from Coinbase's API using the specialized ledger adapter.
 */
export class CoinbaseImporter implements IImporter {
  private readonly logger: Logger;

  constructor() {
    this.logger = getLogger('coinbaseImporter');
  }

  import(_params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    this.logger.info('Starting Coinbase transaction import using CCXT adapter');

    return Promise.resolve(err(new Error('CoinbaseImporter.import not yet implemented')));
  }
}
