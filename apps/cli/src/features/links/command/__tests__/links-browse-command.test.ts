import { ok } from '@exitbook/foundation';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildLinksBrowsePresentation,
  mockCollapseEmptyExplorerToStatic,
  mockHasNavigableLinksBrowseItems,
  mockOverrideStoreConstructor,
  mockRefreshProfileAccountingIssueProjection,
  mockRenderApp,
  mockResolveCommandProfile,
  mockRunLinksReview,
} = vi.hoisted(() => ({
  mockBuildLinksBrowsePresentation: vi.fn(),
  mockCollapseEmptyExplorerToStatic: vi.fn(),
  mockHasNavigableLinksBrowseItems: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockRefreshProfileAccountingIssueProjection: vi.fn(),
  mockRenderApp: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunLinksReview: vi.fn(),
}));

vi.mock('@exitbook/data/accounting', () => ({
  refreshProfileAccountingIssueProjection: mockRefreshProfileAccountingIssueProjection,
}));

vi.mock('@exitbook/data/overrides', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return { tag: 'override-store' };
  }),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: mockRenderApp,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../links-browse-support.js', () => ({
  buildLinksBrowsePresentation: mockBuildLinksBrowsePresentation,
}));

vi.mock('../links-browse-output.js', () => ({
  buildLinksBrowseCompletion: vi.fn(),
  hasNavigableLinksBrowseItems: mockHasNavigableLinksBrowseItems,
}));

vi.mock('../review/run-links-review.js', () => ({
  runLinksReview: mockRunLinksReview,
}));

vi.mock('../../view/index.js', () => ({
  LinksViewApp: 'LinksViewApp',
}));

vi.mock('../../../../cli/presentation.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../cli/presentation.js')>(
    '../../../../cli/presentation.js'
  );

  return {
    ...actual,
    collapseEmptyExplorerToStatic: mockCollapseEmptyExplorerToStatic,
  };
});

import { executePreparedLinksBrowseCommand } from '../links-browse-command.js';

describe('links-browse-command interactive review', () => {
  let capturedElement: ReactElement | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedElement = undefined;
    mockResolveCommandProfile.mockResolvedValue(
      ok({
        id: 1,
        profileKey: 'default',
        displayName: 'default',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      })
    );
    mockBuildLinksBrowsePresentation.mockResolvedValue(
      ok({
        mode: 'links',
        proposals: [],
        state: { mode: 'links' },
      })
    );
    mockHasNavigableLinksBrowseItems.mockReturnValue(true);
    mockCollapseEmptyExplorerToStatic.mockReturnValue({ mode: 'tui' });
    mockRunLinksReview.mockResolvedValue(
      ok({
        affectedLinkCount: 1,
        affectedLinkIds: [123],
        linkId: 123,
        newStatus: 'confirmed',
        reviewedAt: new Date('2026-04-16T17:00:00.000Z'),
        reviewedBy: 'cli-user',
      })
    );
    mockRefreshProfileAccountingIssueProjection.mockResolvedValue(ok(undefined));
    mockRenderApp.mockImplementation(async (renderFn: (unmount: () => void) => ReactElement) => {
      capturedElement = renderFn(() => undefined);
    });
  });

  it('routes explorer confirm/reject actions through the shared review flow and profile issue refresh seam', async () => {
    const runtime = {
      closeDatabase: vi.fn().mockResolvedValue(undefined),
      dataDir: '/tmp/exitbook-links',
      database: vi.fn().mockResolvedValue({ tag: 'db' }),
    };

    const result = await executePreparedLinksBrowseCommand(runtime as never, {
      params: {},
      presentation: { mode: 'tui' } as never,
    });

    expect(result.isOk()).toBe(true);
    expect(mockOverrideStoreConstructor).toHaveBeenCalledWith('/tmp/exitbook-links');
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(capturedElement).toBeDefined();

    const onAction = (
      capturedElement as ReactElement<{ onAction: (linkId: number, action: 'confirm' | 'reject') => Promise<unknown> }>
    ).props.onAction;

    const actionResult = await onAction(123, 'confirm');

    const reviewScope = mockRunLinksReview.mock.calls[0]?.[0] as {
      handler: object;
      refreshProfileIssues: () => Promise<unknown>;
    };
    expect(mockRunLinksReview).toHaveBeenCalledWith(reviewScope, { linkId: 123 }, 'confirm');
    expect(reviewScope.handler).toBeInstanceOf(Object);
    expect(reviewScope.refreshProfileIssues).toBeInstanceOf(Function);
    await reviewScope.refreshProfileIssues();

    expect(mockRefreshProfileAccountingIssueProjection).toHaveBeenCalledWith({ tag: 'db' }, '/tmp/exitbook-links', {
      displayName: 'default',
      profileId: 1,
      profileKey: 'default',
    });
    expect((actionResult as { isOk(): boolean }).isOk()).toBe(true);
    if ((actionResult as { isErr(): boolean }).isErr()) {
      throw (actionResult as { error: Error }).error;
    }
    expect((actionResult as { value: unknown }).value).toEqual({
      affectedLinkIds: [123],
      newStatus: 'confirmed',
    });
  });
});
