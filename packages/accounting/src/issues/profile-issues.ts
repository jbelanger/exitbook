import {
  applyAssetExclusionsToReviewSummary,
  formatTransactionFingerprintRef,
  type AssetReviewSummary,
} from '@exitbook/core';
import { sha256Hex } from '@exitbook/foundation';

import { type GapCueKind, type LinkGapIssue, buildLinkGapIssueKey } from '../linking/gaps/gap-model.js';

import {
  type AccountingIssueDetailItem,
  type AccountingIssueEvidenceRef,
  type AccountingIssueNextAction,
  type AccountingIssueScopeSnapshot,
  type AccountingIssueScopeSummary,
  buildAccountingIssueRef,
  buildAssetReviewBlockerIssueKey,
  buildTransferGapIssueKey,
} from './issue-model.js';

export interface BuildProfileAccountingIssueScopeSnapshotInput {
  assetReviewSummaries: Iterable<AssetReviewSummary>;
  excludedAssetIds?: ReadonlySet<string> | undefined;
  linkGapIssues: readonly LinkGapIssue[];
  profileId: number;
  scopeKey: string;
  title: string;
  updatedAt?: Date | undefined;
}

export function buildProfileAccountingIssueScopeSnapshot(
  input: BuildProfileAccountingIssueScopeSnapshotInput
): AccountingIssueScopeSnapshot {
  const updatedAt = input.updatedAt ?? new Date();
  const normalizedAssetReviewSummaries = [...input.assetReviewSummaries]
    .map((summary) => applyAssetExclusionsToReviewSummary(summary, input.excludedAssetIds ?? new Set<string>()))
    .filter((summary) => summary.accountingBlocked && !input.excludedAssetIds?.has(summary.assetId))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const issues = [
    ...input.linkGapIssues.map((issue) => buildTransferGapAccountingIssue(input.scopeKey, issue)),
    ...normalizedAssetReviewSummaries.map((summary) => buildAssetReviewAccountingIssue(input.scopeKey, summary)),
  ];

  const blockingIssueCount = issues.filter((issue) => issue.issue.severity === 'blocked').length;
  const scope: AccountingIssueScopeSummary = {
    scopeKind: 'profile',
    scopeKey: input.scopeKey,
    profileId: input.profileId,
    title: input.title,
    status: issues.length === 0 ? 'ready' : 'has-open-issues',
    openIssueCount: issues.length,
    blockingIssueCount,
    updatedAt,
  };

  return {
    scope,
    issues,
  };
}

function buildTransferGapAccountingIssue(
  scopeKey: string,
  gapIssue: LinkGapIssue
): AccountingIssueScopeSnapshot['issues'][number] {
  const issueKey = buildTransferGapIssueKey(
    buildLinkGapIssueKey({
      txFingerprint: gapIssue.txFingerprint,
      assetId: gapIssue.assetId,
      direction: gapIssue.direction,
    })
  );
  const gapRef = buildAccountingTransferGapRef(gapIssue);
  const transactionRef = formatTransactionFingerprintRef(gapIssue.txFingerprint);
  const issue: AccountingIssueDetailItem = {
    issueRef: buildAccountingIssueRef(scopeKey, issueKey),
    scope: {
      kind: 'profile',
      key: scopeKey,
    },
    family: 'transfer_gap',
    code: 'LINK_GAP',
    severity: 'blocked',
    summary: buildTransferGapSummary(gapIssue),
    details: buildTransferGapDetails(gapIssue),
    whyThisMatters: 'Blocks trustworthy transfer accounting for this movement.',
    evidenceRefs: buildTransferGapEvidenceRefs(gapRef, transactionRef),
    nextActions: buildTransferGapNextActions(gapRef, transactionRef),
  };

  return {
    issueKey,
    issue,
  };
}

