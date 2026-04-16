import type { IAccountingModelSourceReader } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

export function buildAccountingModelSourceReader(db: DataSession, profileId: number): IAccountingModelSourceReader {
  return {
    loadAccountingModelSource: () =>
      resultDoAsync(async function* () {
        const transactions = yield* await db.transactions.findAll({ profileId });
        return { transactions };
      }),
  };
}
