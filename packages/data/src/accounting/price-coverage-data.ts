import type { IPriceCoverageData } from '@exitbook/accounting/ports';

import type { DataSession } from '../data-session.js';

/**
 * Bridges DataSession to accounting's IPriceCoverageData port.
 *
 * Only supplies transaction data — coverage decision logic
 * lives in accounting (checkTransactionPriceCoverage).
 */
export function buildPriceCoverageDataPorts(db: DataSession, profileId: number): IPriceCoverageData {
  return {
    loadTransactions() {
      return db.transactions.findAll({ profileId });
    },
  };
}
