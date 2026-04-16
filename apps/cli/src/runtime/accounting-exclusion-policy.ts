import { createAccountingExclusionPolicy, type AccountingExclusionPolicy } from '@exitbook/accounting/accounting-model';
import { OverrideStore, readExcludedAssetIds } from '@exitbook/data/overrides';
import { err, ok, type Result } from '@exitbook/foundation';

export async function loadAccountingExclusionPolicy(
  dataDir: string,
  profileKey: string
): Promise<Result<AccountingExclusionPolicy, Error>> {
  const overrideStore = new OverrideStore(dataDir);
  const excludedAssetIdsResult = await readExcludedAssetIds(overrideStore, profileKey);
  if (excludedAssetIdsResult.isErr()) {
    return err(excludedAssetIdsResult.error);
  }

  return ok(createAccountingExclusionPolicy(excludedAssetIdsResult.value));
}
