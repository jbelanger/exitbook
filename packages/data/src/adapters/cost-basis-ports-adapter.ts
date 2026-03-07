import type { ICostBasisPersistence } from '@exitbook/accounting/ports';
import { err, ok } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's ICostBasisPersistence port.
 * Mirrors the pattern established by buildLinkingPorts and buildPricingPorts.
 */
export function buildCostBasisPorts(db: DataContext): ICostBasisPersistence {
  return {
    loadCostBasisContext: async () => {
      const transactionsResult = await db.transactions.findAll();
      if (transactionsResult.isErr()) return err(transactionsResult.error);

      const linksResult = await db.transactionLinks.findAll('confirmed');
      if (linksResult.isErr()) return err(linksResult.error);

      return ok({
        transactions: transactionsResult.value,
        confirmedLinks: linksResult.value,
      });
    },
  };
}
