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
    mockBuildTaxPackageBuildContext.mockReturnValue(
      ok({
        sourceContext: {
          transactionsById: new Map(),
        },
      })
    );
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
      incompleteTransferLinkDetails: [],
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
        message: '3 transfers require manual review because a confirmed source/target link is missing.',
        severity: 'warning',
      },
    ]);
  });

  it('adds transaction-based guidance for missing confirmed links', () => {
    mockBuildTaxPackageBuildContext.mockReturnValue(
      ok({
        sourceContext: {
          transactionsById: new Map([
            [41, { txFingerprint: 'e96a8b7baa111111111111111111111111111111111111111111111111111111' }],
            [42, { txFingerprint: 'b7c08af224222222222222222222222222222222222222222222222222222222' }],
          ]),
        },
      })
    );
    mockDeriveTaxPackageReadinessMetadata.mockReturnValue({
      incompleteTransferLinkCount: 1,
      incompleteTransferLinkDetails: [
        {
          assetSymbol: 'LINK',
          rowId: 'transfer-1',
          sourcePlatformKey: 'kraken',
          sourceTransactionId: 41,
          targetPlatformKey: 'ethereum',
          targetTransactionId: 42,
          transactionDatetime: '2024-06-08T13:17:59.000Z',
          transactionId: 41,
        },
      ],
      unresolvedAssetReviewCount: 0,
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
        code: 'INCOMPLETE_TRANSFER_LINKING',
        commandHint: 'pnpm run dev links create e96a8b7baa b7c08af224 --asset LINK',
        count: 1,
        detail: 'Example: LINK on 2024-06-08 (kraken -> ethereum, tx 41 -> 42).',
        message: '1 transfer requires manual review because a confirmed source/target link is missing.',
        recommendedAction: 'Create the missing confirmed link directly, then rerun cost basis.',
        severity: 'warning',
      },
    ]);
  });
});
