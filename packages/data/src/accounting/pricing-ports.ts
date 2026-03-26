import type { IPricingPersistence } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

/**
 * Bridges DataSession repositories to accounting's IPricingPersistence port.
 * Mirrors the pattern established by buildLinkingPorts.
 */
export function buildPricingPorts(db: DataSession, profileId: number): IPricingPersistence {
  return {
    loadPricingContext: () =>
      resultDoAsync(async function* () {
        const transactions = yield* await db.transactions.findAll({ profileId });
        const confirmedLinks = yield* await db.transactionLinks.findAll({ profileId, status: 'confirmed' });

        return {
          transactions,
          confirmedLinks,
        };
      }),

    loadTransactionsNeedingPrices: (assetFilter) => db.transactions.findNeedingPrices(assetFilter, profileId),

    saveTransactionPrices: (tx) =>
      db.executeInTransaction((txCtx) =>
        resultDoAsync(async function* () {
          yield* await txCtx.transactions.updateMovementsWithPrices(tx);
          return undefined;
        })
      ),
  };
}
