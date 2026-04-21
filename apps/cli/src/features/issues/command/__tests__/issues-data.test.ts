import * as accountingIssuesModule from '@exitbook/accounting/issues';
import type {
  AccountingIssueDetailItem,
  AccountingIssueScopeSummary,
  AccountingIssueSummaryItem,
} from '@exitbook/accounting/issues';
import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildProfileAccountingIssueSourceReader,
  mockEnsureAssetReviewReady,
  mockEnsureLinksReady,
  mockEnsureProcessedTransactionsReady,
  mockResolveCommandProfile,
} = vi.hoisted(() => ({
  mockBuildProfileAccountingIssueSourceReader: vi.fn(),
  mockEnsureAssetReviewReady: vi.fn(),
  mockEnsureLinksReady: vi.fn(),
  mockEnsureProcessedTransactionsReady: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
}));

vi.mock('../../../../runtime/projection-readiness.js', () => ({
  ensureAssetReviewReady: mockEnsureAssetReviewReady,
  ensureLinksReady: mockEnsureLinksReady,
  ensureProcessedTransactionsReady: mockEnsureProcessedTransactionsReady,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('@exitbook/data/accounting', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/data/accounting')>('@exitbook/data/accounting');

  return {
    ...actual,
    buildProfileAccountingIssueSourceReader: mockBuildProfileAccountingIssueSourceReader,
  };
});

import { ExitCodes } from '../../../../cli/exit-codes.js';
import { buildIssueSelector } from '../../issue-selector.js';
import { loadIssueViewData, loadIssuesOverviewData, resolveCurrentIssueData } from '../issues-data.js';

interface FakeAccountingIssuesDb {
  reconcileScope: ReturnType<typeof vi.fn>;
  findScope: ReturnType<typeof vi.fn>;
  listCurrentIssueSummaries: ReturnType<typeof vi.fn>;
  listCurrentIssueSummariesForProfile: ReturnType<typeof vi.fn>;
  listScopeSummaries: ReturnType<typeof vi.fn>;
  findCurrentIssueDetail: ReturnType<typeof vi.fn>;
}

interface FakeIssuesRuntime {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
  dataDir: string;
  openDatabaseSession: ReturnType<typeof vi.fn>;
}

const profile = {
  id: 1,
  profileKey: 'default',
  displayName: 'Default',
} as const;

const profileScope: AccountingIssueScopeSummary = {
  scopeKind: 'profile',
  scopeKey: 'profile:1',
  profileId: 1,
  title: 'Default',
  status: 'has-open-issues',
  openIssueCount: 1,
  blockingIssueCount: 1,
  updatedAt: new Date('2026-04-20T10:00:00.000Z'),
};

const costBasisScope: AccountingIssueScopeSummary = {
  scopeKind: 'cost-basis',
  scopeKey: 'profile:1:cost-basis:ca-average-2024',
  profileId: 1,
  title: 'CA / average-cost / 2024',
  status: 'has-open-issues',
  openIssueCount: 2,
  blockingIssueCount: 1,
  updatedAt: new Date('2026-04-20T10:05:00.000Z'),
};

const issueSummary: AccountingIssueSummaryItem = {
  issueRef: '2d4c8e1af3',
  family: 'transfer_gap',
  code: 'LINK_GAP',
  severity: 'blocked',
  summary: 'ADA transfer still needs review',
  nextActions: [],
};

const issueDetail: AccountingIssueDetailItem = {
  issueRef: '2d4c8e1af3',
  scope: {
    kind: 'profile',
    key: profileScope.scopeKey,
  },
  family: 'transfer_gap',
  code: 'LINK_GAP',
  severity: 'blocked',
  summary: 'ADA transfer still needs review',
  details: 'This outflow has no confirmed internal transfer match yet.',
  whyThisMatters: 'Blocks trustworthy transfer accounting for this movement.',
  evidenceRefs: [
    { kind: 'gap', ref: 'gap-ref-1' },
    { kind: 'transaction', ref: 'tx-ref-1' },
  ],
  nextActions: [],
};

function createAccountingIssuesDb(): FakeAccountingIssuesDb {
  return {
    reconcileScope: vi.fn().mockResolvedValue(ok(undefined)),
    findScope: vi.fn().mockResolvedValue(ok(profileScope)),
    listCurrentIssueSummaries: vi.fn().mockResolvedValue(ok([{ issueKey: 'transfer_gap:ada', issue: issueSummary }])),
    listCurrentIssueSummariesForProfile: vi
      .fn()
      .mockResolvedValue(ok([{ scopeKey: profileScope.scopeKey, issueKey: 'transfer_gap:ada' }])),
    listScopeSummaries: vi.fn().mockResolvedValue(ok([profileScope, costBasisScope])),
    findCurrentIssueDetail: vi.fn().mockResolvedValue(ok({ issueKey: 'transfer_gap:ada', issue: issueDetail })),
  };
}

function createRuntime(accountingIssues: FakeAccountingIssuesDb) {
  return {
    activeProfileKey: 'default',
    activeProfileSource: 'state',
    dataDir: '/tmp/exitbook-test',
    openDatabaseSession: vi.fn().mockResolvedValue({
      accountingIssues,
    }),
  } satisfies FakeIssuesRuntime;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockResolveCommandProfile.mockResolvedValue(ok(profile));
  mockEnsureProcessedTransactionsReady.mockResolvedValue(ok(undefined));
  mockEnsureAssetReviewReady.mockResolvedValue(ok(undefined));
  mockEnsureLinksReady.mockResolvedValue(ok(undefined));
  mockBuildProfileAccountingIssueSourceReader.mockReturnValue({ reader: 'profile-issues' });
});

describe('loadIssuesOverviewData', () => {
  it('returns current-profile issue data plus cost-basis scoped lenses', async () => {
    const accountingIssues = createAccountingIssuesDb();
    const runtime = createRuntime(accountingIssues);
    const snapshot = {
      scope: {
        scopeKey: profileScope.scopeKey,
      },
    } as never;

    const materializeProfileSnapshotSpy = vi
      .spyOn(accountingIssuesModule, 'materializeProfileAccountingIssueScopeSnapshot')
      .mockResolvedValue(ok(snapshot) as never);

    const result = await loadIssuesOverviewData(runtime as never, 'text');

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(runtime.openDatabaseSession).toHaveBeenCalledOnce();
    expect(accountingIssues.reconcileScope).toHaveBeenCalledWith(snapshot);
    expect(accountingIssues.listScopeSummaries).toHaveBeenCalledWith(profile.id);
    expect(result.value).toEqual(
      expect.objectContaining({
        activeProfileKey: 'default',
        activeProfileSource: 'state',
        profileDisplayName: 'Default',
        profileId: 1,
        issueRecords: [{ issueKey: 'transfer_gap:ada', issue: issueSummary }],
        scope: profileScope,
        scopedLenses: [costBasisScope],
      })
    );
    expect(materializeProfileSnapshotSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 1,
        scopeKey: profileScope.scopeKey,
        title: 'Default',
      })
    );
  });

  it('wraps readiness failures before any issue materialization work begins', async () => {
    const accountingIssues = createAccountingIssuesDb();
    const runtime = createRuntime(accountingIssues);
    mockEnsureProcessedTransactionsReady.mockResolvedValue(err(new Error('processed transactions unavailable')));

    const result = await loadIssuesOverviewData(runtime as never, 'text');

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.exitCode).toBe(ExitCodes.GENERAL_ERROR);
    expect(result.error.error.message).toBe('processed transactions unavailable');
    expect(accountingIssues.reconcileScope).not.toHaveBeenCalled();
  });
});

