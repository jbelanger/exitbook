import type { ICostBasisContextReader } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

/**
 * Bridges DataSession repositories to accounting's ICostBasisContextReader port.
 * Mirrors the pattern established by buildLinkingPorts and buildPricingPorts.
 */
export function buildCostBasisPorts(db: DataSession): ICostBasisContextReader {
  return {
    loadCostBasisContext: () =>
      resultDoAsync(async function* () {
        const transactions = yield* await db.transactions.findAll();
        const confirmedLinks = yield* await db.transactionLinks.findAll('confirmed');
        const accounts = yield* await db.accounts.findAll();

        return {
          transactions,
          confirmedLinks,
          accounts,
        };
      }),
  };
}
