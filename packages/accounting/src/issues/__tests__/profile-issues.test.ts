import type { AssetReviewSummary } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { LedgerLinkingGapIssue } from '../../ledger-linking/gaps/ledger-linking-gap-issues.js';
import type { LinkGapIssue } from '../../linking/gaps/gap-model.js';
import { buildProfileAccountingIssueScopeSnapshot } from '../profile-issues.js';

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
    classifications: ['exchange_transfer_missing_hash', 'missing_linking_evidence'],
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

describe('buildProfileAccountingIssueScopeSnapshot', () => {
  it('builds blocked transfer-gap and asset-review issues for the profile scope', () => {
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 42,
      scopeKey: 'profile:42',
      title: 'Main profile',
      linkGapIssues: [createLinkGapIssue()],
      assetReviewSummaries: [createAssetReviewSummary()],
      excludedAssetIds: new Set<string>(),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope).toMatchObject({
      scopeKind: 'profile',
      scopeKey: 'profile:42',
      profileId: 42,
      title: 'Main profile',
      status: 'has-open-issues',
      openIssueCount: 2,
      blockingIssueCount: 2,
    });

    expect(snapshot.issues.map((issue) => issue.issue.family)).toEqual(['transfer_gap', 'asset_review_required']);
    expect(snapshot.issues[0]?.issue.nextActions[0]).toMatchObject({
      kind: 'review_gap',
      mode: 'routed',
      routeTarget: {
        family: 'links',
        selectorKind: 'gap-ref',
      },
    });
    expect(snapshot.issues[1]?.issue.nextActions[0]).toMatchObject({
      kind: 'review_asset',
      routeTarget: {
        family: 'assets',
        selectorKind: 'asset-selector',
        selectorValue: 'blockchain:ethereum:0xscam',
      },
    });
  });

  it('builds ledger-linking-v2 transfer gap issues with ledger evidence and links-v2 routing', () => {
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 42,
      scopeKey: 'profile:42',
      title: 'Main profile',
      linkGapIssues: [],
      ledgerLinkingGapIssues: [createLedgerLinkingGapIssue()],
      assetReviewSummaries: [],
      excludedAssetIds: new Set<string>(),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope).toMatchObject({
      status: 'has-open-issues',
      openIssueCount: 1,
      blockingIssueCount: 1,
    });
    expect(snapshot.issues[0]?.issue).toMatchObject({
      family: 'transfer_gap',
      code: 'LINK_GAP',
      severity: 'blocked',
      summary: 'ETH outflow remains unresolved in links-v2',
      whyThisMatters:
        'Unresolved ledger-linking candidates leave transfer accounting incomplete until they are linked, dismissed, or explained.',
      nextActions: [
        {
          kind: 'review_links_v2_diagnostics',
          label: 'Review links-v2 diagnostics',
          mode: 'review_only',
          routeTarget: {
            family: 'links-v2',
          },
        },
      ],
    });
    const [gapEvidence, postingEvidence] = snapshot.issues[0]?.issue.evidenceRefs ?? [];
    expect(gapEvidence?.kind).toBe('gap');
    if (gapEvidence?.kind === 'gap') {
      expect(gapEvidence.ref).toMatch(/^[a-f0-9]{10}$/);
    }
    expect(postingEvidence).toEqual({
      kind: 'ledger_posting',
      journalFingerprint: 'ledger_journal:v1:17',
      postingFingerprint: 'ledger_posting:v1:17',
      sourceActivityFingerprint: 'source_activity:v1:17',
    });
  });

  it('surfaces processor-marked asset migration context as a non-blocking ledger-linking-v2 gap', () => {
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 42,
      scopeKey: 'profile:42',
      title: 'Main profile',
      linkGapIssues: [],
      ledgerLinkingGapIssues: [
        createLedgerLinkingGapIssue({
          assetSymbol: 'RENDER' as LedgerLinkingGapIssue['assetSymbol'],
          classifications: ['processor_asset_migration_context'],
          direction: 'target',
          gapReason: 'processor_asset_migration_context',
          journalDiagnosticCodes: ['possible_asset_migration'],
          platformKey: 'kraken',
        }),
      ],
      assetReviewSummaries: [],
      excludedAssetIds: new Set<string>(),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope).toMatchObject({
      openIssueCount: 1,
      blockingIssueCount: 0,
    });
    expect(snapshot.issues[0]?.issue).toMatchObject({
      family: 'transfer_gap',
      severity: 'warning',
      summary: 'RENDER inflow remains unresolved in links-v2',
    });
    expect(snapshot.issues[0]?.issue.details).toContain(
      'processor diagnostics indicate asset migration or internal exchange movement context'
    );
  });

  it('surfaces related-profile counterpart evidence as a non-blocking ledger-linking-v2 gap', () => {
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 42,
      scopeKey: 'profile:42',
      title: 'Main profile',
      linkGapIssues: [],
      ledgerLinkingGapIssues: [
        createLedgerLinkingGapIssue({
          assetSymbol: 'USDC' as LedgerLinkingGapIssue['assetSymbol'],
          gapReason: 'related_profile_counterpart_evidence',
          relatedProfileCounterparts: [
            {
              activityDatetime: new Date('2024-05-19T11:32:08.000Z'),
              amount: '99',
              candidateId: 88,
              direction: 'target',
              platformKey: 'solana',
              platformKind: 'blockchain',
              postingFingerprint: 'ledger_posting:v1:child-target',
              profileDisplayName: 'Maely',
              profileKey: 'maely',
              secondsDeltaFromGap: 14.612,
            },
          ],
        }),
      ],
      assetReviewSummaries: [],
      excludedAssetIds: new Set<string>(),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope).toMatchObject({
      openIssueCount: 1,
      blockingIssueCount: 0,
    });
    expect(snapshot.issues[0]?.issue).toMatchObject({
      family: 'transfer_gap',
      severity: 'warning',
      summary: 'USDC outflow has related-profile evidence in links-v2',
    });
    expect(snapshot.issues[0]?.issue.details).toContain(
      'exact opposite-direction amount/time evidence exists in another profile'
    );
    expect(snapshot.issues[0]?.issue.details).toContain(
      'Related profile counterpart evidence: 99 on Maely [maely] solana at 2024-05-19T11:32:08.000Z (14.612s later).'
    );
    expect(snapshot.issues[0]?.issue.details).toContain(
      'This is external/related-owner evidence, not a same-owner internal link.'
    );
  });

  it('prefers ledger-linking-v2 gaps over legacy movement gaps when both are supplied', () => {
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 42,
      scopeKey: 'profile:42',
      title: 'Main profile',
      linkGapIssues: [createLinkGapIssue()],
      ledgerLinkingGapIssues: [createLedgerLinkingGapIssue()],
      assetReviewSummaries: [],
      excludedAssetIds: new Set<string>(),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope).toMatchObject({
      openIssueCount: 1,
      blockingIssueCount: 1,
    });
    expect(snapshot.issues.map((issue) => issue.issue.summary)).toEqual(['ETH outflow remains unresolved in links-v2']);
    expect(snapshot.issues[0]?.issue.nextActions[0]).toMatchObject({
      routeTarget: {
        family: 'links-v2',
      },
    });
  });

  it('does not duplicate ledger-linking-v2 gaps for assets already blocked by asset review', () => {
    const blockedAssetId = 'blockchain:ethereum:0xscam';
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 42,
      scopeKey: 'profile:42',
      title: 'Main profile',
      linkGapIssues: [],
      ledgerLinkingGapIssues: [
        createLedgerLinkingGapIssue({
          assetId: blockedAssetId,
          assetSymbol: 'SCAM' as LedgerLinkingGapIssue['assetSymbol'],
        }),
      ],
      assetReviewSummaries: [createAssetReviewSummary({ assetId: blockedAssetId })],
      excludedAssetIds: new Set<string>(),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope).toMatchObject({
      openIssueCount: 1,
      blockingIssueCount: 1,
    });
    expect(snapshot.issues.map((issue) => issue.issue.family)).toEqual(['asset_review_required']);
  });

  it('surfaces non-blocking asset review work before related ledger-linking-v2 gaps', () => {
    const reviewAssetId = 'blockchain:ethereum:0xunmatched';
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 42,
      scopeKey: 'profile:42',
      title: 'Main profile',
      linkGapIssues: [],
      ledgerLinkingGapIssues: [
        createLedgerLinkingGapIssue({
          assetId: reviewAssetId,
          assetSymbol: 'NOREF' as LedgerLinkingGapIssue['assetSymbol'],
          gapReason: 'external_transfer_evidence_unmatched',
          classifications: ['external_transfer_evidence'],
        }),
      ],
      assetReviewSummaries: [
        createAssetReviewSummary({
          assetId: reviewAssetId,
          accountingBlocked: false,
          referenceStatus: 'unmatched',
          warningSummary: "Provider 'coingecko' could not match this token to a canonical asset",
          evidence: [
            {
              kind: 'unmatched-reference',
              severity: 'warning',
              message: "Provider 'coingecko' could not match this token to a canonical asset",
              metadata: { provider: 'coingecko' },
            },
          ],
        }),
      ],
      excludedAssetIds: new Set<string>(),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope).toMatchObject({
      openIssueCount: 1,
      blockingIssueCount: 0,
    });
    expect(snapshot.issues[0]?.issue).toMatchObject({
      family: 'asset_review_required',
      code: 'ASSET_REVIEW_REQUIRED',
      severity: 'warning',
      summary: `Asset review needed for ${reviewAssetId}`,
    });
    expect(snapshot.issues[0]?.issue.nextActions[0]).toMatchObject({
      kind: 'review_asset',
      label: 'Review in assets',
      mode: 'routed',
      routeTarget: {
        family: 'assets',
        selectorKind: 'asset-selector',
        selectorValue: reviewAssetId,
      },
    });
    expect(snapshot.issues[0]?.issue.details).toContain(
      "Provider 'coingecko' could not match this token to a canonical asset"
    );
    expect(snapshot.issues[0]?.issue.evidenceRefs).toContainEqual({
      kind: 'asset',
      selector: reviewAssetId,
    });
  });

  it('does not surface ledger-linking-v2 gaps for excluded assets', () => {
    const excludedAssetId = 'blockchain:ethereum:0xexcluded';
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 42,
      scopeKey: 'profile:42',
      title: 'Main profile',
      linkGapIssues: [],
      ledgerLinkingGapIssues: [createLedgerLinkingGapIssue({ assetId: excludedAssetId })],
      assetReviewSummaries: [],
      excludedAssetIds: new Set<string>([excludedAssetId]),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope.status).toBe('ready');
    expect(snapshot.scope.openIssueCount).toBe(0);
    expect(snapshot.issues).toHaveLength(0);
  });

  it('returns a ready scope when there are no current issues', () => {
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 7,
      scopeKey: 'profile:7',
      title: 'Clean profile',
      linkGapIssues: [],
      assetReviewSummaries: [
        createAssetReviewSummary({ accountingBlocked: false, evidence: [], reviewStatus: 'clear' }),
      ],
      excludedAssetIds: new Set<string>(),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope.status).toBe('ready');
    expect(snapshot.scope.openIssueCount).toBe(0);
    expect(snapshot.scope.blockingIssueCount).toBe(0);
    expect(snapshot.issues).toHaveLength(0);
  });

  it('does not surface asset-review-required issues for excluded assets', () => {
    const assetId = 'blockchain:ethereum:0xscam';
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 7,
      scopeKey: 'profile:7',
      title: 'Excluded asset profile',
      linkGapIssues: [],
      assetReviewSummaries: [createAssetReviewSummary({ assetId })],
      excludedAssetIds: new Set<string>([assetId]),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope.status).toBe('ready');
    expect(snapshot.scope.openIssueCount).toBe(0);
    expect(snapshot.scope.blockingIssueCount).toBe(0);
    expect(snapshot.issues).toHaveLength(0);
  });

  it('does not surface ambiguity review items once every conflicting alternative is excluded', () => {
    const currentAssetId = 'blockchain:arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
    const excludedAssetId = 'blockchain:arbitrum:0xc7cb7517e223682158c18d1f6481c771c1c614f8';
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 7,
      scopeKey: 'profile:7',
      title: 'Resolved ambiguity profile',
      linkGapIssues: [],
      assetReviewSummaries: [
        createAssetReviewSummary({
          assetId: currentAssetId,
          referenceStatus: 'matched',
          warningSummary: 'Same-chain symbol ambiguity on arbitrum:usdt',
          evidence: [
            {
              kind: 'same-symbol-ambiguity',
              severity: 'warning',
              message: 'Same-chain symbol ambiguity on arbitrum:usdt',
              metadata: {
                chain: 'arbitrum',
                normalizedSymbol: 'usdt',
                conflictingAssetIds: [excludedAssetId, currentAssetId],
              },
            },
          ],
        }),
      ],
      excludedAssetIds: new Set<string>([excludedAssetId]),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope.status).toBe('ready');
    expect(snapshot.scope.openIssueCount).toBe(0);
    expect(snapshot.scope.blockingIssueCount).toBe(0);
    expect(snapshot.issues).toHaveLength(0);
  });
});
