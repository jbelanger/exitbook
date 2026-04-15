import type { IAccountingEntrySourceReader } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

export function buildAccountingEntrySourcePorts(db: DataSession, profileId: number): IAccountingEntrySourceReader {
  return {
    loadAccountingEntrySource: () =>
      resultDoAsync(async function* () {
        const transactions = yield* await db.transactions.findAll({ profileId });
        return { transactions };
      }),
  };
}
