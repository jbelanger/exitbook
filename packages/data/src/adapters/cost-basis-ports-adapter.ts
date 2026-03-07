import type { ICostBasisPersistence } from '@exitbook/accounting/ports';
import { resultFromAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's ICostBasisPersistence port.
 * Mirrors the pattern established by buildLinkingPorts and buildPricingPorts.
 */
export function buildCostBasisPorts(db: DataContext): ICostBasisPersistence {
  return {
    loadCostBasisContext: () =>
      resultFromAsync(async function* () {
        const transactions = yield* await db.transactions.findAll();
        const confirmedLinks = yield* await db.transactionLinks.findAll('confirmed');

        return {
          transactions,
          confirmedLinks,
        };
      }),
  };
}
