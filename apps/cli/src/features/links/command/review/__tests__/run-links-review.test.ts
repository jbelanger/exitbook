import { err, ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import { runLinksReview } from '../run-links-review.js';

function createScope() {
  return {
    handler: {
      executeTyped: vi.fn(),
    },
    refreshProfileIssues: vi.fn(),
    resolveProposalRef: vi.fn(),
  };
}

describe('runLinksReview', () => {
  it('refreshes profile issues after a successful review action', async () => {
    const scope = createScope();
    scope.handler.executeTyped.mockResolvedValue(
      ok({
        affectedLinkCount: 1,
        affectedLinkIds: [42],
        changed: true,
        linkId: 42,
        newStatus: 'confirmed',
        reviewedAt: new Date('2026-04-16T12:00:00.000Z'),
        reviewedBy: 'cli-user',
      })
    );
    scope.refreshProfileIssues.mockResolvedValue(ok(undefined));

    const result = await runLinksReview(scope as never, { linkId: 42 }, 'confirm');

    expect(scope.handler.executeTyped).toHaveBeenCalledWith({ linkId: 42 }, 'confirm');
    expect(scope.refreshProfileIssues).toHaveBeenCalledTimes(1);
    expect(result.isOk()).toBe(true);
  });

  it('skips profile issue refresh for idempotent no-op reviews', async () => {
    const scope = createScope();
    scope.handler.executeTyped.mockResolvedValue(
      ok({
        affectedLinkCount: 0,
        affectedLinkIds: [],
        changed: false,
        linkId: 42,
        newStatus: 'confirmed',
        reviewedAt: new Date('2026-04-16T12:00:00.000Z'),
        reviewedBy: 'cli-user',
      })
    );

    const result = await runLinksReview(scope as never, { linkId: 42 }, 'confirm');

    expect(scope.handler.executeTyped).toHaveBeenCalledWith({ linkId: 42 }, 'confirm');
    expect(scope.refreshProfileIssues).not.toHaveBeenCalled();
    expect(result.isOk()).toBe(true);
  });

  it('does not refresh when the review action fails', async () => {
    const scope = createScope();
    const reviewError = new Error('review failed');
    scope.handler.executeTyped.mockResolvedValue(err(reviewError));

    const result = await runLinksReview(scope as never, { linkId: 99 }, 'reject');

    expect(scope.refreshProfileIssues).not.toHaveBeenCalled();
    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected link review to fail');
    }
    expect(result.error).toBe(reviewError);
  });
});
