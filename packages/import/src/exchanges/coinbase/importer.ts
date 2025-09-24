import type { UniversalTransaction } from '@crypto/core';

import { BaseImporter } from '../../shared/importers/base-importer.js';
import type { ImportParams, ImportRunResult } from '../../shared/importers/interfaces.js';

/**
 * Importer for Coinbase transactions using CCXT adapter.
 * Fetches transactions directly from Coinbase's API using the specialized ledger adapter.
 */
export class CoinbaseImporter extends BaseImporter<UniversalTransaction> {
  constructor() {
    super('coinbase');
  }

  import(_params: ImportParams): Promise<ImportRunResult<UniversalTransaction>> {
    this.logger.info('Starting Coinbase transaction import using CCXT adapter');

    throw new Error('CoinbaseImporter.import not yet implemented');
  }

  protected canImportSpecific(_params: ImportParams): Promise<boolean> {
    throw new Error('CoinbaseImporter.canImportSpecific not yet implemented');
  }
}
