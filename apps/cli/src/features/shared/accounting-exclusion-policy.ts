import { createAccountingExclusionPolicy, type AccountingExclusionPolicy } from '@exitbook/accounting';
import { OverrideStore, readExcludedAssetIds } from '@exitbook/data/overrides';
import { err, ok, type Result } from '@exitbook/foundation';

export async function loadAccountingExclusionPolicy(
  dataDir: string,
  profileId: number
): Promise<Result<AccountingExclusionPolicy, Error>> {
  const overrideStore = new OverrideStore(dataDir);
  const excludedAssetIdsResult = await readExcludedAssetIds(overrideStore, profileId);
  if (excludedAssetIdsResult.isErr()) {
    return err(excludedAssetIdsResult.error);
  }

  return ok(createAccountingExclusionPolicy(excludedAssetIdsResult.value));
}
