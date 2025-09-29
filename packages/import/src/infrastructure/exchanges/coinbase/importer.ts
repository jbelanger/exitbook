import type { ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import { err, type Result } from 'neverthrow';

import { BaseImporter } from '../../shared/importers/base-importer.js';

/**
 * Importer for Coinbase transactions using CCXT adapter.
 * Fetches transactions directly from Coinbase's API using the specialized ledger adapter.
 */
export class CoinbaseImporter extends BaseImporter {
  constructor() {
    super('coinbase');
  }

  import(_params: ImportParams): Promise<Result<ImportRunResult, Error>> {
    this.logger.info('Starting Coinbase transaction import using CCXT adapter');

    return Promise.resolve(err(new Error('CoinbaseImporter.import not yet implemented')));
  }
}
