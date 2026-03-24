import type { ICostBasisArtifactStore } from '@exitbook/accounting/ports';

import type { DataSession } from '../data-session.js';

export function buildCostBasisArtifactStore(db: DataSession): ICostBasisArtifactStore {
  return {
    findLatest: (scopeKey) => db.costBasisSnapshots.findLatest(scopeKey),
    replaceLatest: (snapshot) => db.costBasisSnapshots.replaceLatest(snapshot),
  };
}
