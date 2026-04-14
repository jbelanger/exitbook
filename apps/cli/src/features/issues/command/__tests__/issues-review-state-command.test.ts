/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- command-boundary tests intentionally mock runtime and CLI completion plumbing. */
import { ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResolveCurrentIssueData, mockRunCliRuntimeCommand } = vi.hoisted(() => ({
  mockResolveCurrentIssueData: vi.fn(),
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
  resolveCurrentIssueData: mockResolveCurrentIssueData,
}));

import { runIssuesAcknowledgeCommand, runIssuesReopenCommand } from '../issues-review-state-command.js';

beforeEach(() => {
  vi.clearAllMocks();

  mockRunCliRuntimeCommand.mockImplementation(async (options) => {
    const preparedResult = await options.prepare();
    if (preparedResult.isErr()) {
      throw preparedResult.error.error;
    }

    const actionResult = await options.action({
      runtime: {
        database: async () => ({
          accountingIssues: {
            acknowledgeCurrentIssue: vi.fn(async () => ok({ changed: true, found: true })),
            reopenCurrentIssue: vi.fn(async () => ok({ changed: true, found: true })),
          },
        }),
      },
      prepared: preparedResult.value,
    });
    if (actionResult.isErr()) {
      throw actionResult.error.error;
    }

    return actionResult.value;
  });
});

describe('issues review-state command', () => {
  it('acknowledges the resolved current issue and returns updated JSON data', async () => {
    mockResolveCurrentIssueData
      .mockResolvedValueOnce(
        ok({
          activeProfileKey: 'default',
          activeProfileSource: 'default',
          issue: {
            issueRef: '2d4c8e1af3',
            scope: { kind: 'profile', key: 'profile:1' },
            family: 'transfer_gap',
            code: 'LINK_GAP',
            severity: 'blocked',
            reviewState: 'open',
            summary: 'ADA transfer still needs review',
            details: 'details',
            whyThisMatters: 'matters',
            evidenceRefs: [],
            nextActions: [],
          },
          issueKey: 'transfer_gap:abc',
          profileDisplayName: 'default',
          profileId: 1,
          scopeKey: 'profile:1',
        })
      )
      .mockResolvedValueOnce(
        ok({
          activeProfileKey: 'default',
          activeProfileSource: 'default',
          issue: {
            issueRef: '2d4c8e1af3',
            scope: { kind: 'profile', key: 'profile:1' },
            family: 'transfer_gap',
            code: 'LINK_GAP',
            severity: 'blocked',
            reviewState: 'acknowledged',
            summary: 'ADA transfer still needs review',
            details: 'details',
            whyThisMatters: 'matters',
            evidenceRefs: [],
            nextActions: [],
          },
          issueKey: 'transfer_gap:abc',
          profileDisplayName: 'default',
          profileId: 1,
          scopeKey: 'profile:1',
        })
      );

    const result = (await runIssuesAcknowledgeCommand('2d4c8e1af3', { json: true })) as {
      output?: { data: unknown; kind: string; };
    };

    expect(result.output?.kind).toBe('json');
    expect(result.output?.data).toMatchObject({
      action: 'acknowledge',
      changed: true,
      issueRef: '2d4c8e1af3',
      reviewState: 'acknowledged',
      scopeKey: 'profile:1',
    });
  });

  it('reopens the resolved acknowledgement and returns updated JSON data', async () => {
    mockResolveCurrentIssueData
      .mockResolvedValueOnce(
        ok({
          activeProfileKey: 'default',
          activeProfileSource: 'default',
          issue: {
            issueRef: '2d4c8e1af3',
            scope: { kind: 'profile', key: 'profile:1' },
            family: 'transfer_gap',
            code: 'LINK_GAP',
            severity: 'blocked',
            reviewState: 'acknowledged',
            summary: 'ADA transfer still needs review',
            details: 'details',
            whyThisMatters: 'matters',
            evidenceRefs: [],
            nextActions: [],
          },
          issueKey: 'transfer_gap:abc',
          profileDisplayName: 'default',
          profileId: 1,
          scopeKey: 'profile:1',
        })
      )
      .mockResolvedValueOnce(
        ok({
          activeProfileKey: 'default',
          activeProfileSource: 'default',
          issue: {
            issueRef: '2d4c8e1af3',
            scope: { kind: 'profile', key: 'profile:1' },
            family: 'transfer_gap',
            code: 'LINK_GAP',
            severity: 'blocked',
            reviewState: 'open',
            summary: 'ADA transfer still needs review',
            details: 'details',
            whyThisMatters: 'matters',
            evidenceRefs: [],
            nextActions: [],
          },
          issueKey: 'transfer_gap:abc',
          profileDisplayName: 'default',
          profileId: 1,
          scopeKey: 'profile:1',
        })
      );

    const result = (await runIssuesReopenCommand('2d4c8e1af3', { json: true })) as {
      output?: { data: unknown; kind: string; };
    };

    expect(result.output?.kind).toBe('json');
    expect(result.output?.data).toMatchObject({
      action: 'reopen',
      changed: true,
      issueRef: '2d4c8e1af3',
      reviewState: 'open',
      scopeKey: 'profile:1',
    });
  });
});
