import {
  buildCostBasisAccountingIssueScopeSnapshot,
  buildCostBasisExecutionFailureScopeSnapshot,
  buildProfileAccountingIssueScopeSnapshot,
} from '@exitbook/accounting/issues';
import type { LedgerLinkingGapIssue } from '@exitbook/accounting/ledger-linking';
import type { LinkGapIssue } from '@exitbook/accounting/linking';
import type { AssetReviewSummary } from '@exitbook/core';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { AccountingIssueRepository } from '../accounting-issue-repository.js';

import { seedProfile } from './helpers.js';

const PROFILE_ID = 1;
const UPDATED_AT = new Date('2026-04-14T12:00:00.000Z');

function createLinkGapIssue(overrides: Partial<LinkGapIssue> = {}): LinkGapIssue {
  return {
    transactionId: 101,
    txFingerprint: 'tx-fingerprint-101',
    platformKey: 'ethereum',
    blockchainName: 'ethereum',
    timestamp: '2026-04-14T12:00:00.000Z',
    assetId: 'blockchain:ethereum:native',
    assetSymbol: 'ETH',
    missingAmount: '1.25',
    totalAmount: '5',
    confirmedCoveragePercent: '75',
    operationGroup: 'transfer',
    operationLabel: 'transfer/withdrawal',
    suggestedCount: 2,
    highestSuggestedConfidencePercent: '95',
    direction: 'outflow',
    ...overrides,
  };
}

function createAssetReviewSummary(overrides: Partial<AssetReviewSummary> = {}): AssetReviewSummary {
  return {
    assetId: 'blockchain:ethereum:0xscam',
    reviewStatus: 'needs-review',
    referenceStatus: 'unknown',
    evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
    confirmationIsStale: false,
    accountingBlocked: true,
    warningSummary: 'Suspicious asset evidence requires review',
    evidence: [
      {
        kind: 'scam-diagnostic',
        severity: 'error',
        message: 'Known scam evidence',
      },
    ],
    ...overrides,
  };
}

function createLedgerLinkingGapIssue(overrides: Partial<LedgerLinkingGapIssue> = {}): LedgerLinkingGapIssue {
  return {
    activityDatetime: new Date('2026-04-23T12:00:00.000Z'),
    assetId: 'blockchain:ethereum:native',
    assetSymbol: 'ETH' as LedgerLinkingGapIssue['assetSymbol'],
    candidateId: 17,
    classifications: ['exchange_transfer_missing_hash'],
    claimedAmount: '0',
    direction: 'source',
    gapReason: 'exchange_transfer_missing_hash',
    journalFingerprint: 'ledger_journal:v1:17',
    originalAmount: '1.25',
    ownerAccountId: 1,
    platformKey: 'kraken',
    platformKind: 'exchange',
    postingFingerprint: 'ledger_posting:v1:17',
    remainingAmount: '1.25',
    sourceActivityFingerprint: 'source_activity:v1:17',
    ...overrides,
  };
}

function createSnapshot(input?: {
  assetReviewSummaries?: readonly AssetReviewSummary[] | undefined;
  ledgerLinkingGapIssues?: readonly LedgerLinkingGapIssue[] | undefined;
  linkGapIssues?: readonly LinkGapIssue[] | undefined;
  updatedAt?: Date | undefined;
}) {
  return buildProfileAccountingIssueScopeSnapshot({
    profileId: PROFILE_ID,
    scopeKey: 'profile:1',
    title: 'default',
    assetReviewSummaries: input?.assetReviewSummaries ?? [createAssetReviewSummary()],
    ledgerLinkingGapIssues: input?.ledgerLinkingGapIssues,
    linkGapIssues: input?.linkGapIssues ?? [createLinkGapIssue()],
    updatedAt: input?.updatedAt ?? UPDATED_AT,
  });
}

