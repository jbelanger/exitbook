import { ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuildTaxPackageBuildContext, mockDeriveTaxPackageReadinessMetadata } = vi.hoisted(() => ({
  mockBuildTaxPackageBuildContext: vi.fn(),
  mockDeriveTaxPackageReadinessMetadata: vi.fn(),
}));

vi.mock('@exitbook/accounting/cost-basis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/accounting/cost-basis')>();
  return {
    ...actual,
    buildTaxPackageBuildContext: mockBuildTaxPackageBuildContext,
    deriveTaxPackageReadinessMetadata: mockDeriveTaxPackageReadinessMetadata,
  };
});

import { buildCostBasisReadinessWarnings } from '../cost-basis-readiness.js';

describe('buildCostBasisReadinessWarnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildTaxPackageBuildContext.mockReturnValue(ok({ tag: 'build-context' }));
    mockDeriveTaxPackageReadinessMetadata.mockReturnValue({
      incompleteTransferLinkCount: 0,
      unresolvedAssetReviewCount: 0,
    });
  });

  it('returns no warnings when linking and asset review are clear', () => {
    const result = buildCostBasisReadinessWarnings({
      artifact: { tag: 'artifact' } as never,
      assetReviewSummaries: new Map(),
      scopeKey: 'scope-1',
      snapshotId: 'snapshot-1',
      sourceContext: { tag: 'source-context' } as never,
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value : []).toEqual([]);
  });

  it('maps asset-review blockers ahead of incomplete transfer warnings', () => {
    mockDeriveTaxPackageReadinessMetadata.mockReturnValue({
      incompleteTransferLinkCount: 3,
      unresolvedAssetReviewCount: 2,
    });

    const result = buildCostBasisReadinessWarnings({
      artifact: { tag: 'artifact' } as never,
      assetReviewSummaries: new Map(),
      scopeKey: 'scope-1',
      snapshotId: 'snapshot-1',
      sourceContext: { tag: 'source-context' } as never,
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value : []).toEqual([
      {
        code: 'UNRESOLVED_ASSET_REVIEW',
        count: 2,
        message: '2 assets still require review before filing export.',
        severity: 'blocked',
      },
      {
        code: 'INCOMPLETE_TRANSFER_LINKING',
        count: 3,
        message: '3 transfers require manual review because linking is incomplete.',
        severity: 'warning',
      },
    ]);
  });
});
