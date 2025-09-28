import type { UniversalTransaction } from '@crypto/core';

import type { ImportParams, ImportRunResult } from '../../../app/ports/importers.ts';
import { BaseImporter } from '../../shared/importers/base-importer.js';

/**
 * Importer for Coinbase transactions using CCXT adapter.
 * Fetches transactions directly from Coinbase's API using the specialized ledger adapter.
 */
export class CoinbaseImporter extends BaseImporter {
  constructor() {
    super('coinbase');
  }

  import(_params: ImportParams): Promise<ImportRunResult> {
    this.logger.info('Starting Coinbase transaction import using CCXT adapter');

    throw new Error('CoinbaseImporter.import not yet implemented');
  }

  protected canImportSpecific(_params: ImportParams): Promise<boolean> {
    throw new Error('CoinbaseImporter.canImportSpecific not yet implemented');
  }
}