function buildAssetReviewAccountingIssue(
  scopeKey: string,
  summary: AssetReviewSummary
): AccountingIssueScopeSnapshot['issues'][number] {
  const issueKey = buildAssetReviewBlockerIssueKey(summary);
  const issue: AccountingIssueDetailItem = {
    issueRef: buildAccountingIssueRef(scopeKey, issueKey),
    scope: {
      kind: 'profile',
      key: scopeKey,
    },
    family: 'asset_review_blocker',
    code: 'ASSET_REVIEW_BLOCKER',
    severity: 'blocked',
    summary: `Asset review still blocks accounting for ${truncateMiddle(summary.assetId, 44)}`,
    details: buildAssetReviewDetails(summary),
    whyThisMatters: 'Blocks accounting and reporting flows that involve this asset until review is complete.',
    evidenceRefs: [
      {
        kind: 'asset',
        selector: summary.assetId,
      },
    ],
    nextActions: [
      {
        kind: 'review_asset',
        label: 'Review in assets',
        mode: 'routed',
        routeTarget: {
          family: 'assets',
          selectorKind: 'asset-selector',
          selectorValue: summary.assetId,
        },
      },
    ],
  };

  return {
    issueKey,
    issue,
  };
}

function buildAccountingTransferGapRef(issue: LinkGapIssue): string {
  const fullSelector = sha256Hex(`${issue.txFingerprint}:${issue.assetId}:${issue.direction}`);
  return fullSelector.length <= 10 ? fullSelector : fullSelector.slice(0, 10);
}

function buildTransferGapSummary(issue: LinkGapIssue): string {
  const directionLabel = issue.direction === 'outflow' ? 'outflow' : 'inflow';
  return `${issue.assetSymbol} ${directionLabel} still needs transfer review`;
}

function buildTransferGapDetails(issue: LinkGapIssue): string {
  const directionLabel = issue.direction === 'outflow' ? 'outflow' : 'inflow';
  const detailSegments = [
    `This ${issue.assetSymbol} ${directionLabel} still has ${issue.missingAmount} uncovered by confirmed transfer links.`,
  ];

  if (issue.confirmedCoveragePercent !== '0') {
    detailSegments.push(
      `Confirmed links currently cover ${formatPercent(issue.confirmedCoveragePercent)} of the total movement.`
    );
  }

  if (issue.gapCue) {
    detailSegments.push(`Cue: ${formatGapCueLabel(issue.gapCue)}.`);
  }

  if (issue.contextHint) {
    detailSegments.push(`Context: ${issue.contextHint.message}`);
  }

  return detailSegments.join(' ');
}

function buildTransferGapEvidenceRefs(gapRef: string, transactionRef: string): AccountingIssueEvidenceRef[] {
  return [
    {
      kind: 'gap',
      ref: gapRef,
    },
    {
      kind: 'transaction',
      ref: transactionRef,
    },
  ];
}

function buildTransferGapNextActions(gapRef: string, transactionRef: string): AccountingIssueNextAction[] {
  return [
    {
      kind: 'review_gap',
      label: 'Review in links gaps',
      mode: 'routed',
      routeTarget: {
        family: 'links',
        selectorKind: 'gap-ref',
        selectorValue: gapRef,
      },
    },
    {
      kind: 'inspect_transaction',
      label: 'Inspect transaction',
      mode: 'review_only',
      routeTarget: {
        family: 'transactions',
        selectorKind: 'tx-ref',
        selectorValue: transactionRef,
      },
    },
  ];
}

function buildAssetReviewDetails(summary: AssetReviewSummary): string {
  const detailSegments = [`Asset ${summary.assetId} currently blocks accounting.`];

  if (summary.warningSummary) {
    detailSegments.push(summary.warningSummary);
  } else if (summary.evidence[0]?.message) {
    detailSegments.push(summary.evidence[0].message);
  }

  if (summary.confirmationIsStale) {
    detailSegments.push('A previous confirmation is stale and needs review against current evidence.');
  }

  return detailSegments.join(' ');
}

function formatPercent(value: string): string {
  return value.includes('.') ? `${value.replace(/\.?0+$/, '')}%` : `${value}%`;
}

function formatGapCueLabel(cue: GapCueKind): string {
  switch (cue) {
    case 'likely_dust':
      return 'likely low-value dust';
    case 'likely_correlated_service_swap':
      return 'likely correlated service swap';
    case 'likely_cross_chain_migration':
      return 'likely cross-chain migration';
    case 'likely_cross_chain_bridge':
      return 'likely same-owner cross-chain bridge';
  }
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const visibleChars = Math.max(8, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, visibleChars)}…${value.slice(-visibleChars)}`;
}