describe('resolveCurrentIssueData', () => {
  it('builds selectors from current summaries and loads the matching issue detail', async () => {
    const accountingIssues = createAccountingIssuesDb();
    const runtime = createRuntime(accountingIssues);
    const snapshot = {
      scope: {
        scopeKey: profileScope.scopeKey,
      },
    } as never;

    vi.spyOn(accountingIssuesModule, 'materializeProfileAccountingIssueScopeSnapshot').mockResolvedValue(
      ok(snapshot) as never
    );

    const selector = buildIssueSelector(profileScope.scopeKey, 'transfer_gap:ada');
    const result = await resolveCurrentIssueData(runtime as never, 'text', selector.slice(0, 12));

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(accountingIssues.listCurrentIssueSummariesForProfile).toHaveBeenCalledWith(profile.id);
    expect(accountingIssues.findCurrentIssueDetail).toHaveBeenCalledWith(profileScope.scopeKey, 'transfer_gap:ada');
    expect(result.value).toEqual(
      expect.objectContaining({
        activeProfileKey: 'default',
        activeProfileSource: 'state',
        profileDisplayName: 'Default',
        profileId: 1,
        scopeKey: profileScope.scopeKey,
        issueKey: 'transfer_gap:ada',
        issue: issueDetail,
      })
    );
  });

  it('projects resolved current issue data down to the view contract', async () => {
    const accountingIssues = createAccountingIssuesDb();
    const runtime = createRuntime(accountingIssues);
    const snapshot = {
      scope: {
        scopeKey: profileScope.scopeKey,
      },
    } as never;

    vi.spyOn(accountingIssuesModule, 'materializeProfileAccountingIssueScopeSnapshot').mockResolvedValue(
      ok(snapshot) as never
    );

    const selector = buildIssueSelector(profileScope.scopeKey, 'transfer_gap:ada');
    const result = await loadIssueViewData(runtime as never, 'json', selector);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      activeProfileKey: 'default',
      activeProfileSource: 'state',
      profileDisplayName: 'Default',
      issue: issueDetail,
    });
  });
});
