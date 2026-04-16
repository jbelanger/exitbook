import { err, ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import { runAssetsClearReview, runAssetsConfirmReview, runAssetsExclude, runAssetsInclude } from '../run-assets.js';

function createScope() {
  return {
    overrideService: {
      clearReview: vi.fn(),
      confirmReview: vi.fn(),
      exclude: vi.fn(),
      include: vi.fn(),
    },
    profile: {
      id: 1,
      profileKey: 'default',
      displayName: 'default',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    },
    refreshProfileIssues: vi.fn(),
    snapshotReader: {},
  };
}

describe('run-assets mutation helpers', () => {
  it('refreshes profile issues after a changed exclusion', async () => {
    const scope = createScope();
    scope.overrideService.exclude.mockResolvedValue(
      ok({
        action: 'exclude',
        assetId: 'asset-1',
        assetSymbols: ['USDT'],
        changed: true,
      })
    );
    scope.refreshProfileIssues.mockResolvedValue(ok(undefined));

    const result = await runAssetsExclude(scope as never, { assetId: 'asset-1' });

    expect(scope.overrideService.exclude).toHaveBeenCalledWith({
      assetId: 'asset-1',
      profileId: 1,
      profileKey: 'default',
    });
    expect(scope.refreshProfileIssues).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      ok({
        action: 'exclude',
        assetId: 'asset-1',
        assetSymbols: ['USDT'],
        changed: true,
      })
    );
  });

  it('skips profile issue refresh when confirm-review is unchanged', async () => {
    const scope = createScope();
    scope.overrideService.confirmReview.mockResolvedValue(
      ok({
        action: 'confirm',
        accountingBlocked: true,
        assetId: 'asset-2',
        assetSymbols: ['USDC'],
        changed: false,
        confirmationIsStale: false,
        evidence: [],
        evidenceFingerprint: 'evidence-1',
        referenceStatus: 'known',
        reviewStatus: 'reviewed',
      })
    );

    const result = await runAssetsConfirmReview(scope as never, { symbol: 'USDC' });

    expect(scope.overrideService.confirmReview).toHaveBeenCalledWith({
      profileId: 1,
      profileKey: 'default',
      symbol: 'USDC',
    });
    expect(scope.refreshProfileIssues).not.toHaveBeenCalled();
    expect(result.isOk()).toBe(true);
  });

  it('propagates refresh failures after a changed clear-review action', async () => {
    const scope = createScope();
    const refreshError = new Error('issue projection refresh failed');
    scope.overrideService.clearReview.mockResolvedValue(
      ok({
        action: 'clear-review',
        accountingBlocked: true,
        assetId: 'asset-3',
        assetSymbols: ['ARB'],
        changed: true,
        confirmationIsStale: false,
        evidence: [],
        evidenceFingerprint: 'evidence-2',
        referenceStatus: 'known',
        reviewStatus: 'not-reviewed',
      })
    );
    scope.refreshProfileIssues.mockResolvedValue(err(refreshError));

    const result = await runAssetsClearReview(scope as never, { assetId: 'asset-3' });

    expect(scope.refreshProfileIssues).toHaveBeenCalledTimes(1);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected clear-review refresh to fail');
    }
    expect(result.error).toBe(refreshError);
  });

  it('refreshes profile issues after a changed include', async () => {
    const scope = createScope();
    scope.overrideService.include.mockResolvedValue(
      ok({
        action: 'include',
        assetId: 'asset-4',
        assetSymbols: ['ETH'],
        changed: true,
      })
    );
    scope.refreshProfileIssues.mockResolvedValue(ok(undefined));

    const result = await runAssetsInclude(scope as never, { assetId: 'asset-4', reason: 'restore asset' });

    expect(scope.overrideService.include).toHaveBeenCalledWith({
      assetId: 'asset-4',
      profileId: 1,
      profileKey: 'default',
      reason: 'restore asset',
    });
    expect(scope.refreshProfileIssues).toHaveBeenCalledTimes(1);
    expect(result.isOk()).toBe(true);
  });
});
