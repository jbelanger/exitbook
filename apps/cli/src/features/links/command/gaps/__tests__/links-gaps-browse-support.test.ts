import type { ProfileLinkGapSourceData } from '@exitbook/accounting/ports';
import { ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

const { mockBuildVisibleProfileLinkGapAnalysis } = vi.hoisted(() => ({
  mockBuildVisibleProfileLinkGapAnalysis: vi.fn(),
}));

vi.mock('@exitbook/accounting/linking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/accounting/linking')>();

  return {
    ...actual,
    buildVisibleProfileLinkGapAnalysis: mockBuildVisibleProfileLinkGapAnalysis,
  };
});

import { createConfirmableTransferFixture, createMockGapAnalysis } from '../../../__tests__/test-utils.js';
import { buildLinkGapRef, buildLinkProposalRef } from '../../../link-selector.js';
import { buildTransferProposalItems } from '../../../transfer-proposals.js';
import { buildLinksGapsBrowsePresentation } from '../links-gaps-browse-support.js';

type LinksGapSourceReader = Parameters<typeof buildLinksGapsBrowsePresentation>[0];

function createLinksGapSourceReader(): {
  loadProfileLinkGapSourceData: ReturnType<typeof vi.fn>;
  sourceReader: LinksGapSourceReader;
} {
  const loadProfileLinkGapSourceData = vi.fn().mockResolvedValue(
    ok({
      accounts: [],
      excludedAssetIds: new Set<string>(),
      links: [],
      resolvedIssueKeys: new Set<string>(),
      transactions: [],
    })
  );

  return {
    loadProfileLinkGapSourceData,
    sourceReader: {
      loadProfileLinkGapSourceData,
    },
  };
}

function createCustomLinksGapSourceReader(sourceData: ProfileLinkGapSourceData): {
  loadProfileLinkGapSourceData: ReturnType<typeof vi.fn>;
  sourceReader: LinksGapSourceReader;
} {
  const loadProfileLinkGapSourceData = vi.fn().mockResolvedValue(ok(sourceData));

  return {
    loadProfileLinkGapSourceData,
    sourceReader: {
      loadProfileLinkGapSourceData,
    },
  };
}

