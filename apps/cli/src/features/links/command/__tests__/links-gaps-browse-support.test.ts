import { ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

const { mockLoadLinksGapAnalysis } = vi.hoisted(() => ({
  mockLoadLinksGapAnalysis: vi.fn(),
}));

vi.mock('../links-gap-analysis-support.js', () => ({
  loadLinksGapAnalysis: mockLoadLinksGapAnalysis,
}));

import { createMockGapAnalysis } from '../../__tests__/test-utils.js';
import { buildLinksGapsBrowsePresentation } from '../links-gaps-browse-support.js';

type LinksGapsBrowseDatabase = Parameters<typeof buildLinksGapsBrowsePresentation>[0];

function createLinksGapsBrowseDatabase(): LinksGapsBrowseDatabase {
  return {
    accounts: {
      findAll: vi.fn().mockResolvedValue(ok([])),
    },
    transactionLinks: {
      findAll: vi.fn().mockResolvedValue(ok([])),
    },
    transactions: {
      findAll: vi.fn().mockResolvedValue(ok([])),
    },
  } as unknown as LinksGapsBrowseDatabase;
}

describe('links-gaps-browse-support', () => {
  it('orders gap browsing data chronologically', async () => {
    const analysis = createMockGapAnalysis();
    analysis.issues = [analysis.issues[2]!, analysis.issues[0]!, analysis.issues[1]!];
    mockLoadLinksGapAnalysis.mockResolvedValue(
      ok({
        analysis,
        hiddenResolvedIssueCount: 0,
        hiddenResolvedTransactionCount: 0,
      })
    );

    const result = await buildLinksGapsBrowsePresentation(createLinksGapsBrowseDatabase(), 42, {});

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

  it('passes resolved transaction fingerprints into gap analysis loading', async () => {
    mockLoadLinksGapAnalysis.mockResolvedValue(
      ok({
        analysis: createMockGapAnalysis(),
        hiddenResolvedIssueCount: 1,
        hiddenResolvedTransactionCount: 1,
      })
    );
    const resolvedTransactionFingerprints = new Set(['eth-inflow-2']);
    const excludedAssetIds = new Set(['test:eth']);
    const database = createLinksGapsBrowseDatabase();

    const result = await buildLinksGapsBrowsePresentation(
      database,
      42,
      {},
      excludedAssetIds,
      resolvedTransactionFingerprints
    );

    expect(result.isOk()).toBe(true);
    expect(mockLoadLinksGapAnalysis).toHaveBeenCalledWith(database, 42, {
      excludedAssetIds,
      resolvedTransactionFingerprints,
    });
  });

  it('treats duplicate gap rows on the same transaction as one selector target', async () => {
    const analysis = createMockGapAnalysis();
    analysis.issues = [
      analysis.issues[0]!,
      {
        ...analysis.issues[0]!,
        assetSymbol: 'USDC',
        missingAmount: '25',
        totalAmount: '25',
      },
      analysis.issues[1]!,
    ];
    mockLoadLinksGapAnalysis.mockResolvedValue(
      ok({
        analysis,
        hiddenResolvedIssueCount: 0,
        hiddenResolvedTransactionCount: 0,
      })
    );

    const result = await buildLinksGapsBrowsePresentation(createLinksGapsBrowseDatabase(), 42, {
      selector: 'eth-inflow-1',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.selectedGap?.gapIssue.txFingerprint).toBe('eth-inflow-1');
    expect(result.value.selectedGap?.transactionGapCount).toBe(2);
  });

  it('formats gap transaction refs with the transaction ref formatter', async () => {
    const analysis = createMockGapAnalysis();
    analysis.issues = [
      {
        ...analysis.issues[0]!,
        txFingerprint: '1234567890abcdef-gap',
      },
    ];
    mockLoadLinksGapAnalysis.mockResolvedValue(
      ok({
        analysis,
        hiddenResolvedIssueCount: 0,
        hiddenResolvedTransactionCount: 0,
      })
    );

    const result = await buildLinksGapsBrowsePresentation(createLinksGapsBrowseDatabase(), 42, {});

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.gaps[0]?.transactionRef).toBe('1234567890');
  });
});
