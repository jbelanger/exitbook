import type { IPricingPersistence } from '@exitbook/accounting/ports';
import { err, ok } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's IPricingPersistence port.
 * Mirrors the pattern established by buildLinkingPorts.
 */
export function buildPricingPorts(db: DataContext): IPricingPersistence {
  return {
    loadPricingContext: async () => {
      const transactionsResult = await db.transactions.findAll();
      if (transactionsResult.isErr()) return err(transactionsResult.error);

      const linksResult = await db.transactionLinks.findAll('confirmed');
      if (linksResult.isErr()) return err(linksResult.error);

      return ok({
        transactions: transactionsResult.value,
        confirmedLinks: linksResult.value,
      });
    },

    loadTransactionsNeedingPrices: (assetFilter) => db.transactions.findNeedingPrices(assetFilter),

    saveTransactionPrices: (tx) => db.executeInTransaction((txCtx) => txCtx.transactions.updateMovementsWithPrices(tx)),
  };
}
