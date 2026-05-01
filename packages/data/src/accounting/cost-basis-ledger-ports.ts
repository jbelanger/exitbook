import type { ICostBasisLedgerContextReader } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

export function buildCostBasisLedgerPorts(db: DataSession, profileId: number): ICostBasisLedgerContextReader {
  return {
    loadCostBasisLedgerContext: () =>
      resultDoAsync(async function* () {
        const accounts = yield* await db.accounts.findAll({ profileId });
        const ledgerFacts = yield* await db.accountingLedger.findCostBasisLedgerFactsByProfileId(profileId);

        return {
          accounts,
          ...ledgerFacts,
        };
      }),
  };
}
