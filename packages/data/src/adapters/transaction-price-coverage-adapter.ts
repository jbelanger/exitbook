import type { IPriceCoverageData } from '@exitbook/accounting/ports';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext to accounting's IPriceCoverageData port.
 *
 * Only supplies transaction data — coverage decision logic
 * lives in accounting (checkTransactionPriceCoverage).
 */
export function buildPriceCoverageDataPorts(db: DataContext): IPriceCoverageData {
  return {
    loadTransactions() {
      return db.transactions.findAll();
    },
  };
}
