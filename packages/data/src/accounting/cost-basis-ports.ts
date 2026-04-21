import type { ICostBasisContextReader } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';
import { ANNOTATION_KINDS, ANNOTATION_TIERS } from '@exitbook/transaction-interpretation';

import type { DataSession } from '../data-session.js';

/**
 * Bridges DataSession repositories to accounting's ICostBasisContextReader port.
 * Mirrors the pattern established by buildLinkingPorts and buildPricingPorts.
 */
export function buildCostBasisPorts(db: DataSession, profileId: number): ICostBasisContextReader {
  return {
    loadCostBasisContext: () =>
      resultDoAsync(async function* () {
        const transactions = yield* await db.transactions.findAll({ profileId });
        const confirmedLinks = yield* await db.transactionLinks.findAll({ profileId, status: 'confirmed' });
        const accounts = yield* await db.accounts.findAll({ profileId });
        const transactionAnnotations =
          accounts.length === 0
            ? []
            : yield* await db.transactionAnnotations.readAnnotations({
                accountIds: accounts.map((account) => account.id),
                kinds: ANNOTATION_KINDS,
                tiers: ANNOTATION_TIERS,
              });

        return {
          transactions,
          confirmedLinks,
          accounts,
          transactionAnnotations,
        };
      }),
  };
}
