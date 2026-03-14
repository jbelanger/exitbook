import path from 'node:path';

import {
  buildAccountingExclusionFingerprint,
  type AccountingExclusionPolicy,
  type CostBasisDependencyWatermark,
} from '@exitbook/accounting';
import { err, type Result } from '@exitbook/core';
import { buildCostBasisArtifactFreshnessPorts, type DataContext } from '@exitbook/data';
import { readLatestPriceMutationAt } from '@exitbook/price-providers';

export async function readCostBasisDependencyWatermark(
  db: DataContext,
  dataDir: string,
  accountingExclusionPolicy: AccountingExclusionPolicy
): Promise<Result<CostBasisDependencyWatermark, Error>> {
  const latestPriceMutationResult = await readLatestPriceMutationAt(path.join(dataDir, 'prices.db'));
  if (latestPriceMutationResult.isErr()) {
    return err(latestPriceMutationResult.error);
  }

  const exclusionFingerprint = buildAccountingExclusionFingerprint(accountingExclusionPolicy.excludedAssetIds);
  return buildCostBasisArtifactFreshnessPorts(db, {
    pricesLastMutatedAt: latestPriceMutationResult.value,
  }).readCurrentWatermark(exclusionFingerprint);
}
