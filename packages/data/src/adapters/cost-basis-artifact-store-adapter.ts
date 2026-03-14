import type { ICostBasisArtifactStore } from '@exitbook/accounting/ports';

import type { DataContext } from '../data-context.js';

export function buildCostBasisArtifactStore(db: DataContext): ICostBasisArtifactStore {
  return {
    findLatest: (scopeKey) => db.costBasisSnapshots.findLatest(scopeKey),
    replaceLatest: (snapshot) => db.costBasisSnapshots.replaceLatest(snapshot),
  };
}
