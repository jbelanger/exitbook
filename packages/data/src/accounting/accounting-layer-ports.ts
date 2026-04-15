import type { IAccountingLayerSourceReader } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

export function buildAccountingLayerSourcePorts(db: DataSession, profileId: number): IAccountingLayerSourceReader {
  return {
    loadAccountingLayerSource: () =>
      resultDoAsync(async function* () {
        const transactions = yield* await db.transactions.findAll({ profileId });
        return { transactions };
      }),
  };
}
