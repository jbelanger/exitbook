import {
  buildCostBasisAccountingIssueScopeSnapshot,
  buildProfileAccountingIssueScopeSnapshot,
} from '@exitbook/accounting/issues';
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
    operationCategory: 'transfer',
    operationType: 'withdrawal',
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

function createSnapshot(input?: {
  assetReviewSummaries?: readonly AssetReviewSummary[] | undefined;
  linkGapIssues?: readonly LinkGapIssue[] | undefined;
  updatedAt?: Date | undefined;
}) {
  return buildProfileAccountingIssueScopeSnapshot({
    profileId: PROFILE_ID,
    scopeKey: 'profile:1',
    title: 'default',
    assetReviewSummaries: input?.assetReviewSummaries ?? [createAssetReviewSummary()],
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
    expect(summaries.map((record) => record.issue.family)).toEqual(['asset_review_blocker', 'transfer_gap']);
    expect(summaries[0]?.issue.issueRef).toHaveLength(10);
    expect(summaries[0]?.issue.status).toBe('open');

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
      assetReviewSummaries: [createAssetReviewSummary({ accountingBlocked: false })],
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
      'asset_review_blocker',
      'tax_readiness',
      'transfer_gap',
    ]);
  });
});
