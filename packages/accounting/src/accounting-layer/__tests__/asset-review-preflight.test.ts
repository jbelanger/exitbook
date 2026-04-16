import type { AssetReviewSummary } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  assertNoAccountingLayerAssetsRequireReview,
  collectBlockingAssetReviewSummaries,
} from '../asset-review-preflight.js';

function createAccountingTransactionView(assetIds: { fees?: string[]; inflows?: string[]; outflows?: string[] }) {
  return {
    processedTransaction: { id: 1 },
    inflows: (assetIds.inflows ?? []).map((assetId) => ({ assetId })),
    outflows: (assetIds.outflows ?? []).map((assetId) => ({ assetId })),
    fees: (assetIds.fees ?? []).map((assetId) => ({ assetId })),
  } as unknown as Parameters<
    typeof assertNoAccountingLayerAssetsRequireReview
  >[0]['accountingTransactionViews'][number];
}

function createAccountingLayer(assetIds: { fees?: string[]; inflows?: string[]; outflows?: string[] }[]) {
  return {
    accountingTransactionViews: assetIds.map(createAccountingTransactionView),
  } as unknown as Parameters<typeof assertNoAccountingLayerAssetsRequireReview>[0];
}

function createReviewSummary(
  assetId: string,
  opts: {
    accountingBlocked?: boolean;
    evidenceKinds?: { kind: string; metadata?: Record<string, unknown>; severity?: string }[];
    reviewStatus?: 'needs-review' | 'clear' | 'reviewed';
  } = {}
): AssetReviewSummary {
  return {
    assetId,
    accountingBlocked: opts.accountingBlocked ?? true,
    reviewStatus: opts.reviewStatus ?? 'needs-review',
    referenceStatus: 'unknown',
    evidenceFingerprint: 'test-fingerprint',
    confirmationIsStale: false,
    warningSummary: 'Test warning',
    evidence: (opts.evidenceKinds ?? [{ kind: 'general', severity: 'error' }]).map((e) => ({
      kind: e.kind as AssetReviewSummary['evidence'][number]['kind'],
      severity: (e.severity ?? 'error') as 'error' | 'warning',
      message: 'test evidence',
      metadata: e.metadata,
    })),
  };
}

describe('collectBlockingAssetReviewSummaries', () => {
  it('should return empty when no summaries provided', () => {
    const result = collectBlockingAssetReviewSummaries(new Set(['asset-a']));
    expect(result).toEqual([]);
  });

  it('should return empty when summaries map is empty', () => {
    const result = collectBlockingAssetReviewSummaries(new Set(['asset-a']), new Map());
    expect(result).toEqual([]);
  });

  it('should return blocking asset when in scope', () => {
    const summaries = new Map([['asset-a', createReviewSummary('asset-a')]]);
    const result = collectBlockingAssetReviewSummaries(new Set(['asset-a']), summaries);

    expect(result).toHaveLength(1);
    expect(result[0]!.assetId).toBe('asset-a');
  });

  it('should skip non-blocking assets', () => {
    const summaries = new Map([['asset-a', createReviewSummary('asset-a', { accountingBlocked: false })]]);
    const result = collectBlockingAssetReviewSummaries(new Set(['asset-a']), summaries);

    expect(result).toEqual([]);
  });

  it('should skip assets not in scope', () => {
    const summaries = new Map([['asset-b', createReviewSummary('asset-b')]]);
    const result = collectBlockingAssetReviewSummaries(new Set(['asset-a']), summaries);

    expect(result).toEqual([]);
  });

  it('should sort results by assetId', () => {
    const summaries = new Map([
      ['asset-c', createReviewSummary('asset-c')],
      ['asset-a', createReviewSummary('asset-a')],
      ['asset-b', createReviewSummary('asset-b')],
    ]);
    const result = collectBlockingAssetReviewSummaries(new Set(['asset-a', 'asset-b', 'asset-c']), summaries);

    expect(result.map((s) => s.assetId)).toEqual(['asset-a', 'asset-b', 'asset-c']);
  });
});

describe('assertNoAccountingLayerAssetsRequireReview', () => {
  it('should return ok when no assets are blocked', () => {
    const accountingLayer = createAccountingLayer([{ inflows: ['asset-a'] }]);
    const result = assertNoAccountingLayerAssetsRequireReview(accountingLayer);

    assertOk(result);
  });

  it('should return ok when blocking assets are not in scope', () => {
    const accountingLayer = createAccountingLayer([{ inflows: ['asset-a'] }]);
    const summaries = new Map([['asset-b', createReviewSummary('asset-b')]]);
    const result = assertNoAccountingLayerAssetsRequireReview(accountingLayer, summaries);

    assertOk(result);
  });

  it('should return error when scoped asset is blocked', () => {
    const accountingLayer = createAccountingLayer([{ inflows: ['asset-a'] }]);
    const summaries = new Map([['asset-a', createReviewSummary('asset-a')]]);
    const result = assertErr(assertNoAccountingLayerAssetsRequireReview(accountingLayer, summaries));

    expect(result.message).toContain('asset-a');
    expect(result.message).toContain('review');
  });

  it('should collect asset ids from inflows, outflows, and fees', () => {
    const accountingLayer = createAccountingLayer([
      {
        inflows: ['asset-a'],
        outflows: ['asset-b'],
        fees: ['asset-c'],
      },
    ]);
    const summaries = new Map([['asset-c', createReviewSummary('asset-c')]]);
    const result = assertErr(assertNoAccountingLayerAssetsRequireReview(accountingLayer, summaries));

    expect(result.message).toContain('asset-c');
  });
});
