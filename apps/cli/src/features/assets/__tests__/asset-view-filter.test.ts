import { describe, expect, it } from 'vitest';

import {
  deriveAccountingDisplayStatus,
  deriveNextAction,
  requiresAssetReviewAction,
  type AssetReviewActionCandidate,
} from '../asset-view-filter.js';

function createCandidate(overrides: Partial<AssetReviewActionCandidate> = {}): AssetReviewActionCandidate {
  return {
    accountingBlocked: false,
    confirmationIsStale: false,
    evidence: [],
    excluded: false,
    reviewStatus: 'clear',
    ...overrides,
  };
}

describe('asset-view-filter', () => {
  it('does not count excluded assets as action-required', () => {
    const asset = createCandidate({
      accountingBlocked: true,
      excluded: true,
      reviewStatus: 'needs-review',
      evidence: [
        {
          kind: 'same-symbol-ambiguity',
          severity: 'warning',
          message: 'Same-chain symbol ambiguity on ethereum:usdc',
        },
      ],
    });

    expect(requiresAssetReviewAction(asset)).toBe(false);
    expect(deriveNextAction(asset)).toBeUndefined();
    expect(deriveAccountingDisplayStatus(asset)).toBe('excluded');
  });

  it('keeps reviewed but still-blocking ambiguity assets action-required', () => {
    const asset = createCandidate({
      accountingBlocked: true,
      reviewStatus: 'reviewed',
      evidence: [
        {
          kind: 'same-symbol-ambiguity',
          severity: 'warning',
          message: 'Same-chain symbol ambiguity on ethereum:usdc',
        },
      ],
    });

    expect(requiresAssetReviewAction(asset)).toBe(true);
    expect(deriveNextAction(asset)).toBe('Exclude one conflicting contract to unblock accounting');
  });
});
