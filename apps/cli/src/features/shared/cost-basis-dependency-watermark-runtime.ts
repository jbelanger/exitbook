import {
  buildAccountingExclusionFingerprint,
  type AccountingExclusionPolicy,
  type CostBasisDependencyWatermark,
} from '@exitbook/accounting';
import { buildCostBasisArtifactFreshnessPorts, type DataContext } from '@exitbook/data';
import { err, type Result } from '@exitbook/foundation';
import { readPriceCacheFreshness } from '@exitbook/price-providers';

export async function readCostBasisDependencyWatermark(
  db: DataContext,
  dataDir: string,
  accountingExclusionPolicy: AccountingExclusionPolicy
): Promise<Result<CostBasisDependencyWatermark, Error>> {
  const latestPriceMutationResult = await readPriceCacheFreshness(dataDir);
  if (latestPriceMutationResult.isErr()) {
    return err(latestPriceMutationResult.error);
  }

  const exclusionFingerprint = buildAccountingExclusionFingerprint(accountingExclusionPolicy.excludedAssetIds);
  return buildCostBasisArtifactFreshnessPorts(db, {
    pricesLastMutatedAt: latestPriceMutationResult.value,
  }).readCurrentWatermark(exclusionFingerprint);
}
