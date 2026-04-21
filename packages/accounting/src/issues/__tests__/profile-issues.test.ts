import type { AssetReviewSummary } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

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

    expect(snapshot.issues.map((issue) => issue.issue.family)).toEqual(['transfer_gap', 'asset_review_blocker']);
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

  it('returns a ready scope when there are no current issues', () => {
    const snapshot = buildProfileAccountingIssueScopeSnapshot({
      profileId: 7,
      scopeKey: 'profile:7',
      title: 'Clean profile',
      linkGapIssues: [],
      assetReviewSummaries: [createAssetReviewSummary({ accountingBlocked: false })],
      excludedAssetIds: new Set<string>(),
      updatedAt: new Date('2026-04-14T12:00:00.000Z'),
    });

    expect(snapshot.scope.status).toBe('ready');
    expect(snapshot.scope.openIssueCount).toBe(0);
    expect(snapshot.scope.blockingIssueCount).toBe(0);
    expect(snapshot.issues).toHaveLength(0);
  });

  it('does not surface asset-review blocker issues for excluded assets', () => {
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

  it('does not surface ambiguity blockers once every conflicting alternative is excluded', () => {
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
