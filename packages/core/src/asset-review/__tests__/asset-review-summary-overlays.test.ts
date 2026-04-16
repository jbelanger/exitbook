import { describe, expect, it } from 'vitest';

import { applyAssetExclusionsToReviewSummary } from '../asset-review-summary-overlays.js';
import type { AssetReviewSummary } from '../asset-review.js';

function createSummary(overrides: Partial<AssetReviewSummary> = {}): AssetReviewSummary {
  return {
    assetId: 'blockchain:arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    reviewStatus: 'needs-review',
    referenceStatus: 'matched',
    evidenceFingerprint: 'asset-review:v1:original',
    confirmationIsStale: false,
    accountingBlocked: true,
    confirmedEvidenceFingerprint: undefined,
    warningSummary: 'Same-chain symbol ambiguity on arbitrum:usdt',
    evidence: [
      {
        kind: 'same-symbol-ambiguity',
        severity: 'warning',
        message: 'Same-chain symbol ambiguity on arbitrum:usdt',
        metadata: {
          chain: 'arbitrum',
          normalizedSymbol: 'usdt',
          conflictingAssetIds: [
            'blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8',
            'blockchain:arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
          ],
        },
      },
    ],
    ...overrides,
  };
}

describe('applyAssetExclusionsToReviewSummary', () => {
  it('clears same-symbol ambiguity when every conflicting alternative is excluded', () => {
    const summary = createSummary();

    const result = applyAssetExclusionsToReviewSummary(
      summary,
      new Set(['blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8'])
    );

    expect(result.reviewStatus).toBe('clear');
    expect(result.accountingBlocked).toBe(false);
    expect(result.confirmationIsStale).toBe(false);
    expect(result.warningSummary).toBeUndefined();
    expect(result.evidence).toEqual([]);
    expect(result.evidenceFingerprint).not.toBe(summary.evidenceFingerprint);
  });

  it('keeps remaining active ambiguity and marks prior confirmation stale', () => {
    const summary = createSummary({
      reviewStatus: 'reviewed',
      evidenceFingerprint: 'asset-review:v1:reviewed',
      confirmedEvidenceFingerprint: 'asset-review:v1:reviewed',
      evidence: [
        {
          kind: 'same-symbol-ambiguity',
          severity: 'warning',
          message: 'Same-chain symbol ambiguity on arbitrum:usdt',
          metadata: {
            chain: 'arbitrum',
            normalizedSymbol: 'usdt',
            conflictingAssetIds: [
              'blockchain:arbitrum:0x111',
              'blockchain:arbitrum:0x222',
              'blockchain:arbitrum:0x333',
            ],
          },
        },
      ],
    });

    const result = applyAssetExclusionsToReviewSummary(summary, new Set(['blockchain:arbitrum:0x333']));

    expect(result.reviewStatus).toBe('needs-review');
    expect(result.accountingBlocked).toBe(true);
    expect(result.confirmationIsStale).toBe(true);
    expect(result.evidence).toEqual([
      {
        kind: 'same-symbol-ambiguity',
        severity: 'warning',
        message: 'Same-chain symbol ambiguity on arbitrum:usdt',
        metadata: {
          chain: 'arbitrum',
          normalizedSymbol: 'usdt',
          conflictingAssetIds: ['blockchain:arbitrum:0x111', 'blockchain:arbitrum:0x222'],
        },
      },
    ]);
  });
});
