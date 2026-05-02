import { hashCostBasisStableValue } from './cost-basis-stable-hash.js';

export interface AccountingExclusionFingerprintInput {
  excludedAssetIds: Iterable<string>;
  excludedPostingFingerprints?: Iterable<string> | undefined;
}

export function buildAccountingExclusionFingerprint(input: AccountingExclusionFingerprintInput): string {
  const excludedAssetIds = [...new Set(input.excludedAssetIds)].sort();
  const excludedPostingFingerprints = [...new Set(input.excludedPostingFingerprints ?? [])].sort();

  if (excludedAssetIds.length === 0 && excludedPostingFingerprints.length === 0) {
    return 'accounting-exclusions:none';
  }

  return `accounting-exclusions:${hashCostBasisStableValue(
    JSON.stringify({
      excludedAssetIds,
      excludedPostingFingerprints,
    })
  )}`;
}