function createCostBasisSnapshot() {
  return buildCostBasisAccountingIssueScopeSnapshot({
    profileId: PROFILE_ID,
    config: {
      jurisdiction: 'CA',
      taxYear: 2024,
      method: 'average-cost',
      currency: 'CAD',
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      endDate: new Date('2024-12-31T23:59:59.999Z'),
    },
    scope: {
      config: {
        jurisdiction: 'CA',
        taxYear: 2024,
        method: 'average-cost',
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
      filingScope: 'full_tax_year',
      requiredStartDate: new Date('2024-01-01T00:00:00.000Z'),
      requiredEndDate: new Date('2024-12-31T23:59:59.999Z'),
    },
    readiness: {
      status: 'blocked',
      issues: [
        {
          code: 'MISSING_PRICE_DATA',
          severity: 'blocked',
          summary: 'Required transaction price data is missing.',
          details: 'Tax package export is blocked because retained transactions are missing required price data.',
          recommendedAction: 'Enrich or set the missing prices, then rerun the package export.',
        },
      ],
      warnings: [],
      blockingIssues: [
        {
          code: 'MISSING_PRICE_DATA',
          severity: 'blocked',
          summary: 'Required transaction price data is missing.',
          details: 'Tax package export is blocked because retained transactions are missing required price data.',
          recommendedAction: 'Enrich or set the missing prices, then rerun the package export.',
        },
      ],
    },
    readinessMetadata: {},
    updatedAt: new Date('2026-04-14T12:30:00.000Z'),
  });
}

function createCostBasisExecutionFailureSnapshot() {
  return buildCostBasisExecutionFailureScopeSnapshot({
    config: {
      jurisdiction: 'CA',
      taxYear: 2024,
      method: 'average-cost',
      currency: 'CAD',
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      endDate: new Date('2024-12-31T23:59:59.999Z'),
    },
    error: new Error('workflow exploded'),
    profileId: PROFILE_ID,
    scope: {
      config: {
        jurisdiction: 'CA',
        taxYear: 2024,
        method: 'average-cost',
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
      filingScope: 'full_tax_year',
      requiredStartDate: new Date('2024-01-01T00:00:00.000Z'),
      requiredEndDate: new Date('2024-12-31T23:59:59.999Z'),
    },
    stage: 'cost-basis-workflow.execute',
    updatedAt: new Date('2026-04-16T12:30:00.000Z'),
  });
}

describe('AccountingIssueRepository', () => {
  let db: KyselyDB;
  let repo: AccountingIssueRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    await seedProfile(db);
    repo = new AccountingIssueRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('reconciles a profile scope and reloads current summaries and detail', async () => {
    const snapshot = createSnapshot();

    assertOk(await repo.reconcileScope(snapshot));

    const scopes = assertOk(await repo.listScopeSummaries(PROFILE_ID));
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatchObject({
      scopeKind: 'profile',
      scopeKey: 'profile:1',
      status: 'has-open-issues',
      openIssueCount: 2,
      blockingIssueCount: 2,
    });

    const summaries = assertOk(await repo.listCurrentIssueSummaries('profile:1'));
    expect(summaries).toHaveLength(2);
    expect(summaries.map((record) => record.issue.family)).toEqual(['asset_review_required', 'transfer_gap']);
    expect(summaries[0]?.issue.issueRef).toHaveLength(10);

    const transferGap = summaries.find((record) => record.issue.family === 'transfer_gap');
    expect(transferGap).toBeDefined();

    const detail = assertOk(await repo.findCurrentIssueDetail('profile:1', transferGap!.issueKey));
    expect(detail).toBeDefined();
    expect(detail?.issue).toMatchObject({
      issueRef: transferGap?.issue.issueRef,
      family: 'transfer_gap',
      scope: {
        kind: 'profile',
        key: 'profile:1',
      },
      whyThisMatters: 'Blocks trustworthy transfer accounting for this movement.',
    });
    expect(detail?.issue.evidenceRefs[0]?.kind).toBe('gap');
    const firstEvidence = detail?.issue.evidenceRefs[0];
    expect(firstEvidence?.kind).toBe('gap');
    if (firstEvidence?.kind === 'gap') {
      expect(typeof firstEvidence.ref).toBe('string');
    }
    expect(detail?.issue.evidenceRefs[1]).toEqual({
      kind: 'transaction',
      ref: 'tx-fingerp',
    });
  });

  it('closes disappeared rows and preserves current rows across reconciliation', async () => {
    const firstSnapshot = createSnapshot();
    assertOk(await repo.reconcileScope(firstSnapshot));

    const originalTransferGap = assertOk(await repo.listCurrentIssueSummaries('profile:1')).find(
      (record) => record.issue.family === 'transfer_gap'
    );
    expect(originalTransferGap).toBeDefined();

    const secondSnapshot = createSnapshot({
      assetReviewSummaries: [
        createAssetReviewSummary({ accountingBlocked: false, evidence: [], reviewStatus: 'clear' }),
      ],
      linkGapIssues: [
        createLinkGapIssue({
          missingAmount: '0.5',
          txFingerprint: 'tx-fingerprint-202',
        }),
      ],
      updatedAt: new Date('2026-04-14T13:00:00.000Z'),
    });

    assertOk(await repo.reconcileScope(secondSnapshot));

    const currentSummaries = assertOk(await repo.listCurrentIssueSummaries('profile:1'));
    expect(currentSummaries).toHaveLength(1);
    expect(currentSummaries[0]?.issue.family).toBe('transfer_gap');
    expect(currentSummaries[0]?.issue.summary).toContain('ETH outflow still needs transfer review');

    const allRows = await db
      .selectFrom('accounting_issue_rows')
      .select(['issue_key', 'status', 'closed_reason', 'closed_at'])
      .where('scope_key', '=', 'profile:1')
      .orderBy('issue_key', 'asc')
      .execute();

    expect(allRows).toHaveLength(3);
    expect(allRows.filter((row) => row.status === 'open')).toHaveLength(1);
    expect(allRows.filter((row) => row.status === 'closed')).toHaveLength(2);
    expect(allRows.find((row) => row.issue_key === originalTransferGap?.issueKey)).toMatchObject({
      status: 'closed',
      closed_reason: 'disappeared',
    });

    const scope = assertOk(await repo.findScope('profile:1'));
    expect(scope).toMatchObject({
      openIssueCount: 1,
      blockingIssueCount: 1,
      status: 'has-open-issues',
    });
  });

  it('persists and reloads ledger-linking-v2 transfer gap evidence', async () => {
    const snapshot = createSnapshot({
      assetReviewSummaries: [],
      ledgerLinkingGapIssues: [createLedgerLinkingGapIssue()],
      linkGapIssues: [],
    });

    assertOk(await repo.reconcileScope(snapshot));

    const summaries = assertOk(await repo.listCurrentIssueSummaries('profile:1'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.issue.summary).toBe('ETH outflow remains unresolved in links-v2');

    const detail = assertOk(await repo.findCurrentIssueDetail('profile:1', summaries[0]!.issueKey));
    expect(detail?.issue.evidenceRefs).toContainEqual({
      kind: 'ledger_posting',
      journalFingerprint: 'ledger_journal:v1:17',
      postingFingerprint: 'ledger_posting:v1:17',
      sourceActivityFingerprint: 'source_activity:v1:17',
    });
    expect(detail?.issue.nextActions[0]).toMatchObject({
      label: 'Review links-v2 diagnostics',
      routeTarget: {
        family: 'links-v2',
      },
    });
  });

  it('reopens disappeared issues as fresh current rows after they reappear', async () => {
    const firstSnapshot = createSnapshot();
    assertOk(await repo.reconcileScope(firstSnapshot));

    const transferGap = assertOk(await repo.listCurrentIssueSummaries('profile:1')).find(
      (record) => record.issue.family === 'transfer_gap'
    );
    expect(transferGap).toBeDefined();

    assertOk(
      await repo.reconcileScope(
        createSnapshot({
          updatedAt: new Date('2026-04-14T12:30:00.000Z'),
        })
      )
    );

    assertOk(
      await repo.reconcileScope(
        createSnapshot({
          linkGapIssues: [],
          assetReviewSummaries: [createAssetReviewSummary()],
          updatedAt: new Date('2026-04-14T12:40:00.000Z'),
        })
      )
    );

    assertOk(
      await repo.reconcileScope(
        createSnapshot({
          updatedAt: new Date('2026-04-14T12:50:00.000Z'),
        })
      )
    );

    const reappearedTransferGap = assertOk(await repo.listCurrentIssueSummaries('profile:1')).find(
      (record) => record.issue.family === 'transfer_gap'
    );
    expect(reappearedTransferGap).toBeDefined();

    const transferGapRows = await db
      .selectFrom('accounting_issue_rows')
      .select(['id', 'issue_key', 'status', 'closed_reason'])
      .where('scope_key', '=', 'profile:1')
      .where('issue_key', '=', transferGap!.issueKey)
      .orderBy('first_seen_at', 'asc')
      .execute();

    expect(transferGapRows).toHaveLength(2);
    expect(transferGapRows[0]).toMatchObject({
      status: 'closed',
      closed_reason: 'disappeared',
    });
    expect(transferGapRows[1]).toMatchObject({
      status: 'open',
    });
  });

  it('lists current issue summaries across all scopes for one profile', async () => {
    assertOk(await repo.reconcileScope(createSnapshot()));
    assertOk(await repo.reconcileScope(createCostBasisSnapshot()));

    const scopedSummaries = assertOk(await repo.listCurrentIssueSummariesForProfile(PROFILE_ID));

    expect(scopedSummaries).toHaveLength(3);
    expect(scopedSummaries.map((record) => record.scopeKey)).toEqual([
      'profile:1',
      expect.stringMatching(/^profile:1:cost-basis:/),
      'profile:1',
    ]);
    expect(scopedSummaries.map((record) => record.issue.family)).toEqual([
      'asset_review_required',
      'missing_price',
      'transfer_gap',
    ]);
  });

  it('reconciles execution-failure rows for a cost-basis scope', async () => {
    const snapshot = createCostBasisExecutionFailureSnapshot();

    assertOk(await repo.reconcileScope(snapshot));

    const scope = assertOk(await repo.findScope(snapshot.scope.scopeKey));
    expect(scope).toMatchObject({
      scopeKind: 'cost-basis',
      scopeKey: snapshot.scope.scopeKey,
      status: 'failed',
      openIssueCount: 1,
      blockingIssueCount: 1,
    });

    const summaries = assertOk(await repo.listCurrentIssueSummaries(snapshot.scope.scopeKey));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.issue).toMatchObject({
      family: 'execution_failure',
      code: 'WORKFLOW_EXECUTION_FAILED',
      summary: 'Cost basis execution failed during cost basis calculation.',
    });
  });
});
