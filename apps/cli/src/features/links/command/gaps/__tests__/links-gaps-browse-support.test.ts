import { ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

const { mockLoadVisibleProfileLinkGapAnalysis } = vi.hoisted(() => ({
  mockLoadVisibleProfileLinkGapAnalysis: vi.fn(),
}));

vi.mock('@exitbook/accounting/linking', () => {
  return {
    loadVisibleProfileLinkGapAnalysis: mockLoadVisibleProfileLinkGapAnalysis,
  };
});

import { createMockGapAnalysis } from '../../../__tests__/test-utils.js';
import { buildLinkGapRef } from '../../../link-selector.js';
import { buildLinksGapsBrowsePresentation } from '../links-gaps-browse-support.js';

type LinksGapSourceReader = Parameters<typeof buildLinksGapsBrowsePresentation>[0];

function createLinksGapSourceReader(): LinksGapSourceReader {
  return {
    loadProfileLinkGapSourceData: vi.fn().mockResolvedValue(
      ok({
        accounts: [],
        excludedAssetIds: new Set<string>(),
        links: [],
        resolvedIssueKeys: new Set<string>(),
        transactions: [],
      })
    ),
  };
}

describe('links-gaps-browse-support', () => {
  it('orders gap browsing data chronologically', async () => {
    const analysis = createMockGapAnalysis();
    analysis.issues = [analysis.issues[2]!, analysis.issues[0]!, analysis.issues[1]!];
    mockLoadVisibleProfileLinkGapAnalysis.mockResolvedValue(
      ok({
        analysis,
        hiddenResolvedIssueCount: 0,
      })
    );

    const result = await buildLinksGapsBrowsePresentation(createLinksGapSourceReader(), {});

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
    mockLoadVisibleProfileLinkGapAnalysis.mockResolvedValue(
      ok({
        analysis: createMockGapAnalysis(),
        hiddenResolvedIssueCount: 1,
      })
    );
    const sourceReader = createLinksGapSourceReader();

    const result = await buildLinksGapsBrowsePresentation(sourceReader, {});

    expect(result.isOk()).toBe(true);
    expect(mockLoadVisibleProfileLinkGapAnalysis).toHaveBeenCalledWith(sourceReader);
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
    mockLoadVisibleProfileLinkGapAnalysis.mockResolvedValue(
      ok({
        analysis,
        hiddenResolvedIssueCount: 0,
      })
    );

    const secondGapRef = buildLinkGapRef({
      txFingerprint: secondGap.txFingerprint,
      assetId: secondGap.assetId,
      direction: secondGap.direction,
    });
    const result = await buildLinksGapsBrowsePresentation(createLinksGapSourceReader(), {
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
    mockLoadVisibleProfileLinkGapAnalysis.mockResolvedValue(
      ok({
        analysis,
        hiddenResolvedIssueCount: 0,
      })
    );

    const result = await buildLinksGapsBrowsePresentation(createLinksGapSourceReader(), {});

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps[0]?.transactionRef).toBe('1234567890');
  });
});
