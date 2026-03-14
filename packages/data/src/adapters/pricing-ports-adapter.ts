import type { IPricingPersistence } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's IPricingPersistence port.
 * Mirrors the pattern established by buildLinkingPorts.
 */
export function buildPricingPorts(db: DataContext): IPricingPersistence {
  return {
    loadPricingContext: () =>
      resultDoAsync(async function* () {
        const transactions = yield* await db.transactions.findAll();
        const confirmedLinks = yield* await db.transactionLinks.findAll('confirmed');

        return {
          transactions,
          confirmedLinks,
        };
      }),

    loadTransactionsNeedingPrices: (assetFilter) => db.transactions.findNeedingPrices(assetFilter),

    saveTransactionPrices: (tx) =>
      db.executeInTransaction((txCtx) =>
        resultDoAsync(async function* () {
          yield* await txCtx.transactions.updateMovementsWithPrices(tx);
          return undefined;
        })
      ),
  };
}
