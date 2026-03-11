export interface AssetReviewFilterCandidate {
  accountingBlocked: boolean;
  reviewStatus: 'clear' | 'needs-review' | 'reviewed';
}

/**
 * Keep blocking ambiguities visible in the review workflow even after a user
 * confirms one contract.
 */
export function requiresAssetReviewAction(asset: AssetReviewFilterCandidate): boolean {
  return asset.reviewStatus === 'needs-review' || asset.accountingBlocked;
}
