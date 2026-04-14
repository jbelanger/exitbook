/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Command-boundary tests intentionally mock generic runtime options and completion objects. */
import { ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLoadIssueViewData,
  mockLoadIssuesOverviewData,
  mockOutputIssuesStaticDetail,
  mockOutputIssuesStaticOverview,
  mockRunCliRuntimeCommand,
} = vi.hoisted(() => ({
  mockLoadIssueViewData: vi.fn(),
  mockLoadIssuesOverviewData: vi.fn(),
  mockOutputIssuesStaticDetail: vi.fn(),
  mockOutputIssuesStaticOverview: vi.fn(),
  mockRunCliRuntimeCommand: vi.fn(),
}));

vi.mock('../../../../cli/command.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../cli/command.js')>('../../../../cli/command.js');

  return {
    ...actual,
    runCliRuntimeCommand: mockRunCliRuntimeCommand,
  };
});

vi.mock('../issues-data.js', () => ({
  loadIssueViewData: mockLoadIssueViewData,
  loadIssuesOverviewData: mockLoadIssuesOverviewData,
}));

vi.mock('../../view/issues-static-renderer.js', async () => {
  const actual = await vi.importActual<typeof import('../../view/issues-static-renderer.js')>(
    '../../view/issues-static-renderer.js'
  );

  return {
    ...actual,
    outputIssuesStaticDetail: mockOutputIssuesStaticDetail,
    outputIssuesStaticOverview: mockOutputIssuesStaticOverview,
  };
});

import { runIssuesListCommand, runIssuesViewCommand } from '../issues-browse-command.js';

beforeEach(() => {
  vi.clearAllMocks();

  mockRunCliRuntimeCommand.mockImplementation(async (options) => {
    const preparedResult = await options.prepare();
    if (preparedResult.isErr()) {
      throw preparedResult.error.error;
    }

    const actionResult = await options.action({
      runtime: {
        activeProfileKey: 'default',
        activeProfileSource: 'default',
      },
      prepared: preparedResult.value,
    });
    if (actionResult.isErr()) {
      throw actionResult.error.error;
    }

    if (actionResult.value.output?.kind === 'text') {
      await actionResult.value.output.render();
    }

    return actionResult.value;
  });
});

describe('issues browse command', () => {
  it('passes scoped lenses through the text overview surface', async () => {
    mockLoadIssuesOverviewData.mockResolvedValue(
      ok({
        activeProfileKey: 'default',
        activeProfileSource: 'default',
        issueRecords: [
          {
            issueKey: 'transfer_gap:abc',
            issue: {
              issueRef: '2d4c8e1af3',
              family: 'transfer_gap',
              code: 'LINK_GAP',
              severity: 'blocked',
              status: 'open',
              summary: 'ADA transfer still needs review',
              nextActions: [],
            },
          },
        ],
        profileDisplayName: 'default',
        profileId: 1,
        scopedLenses: [
          {
            scopeKind: 'cost-basis',
            scopeKey: 'profile:1:cost-basis:abcd1234',
            profileId: 1,
            title: 'CA / average-cost / 2024',
            status: 'has-open-issues',
            openIssueCount: 2,
            blockingIssueCount: 1,
            updatedAt: new Date('2026-04-14T13:45:00.000Z'),
          },
        ],
        scope: {
          scopeKind: 'profile',
          scopeKey: 'profile:1',
          profileId: 1,
          title: 'default',
          status: 'has-open-issues',
          openIssueCount: 1,
          blockingIssueCount: 1,
          updatedAt: new Date('2026-04-14T12:00:00.000Z'),
        },
      })
    );

    await runIssuesListCommand('issues-list', {});

    expect(mockOutputIssuesStaticOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        scopedLenses: [
          expect.objectContaining({
            scopeKey: 'profile:1:cost-basis:abcd1234',
            title: 'CA / average-cost / 2024',
          }),
        ],
      })
    );
  });

  it('renders issue detail from the narrowed detail contract', async () => {
    mockLoadIssueViewData.mockResolvedValue(
      ok({
        activeProfileKey: 'default',
        activeProfileSource: 'default',
        profileDisplayName: 'default',
        issue: {
          issueRef: '2d4c8e1af3',
          scope: {
            kind: 'profile',
            key: 'profile:1',
          },
          family: 'transfer_gap',
          code: 'LINK_GAP',
          severity: 'blocked',
          status: 'open',
          summary: 'ADA transfer still needs review',
          details: 'This outflow has no confirmed internal transfer match yet.',
          whyThisMatters: 'Blocks trustworthy transfer accounting for this movement.',
          evidenceRefs: [
            { kind: 'gap', ref: 'c6787f8ae9' },
            { kind: 'transaction', ref: '9c1f37d0ab' },
          ],
          nextActions: [],
        },
      })
    );

    await runIssuesViewCommand('issues-view', '2d4c8e1af3', {});

    expect(mockOutputIssuesStaticDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        profileDisplayName: 'default',
        issue: expect.objectContaining({
          issueRef: '2d4c8e1af3',
          scope: expect.objectContaining({
            key: 'profile:1',
          }),
        }),
      })
    );
  });
});
