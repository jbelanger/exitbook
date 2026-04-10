import { ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

const { mockAnalyzeLinkGaps } = vi.hoisted(() => ({
  mockAnalyzeLinkGaps: vi.fn(),
}));

vi.mock('../links-gap-analysis-support.js', () => ({
  loadLinksGapAnalysis: mockAnalyzeLinkGaps,
}));

import { createMockGapAnalysis } from '../../__tests__/test-utils.js';
import { buildLinksBrowsePresentation } from '../links-browse-support.js';

type LinksBrowseDatabase = Parameters<typeof buildLinksBrowsePresentation>[0];

function createLinksBrowseDatabase(): LinksBrowseDatabase {
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
  } as unknown as LinksBrowseDatabase;
}

describe('links-browse-support', () => {
  it('orders gap browsing data chronologically', async () => {
    const analysis = createMockGapAnalysis();
    analysis.issues = [analysis.issues[2]!, analysis.issues[0]!, analysis.issues[1]!];
    mockAnalyzeLinkGaps.mockResolvedValue(ok(analysis));
    const database = createLinksBrowseDatabase();

    const result = await buildLinksBrowsePresentation(database, 42, { gaps: true });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    const presentation = result.value;
    expect(presentation.mode).toBe('gaps');
    if (presentation.mode !== 'gaps') {
      throw new Error('Expected gaps browse presentation');
    }

    expect(presentation.gaps.map((gap) => gap.issue.txFingerprint)).toEqual([
      'eth-inflow-1',
      'eth-inflow-2',
      'kraken-outflow-1',
    ]);
    expect(presentation.state.linkAnalysis.issues.map((issue) => issue.txFingerprint)).toEqual([
      'eth-inflow-1',
      'eth-inflow-2',
      'kraken-outflow-1',
    ]);
  });

  it('passes resolved transaction fingerprints into gap analysis', async () => {
    mockAnalyzeLinkGaps.mockResolvedValue(ok(createMockGapAnalysis()));
    const resolvedTransactionFingerprints = new Set(['eth-inflow-2']);
    const database = createLinksBrowseDatabase();

    const result = await buildLinksBrowsePresentation(
      database,
      42,
      { gaps: true },
      undefined,
      resolvedTransactionFingerprints
    );

    expect(result.isOk()).toBe(true);
    expect(mockAnalyzeLinkGaps).toHaveBeenCalledWith(database, 42, {
      excludedAssetIds: undefined,
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
    mockAnalyzeLinkGaps.mockResolvedValue(ok(analysis));

    const result = await buildLinksBrowsePresentation(createLinksBrowseDatabase(), 42, {
      gaps: true,
      selector: 'eth-inflow-1',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.mode).toBe('gaps');
    if (result.value.mode !== 'gaps') {
      throw new Error('Expected gaps browse presentation');
    }

    expect(result.value.selectedGap?.issue.txFingerprint).toBe('eth-inflow-1');
    expect(result.value.selectedGap?.transactionGapCount).toBe(2);
  });
});
