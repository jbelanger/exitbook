import {
  buildAccountingExclusionFingerprint,
  type AccountingExclusionPolicy,
  type CostBasisDependencyWatermark,
} from '@exitbook/accounting';
import { buildCostBasisArtifactFreshnessPorts } from '@exitbook/data/accounting';
import type { DataSession } from '@exitbook/data/session';
import { err, type Result } from '@exitbook/foundation';
import { readPriceCacheFreshness } from '@exitbook/price-providers';

export async function readCostBasisDependencyWatermark(
  db: DataSession,
  dataDir: string,
  accountingExclusionPolicy: AccountingExclusionPolicy,
  profileId: number
): Promise<Result<CostBasisDependencyWatermark, Error>> {
  const latestPriceMutationResult = await readPriceCacheFreshness(dataDir);
  if (latestPriceMutationResult.isErr()) {
    return err(latestPriceMutationResult.error);
  }

  const exclusionFingerprint = buildAccountingExclusionFingerprint(accountingExclusionPolicy.excludedAssetIds);
  return buildCostBasisArtifactFreshnessPorts(db, profileId, {
    pricesLastMutatedAt: latestPriceMutationResult.value,
  }).readCurrentWatermark(exclusionFingerprint);
}
