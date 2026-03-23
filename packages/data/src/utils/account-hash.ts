import { resultDoAsync } from '@exitbook/foundation';

import type { DataContext } from '../data-context.js';

/**
 * Compute a deterministic hash of the current account graph.
 * Changes when accounts are added, removed, or their identifiers change.
 *
 * Used by both the freshness adapter (to detect staleness) and the
 * processing ports adapter (to record what hash a fresh build corresponds to).
 */
export function computeAccountHash(db: DataContext) {
  return resultDoAsync(async function* () {
    const accounts = yield* await db.accounts.findAll();
    const sorted = accounts.map((a) => `${a.id}:${a.identifier}`).sort();
    const raw = sorted.join('|');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(36);
  });
}
