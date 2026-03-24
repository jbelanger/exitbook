import type { ICostBasisFailureSnapshotStore } from '@exitbook/accounting/ports';

import type { DataSession } from '../data-session.js';

export function buildCostBasisFailureSnapshotStore(db: DataSession): ICostBasisFailureSnapshotStore {
  return {
    replaceLatest: (snapshot) => db.costBasisFailureSnapshots.replaceLatest(snapshot),
  };
}
