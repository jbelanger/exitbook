import type { AssetReviewEvidence } from '@exitbook/core';

export interface AssetReviewActionCandidate {
  accountingBlocked: boolean;
  confirmationIsStale: boolean;
  evidence: AssetReviewEvidence[];
  excluded: boolean;
  reviewStatus: 'clear' | 'needs-review' | 'reviewed';
}

type AssetAccountingDisplayStatus = 'allowed' | 'blocked' | 'excluded';

/**
 * Derives human-readable next action text from the asset's review and accounting state.
 * Separates "what happened" (review status) from "what to do next" (action required).
 */
export function requiresAssetReviewAction(asset: AssetReviewActionCandidate): boolean {
  return resolveNextAction(asset) !== undefined;
}

export function deriveNextAction(asset: AssetReviewActionCandidate): string | undefined {
  return resolveNextAction(asset);
}

export function deriveAccountingDisplayStatus(
  asset: Pick<AssetReviewActionCandidate, 'accountingBlocked' | 'excluded'>
): AssetAccountingDisplayStatus {
  if (asset.excluded) {
    return 'excluded';
  }

  return asset.accountingBlocked ? 'blocked' : 'allowed';
}

function resolveNextAction(asset: AssetReviewActionCandidate): string | undefined {
  if (asset.excluded) {
    return undefined;
  }

  const hasAmbiguity = asset.evidence.some((e) => e.kind === 'same-symbol-ambiguity');

  if (asset.confirmationIsStale) {
    return 'Re-confirm with updated evidence';
  }

  if (asset.reviewStatus === 'reviewed' && asset.accountingBlocked) {
    if (hasAmbiguity) {
      return 'Exclude one conflicting contract to unblock accounting';
    }
    return 'Resolve blocking evidence to unblock accounting';
  }

  if (asset.reviewStatus === 'needs-review') {
    if (hasAmbiguity) {
      return 'Review evidence, then exclude one conflicting contract';
    }
    return 'Review and confirm or exclude';
  }

  return undefined;
}
