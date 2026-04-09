import { ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

const { mockAnalyzeLinkGaps } = vi.hoisted(() => ({
  mockAnalyzeLinkGaps: vi.fn(),
}));

vi.mock('../view/links-gap-analysis.js', () => ({
  analyzeLinkGaps: mockAnalyzeLinkGaps,
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
    mockAnalyzeLinkGaps.mockReturnValue(analysis);

    const result = await buildLinksBrowsePresentation(createLinksBrowseDatabase(), 42, { gaps: true });

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
    mockAnalyzeLinkGaps.mockReturnValue(createMockGapAnalysis());
    const resolvedTransactionFingerprints = new Set(['eth-inflow-2']);

    const result = await buildLinksBrowsePresentation(
      createLinksBrowseDatabase(),
      42,
      { gaps: true },
      undefined,
      resolvedTransactionFingerprints
    );

    expect(result.isOk()).toBe(true);
    expect(mockAnalyzeLinkGaps).toHaveBeenCalledWith([], [], {
      accounts: [],
      excludedAssetIds: undefined,
      resolvedTransactionFingerprints,
    });
  });
});
