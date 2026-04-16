import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuildCostBasisIssueNoticeSummaries } = vi.hoisted(() => ({
  mockBuildCostBasisIssueNoticeSummaries: vi.fn(),
}));

vi.mock('@exitbook/accounting/cost-basis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/accounting/cost-basis')>();
  return {
    ...actual,
    buildCostBasisIssueNoticeSummaries: mockBuildCostBasisIssueNoticeSummaries,
  };
});

import { buildCostBasisIssueNotices } from '../cost-basis-issue-notices.js';

describe('buildCostBasisIssueNotices', () => {
  const scopeConfig = {
    currency: 'USD' as const,
    endDate: new Date('2024-12-31T23:59:59.999Z'),
    jurisdiction: 'US' as const,
    method: 'fifo' as const,
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    taxYear: 2024,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildCostBasisIssueNoticeSummaries.mockReturnValue(ok([]));
  });

  it('returns no notices when the scoped issue surface is clear', () => {
    const result = buildCostBasisIssueNotices({
      artifact: { tag: 'artifact' } as never,
      assetReviewSummaries: new Map(),
      scopeConfig,
      scopeKey: 'scope-1',
      snapshotId: 'snapshot-1',
      sourceContext: { tag: 'source-context' } as never,
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value : []).toEqual([]);
  });

  it('maps blocking issues ahead of warnings and routes review back to the exact issues scope', () => {
    mockBuildCostBasisIssueNoticeSummaries.mockReturnValue(
      ok([
        { count: 2, kind: 'blocking_issues', severity: 'blocked' },
        { count: 1, kind: 'warning_issues', severity: 'warning' },
      ])
    );

    const result = buildCostBasisIssueNotices({
      artifact: { tag: 'artifact' } as never,
      assetReviewSummaries: new Map(),
      scopeConfig,
      scopeKey: 'scope-1',
      snapshotId: 'snapshot-1',
      sourceContext: { tag: 'source-context' } as never,
    });

    expect(result.isOk()).toBe(true);
    expect(result.isOk() ? result.value : []).toEqual([
      {
        count: 2,
        kind: 'blocking_issues',
        message: '2 blocking issues in this scope. Review them in issues.',
        reviewCommand:
          'exitbook issues cost-basis --jurisdiction US --tax-year 2024 --method fifo --fiat-currency USD --start-date 2024-01-01T00:00:00.000Z --end-date 2024-12-31T23:59:59.999Z',
        severity: 'blocked',
      },
      {
        count: 1,
        kind: 'warning_issues',
        message: '1 warning issue in this scope. Review it in issues.',
        reviewCommand:
          'exitbook issues cost-basis --jurisdiction US --tax-year 2024 --method fifo --fiat-currency USD --start-date 2024-01-01T00:00:00.000Z --end-date 2024-12-31T23:59:59.999Z',
        severity: 'warning',
      },
    ]);
  });

  it('propagates accounting-side summary failures', () => {
    mockBuildCostBasisIssueNoticeSummaries.mockReturnValue(err(new Error('summary failure')));

    const result = buildCostBasisIssueNotices({
      artifact: { tag: 'artifact' } as never,
      assetReviewSummaries: new Map(),
      scopeConfig,
      scopeKey: 'scope-1',
      snapshotId: 'snapshot-1',
      sourceContext: { tag: 'source-context' } as never,
    });

    expect(result.isErr()).toBe(true);
    expect(result.isErr() ? result.error.message : '').toContain('summary failure');
  });
});
