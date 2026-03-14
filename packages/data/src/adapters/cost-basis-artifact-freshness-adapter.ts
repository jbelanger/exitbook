import type { CostBasisDependencyWatermark, ICostBasisDependencyWatermarkReader } from '@exitbook/accounting/ports';
import { err, ok, type Result } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

export function buildCostBasisArtifactFreshnessPorts(db: DataContext): ICostBasisDependencyWatermarkReader {
  return {
    async readCurrentWatermark(exclusionFingerprint): Promise<Result<CostBasisDependencyWatermark, Error>> {
      const [linksResult, assetReviewResult, pricesResult] = await Promise.all([
        db.projectionState.get('links'),
        db.projectionState.get('asset-review'),
        db.costBasisDependencyVersions.getVersion('prices'),
      ]);

      if (linksResult.isErr()) return err(linksResult.error);
      if (assetReviewResult.isErr()) return err(assetReviewResult.error);
      if (pricesResult.isErr()) return err(pricesResult.error);

      return ok({
        links: linksResult.value
          ? { status: linksResult.value.status, lastBuiltAt: linksResult.value.lastBuiltAt ?? undefined }
          : { status: 'missing', lastBuiltAt: undefined },
        assetReview: assetReviewResult.value
          ? { status: assetReviewResult.value.status, lastBuiltAt: assetReviewResult.value.lastBuiltAt ?? undefined }
          : { status: 'missing', lastBuiltAt: undefined },
        pricesMutationVersion: pricesResult.value.version,
        exclusionFingerprint,
      });
    },
  };
}
