import type { ICostBasisFailureSnapshotStore } from '@exitbook/accounting/ports';

import type { DataContext } from '../data-context.js';

export function buildCostBasisFailureSnapshotStore(db: DataContext): ICostBasisFailureSnapshotStore {
  return {
    replaceLatest: (snapshot) => db.costBasisFailureSnapshots.replaceLatest(snapshot),
  };
}
