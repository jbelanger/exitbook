import { err, ok, type Result } from '@exitbook/foundation';
import type { AssetReviewProjectionRuntimePorts } from '@exitbook/ingestion/ports';

import type { DataSession } from '../data-session.js';
import { readAssetReviewDecisions } from '../overrides/asset-review-replay.js';
import { OverrideStore } from '../overrides/override-store.js';

import { buildAssetReviewFreshnessPorts } from './asset-review-freshness.js';
import { buildAssetReviewProjectionDataPorts } from './asset-review-projection-data-ports.js';

const ASSET_REVIEW_OVERRIDE_SCOPES = ['asset-review-confirm', 'asset-review-clear'] as const;

export function buildAssetReviewRuntimePorts(db: DataSession, dataDir: string): AssetReviewProjectionRuntimePorts {
  const overrideStore = new OverrideStore(dataDir);
  const projectionPorts = buildAssetReviewProjectionDataPorts(db);
  const freshnessPorts = buildAssetReviewFreshnessPorts(db);

  return {
    ...projectionPorts,
    loadReviewDecisions: () => readAssetReviewDecisions(overrideStore),
    checkAssetReviewFreshness: () => freshnessPorts.checkFreshness(),
    async getLastAssetReviewBuiltAt(): Promise<Result<Date | undefined, Error>> {
      const stateResult = await db.projectionState.get('asset-review');
      if (stateResult.isErr()) {
        return err(stateResult.error);
      }

      return ok(stateResult.value?.lastBuiltAt ?? undefined);
    },
    findLatestAssetReviewOverrideAt: () => overrideStore.findLatestCreatedAt([...ASSET_REVIEW_OVERRIDE_SCOPES]),
  };
}
