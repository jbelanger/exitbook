import type { CostBasisDependencyWatermark, ICostBasisDependencyWatermarkReader } from '@exitbook/accounting/ports';
import { err, ok, type Result } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';
import { buildProfileProjectionScopeKey } from '../projections/profile-scope-key.js';

export function buildCostBasisArtifactFreshnessPorts(
  db: DataSession,
  profileId: number,
  options?: { pricesLastMutatedAt?: Date | undefined }
): ICostBasisDependencyWatermarkReader {
  const scopeKey = buildProfileProjectionScopeKey(profileId);

  return {
    async readCurrentWatermark(exclusionFingerprint): Promise<Result<CostBasisDependencyWatermark, Error>> {
      const [linksResult, assetReviewResult] = await Promise.all([
        db.projectionState.find('links', scopeKey),
        db.projectionState.find('asset-review', scopeKey),
      ]);

      if (linksResult.isErr()) return err(linksResult.error);
      if (assetReviewResult.isErr()) return err(assetReviewResult.error);

      return ok({
        links: linksResult.value
          ? { status: linksResult.value.status, lastBuiltAt: linksResult.value.lastBuiltAt ?? undefined }
          : { status: 'missing', lastBuiltAt: undefined },
        assetReview: assetReviewResult.value
          ? { status: assetReviewResult.value.status, lastBuiltAt: assetReviewResult.value.lastBuiltAt ?? undefined }
          : { status: 'missing', lastBuiltAt: undefined },
        ...(options?.pricesLastMutatedAt ? { pricesLastMutatedAt: options.pricesLastMutatedAt } : {}),
        exclusionFingerprint,
      });
    },
  };
}