describe('links-gaps-browse-support', () => {
  it('orders gap browsing data chronologically', async () => {
    const analysis = createMockGapAnalysis();
    analysis.issues = [analysis.issues[2]!, analysis.issues[0]!, analysis.issues[1]!];
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });

    const result = await buildLinksGapsBrowsePresentation(createLinksGapSourceReader().sourceReader, {});

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps.map((gap) => gap.gapIssue.txFingerprint)).toEqual([
      'eth-inflow-1',
      'eth-inflow-2',
      'kraken-outflow-1',
    ]);
    expect(result.value.state.linkAnalysis.issues.map((issue) => issue.txFingerprint)).toEqual([
      'eth-inflow-1',
      'eth-inflow-2',
      'kraken-outflow-1',
    ]);
  });

  it('loads gap analysis from the shared profile gap source reader seam', async () => {
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis: createMockGapAnalysis(),
      hiddenResolvedIssueCount: 1,
    });
    const sourceReader = createLinksGapSourceReader();

    const result = await buildLinksGapsBrowsePresentation(sourceReader.sourceReader, {});

    expect(result.isOk()).toBe(true);
    expect(sourceReader.loadProfileLinkGapSourceData).toHaveBeenCalledTimes(1);
    expect(mockBuildVisibleProfileLinkGapAnalysis).toHaveBeenCalledWith({
      accounts: [],
      excludedAssetIds: new Set<string>(),
      links: [],
      resolvedIssueKeys: new Set<string>(),
      transactions: [],
    });
  });

  it('treats same-transaction gap rows as distinct selector targets', async () => {
    const analysis = createMockGapAnalysis();
    const secondGap = {
      ...analysis.issues[0]!,
      assetId: 'blockchain:ethereum:0xusdc',
      assetSymbol: 'USDC',
      missingAmount: '25',
      totalAmount: '25',
    };
    analysis.issues = [analysis.issues[0]!, secondGap, analysis.issues[1]!];
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });

    const secondGapRef = buildLinkGapRef({
      txFingerprint: secondGap.txFingerprint,
      assetId: secondGap.assetId,
      direction: secondGap.direction,
    });
    const result = await buildLinksGapsBrowsePresentation(createLinksGapSourceReader().sourceReader, {
      preselectInExplorer: true,
      selector: secondGapRef,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.selectedGap?.gapRef).toBe(secondGapRef);
    expect(result.value.selectedGap?.gapIssue.assetId).toBe('blockchain:ethereum:0xusdc');
    expect(result.value.selectedGap?.transactionGapCount).toBe(2);
    expect(result.value.state.selectedIndex).toBe(1);
  });

  it('formats gap transaction refs with the transaction ref formatter', async () => {
    const analysis = createMockGapAnalysis();
    analysis.issues = [
      {
        ...analysis.issues[0]!,
        txFingerprint: '1234567890abcdef-gap',
      },
    ];
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });

    const result = await buildLinksGapsBrowsePresentation(createLinksGapSourceReader().sourceReader, {});

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps[0]?.transactionRef).toBe('1234567890');
  });

  it('attaches exact suggested proposal refs to matching source and target gap rows', async () => {
    const fixture = createConfirmableTransferFixture();
    const proposalRef = buildLinkProposalRef(buildTransferProposalItems([{ link: fixture.link }])[0]!.proposalKey);
    const analysis = {
      issues: [
        {
          transactionId: fixture.sourceTransaction.id,
          txFingerprint: fixture.sourceTransaction.txFingerprint,
          platformKey: fixture.sourceTransaction.platformKey,
          timestamp: fixture.sourceTransaction.datetime,
          assetId: fixture.link.sourceAssetId,
          assetSymbol: fixture.link.assetSymbol,
          missingAmount: '1',
          totalAmount: '1',
          confirmedCoveragePercent: '0',
          operationCategory: fixture.sourceTransaction.operation.category,
          operationType: fixture.sourceTransaction.operation.type,
          suggestedCount: 1,
          highestSuggestedConfidencePercent: '99.0',
          direction: 'outflow' as const,
        },
        {
          transactionId: fixture.targetTransaction.id,
          txFingerprint: fixture.targetTransaction.txFingerprint,
          platformKey: fixture.targetTransaction.platformKey,
          timestamp: fixture.targetTransaction.datetime,
          assetId: fixture.link.targetAssetId,
          assetSymbol: fixture.link.assetSymbol,
          missingAmount: '1',
          totalAmount: '1',
          confirmedCoveragePercent: '0',
          operationCategory: fixture.targetTransaction.operation.category,
          operationType: fixture.targetTransaction.operation.type,
          suggestedCount: 1,
          highestSuggestedConfidencePercent: '99.0',
          direction: 'inflow' as const,
        },
      ],
      summary: {
        total_issues: 2,
        uncovered_inflows: 1,
        unmatched_outflows: 1,
        affected_assets: 1,
        assets: [
          {
            assetSymbol: fixture.link.assetSymbol,
            inflowOccurrences: 1,
            inflowMissingAmount: '1',
            outflowOccurrences: 1,
            outflowMissingAmount: '1',
          },
        ],
      },
    };
    mockBuildVisibleProfileLinkGapAnalysis.mockReturnValue({
      analysis,
      hiddenResolvedIssueCount: 0,
    });
    const sourceReader = createCustomLinksGapSourceReader({
      accounts: [],
      excludedAssetIds: new Set<string>(),
      links: [fixture.link],
      resolvedIssueKeys: new Set<string>(),
      transactions: fixture.transactions,
    });

    const result = await buildLinksGapsBrowsePresentation(sourceReader.sourceReader, {});

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps.map((gap) => gap.suggestedProposalRefs)).toEqual([[proposalRef], [proposalRef]]);
  });
});
