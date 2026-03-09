import { createAccountingExclusionPolicy, type AccountingExclusionPolicy } from '@exitbook/accounting';
import { err, ok, type Result } from '@exitbook/core';
import { OverrideStore, readExcludedAssetIds } from '@exitbook/data';

export async function loadAccountingExclusionPolicy(
  dataDir: string
): Promise<Result<AccountingExclusionPolicy, Error>> {
  const overrideStore = new OverrideStore(dataDir);
  const excludedAssetIdsResult = await readExcludedAssetIds(overrideStore);
  if (excludedAssetIdsResult.isErr()) {
    return err(excludedAssetIdsResult.error);
  }

  return ok(createAccountingExclusionPolicy(excludedAssetIdsResult.value));
}
