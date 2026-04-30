import {
  applyAssetExclusionsToReviewSummary,
  formatTransactionFingerprintRef,
  type AssetReviewSummary,
} from '@exitbook/core';
import { sha256Hex } from '@exitbook/foundation';

import {
  buildLedgerLinkingGapIssueKey,
  buildLedgerLinkingGapRef,
  type LedgerLinkingGapIssue,
  type LedgerLinkingGapReason,
} from '../ledger-linking/gaps/ledger-linking-gap-issues.js';
import { type GapCueKind, type LinkGapIssue, buildLinkGapIssueKey } from '../linking/gaps/gap-model.js';

import {
  type AccountingIssueDetailItem,
  type AccountingIssueEvidenceRef,
  type AccountingIssueNextAction,
  type AccountingIssueScopeSnapshot,
  type AccountingIssueScopeSummary,
  buildAccountingIssueRef,
  buildAssetReviewRequiredIssueKey,
  buildTransferGapIssueKey,
} from './issue-model.js';

export interface BuildProfileAccountingIssueScopeSnapshotInput {
  assetReviewSummaries: Iterable<AssetReviewSummary>;
  excludedAssetIds?: ReadonlySet<string> | undefined;
  ledgerLinkingGapIssues?: readonly LedgerLinkingGapIssue[] | undefined;
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
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const assetReviewIssueSummaries = normalizedAssetReviewSummaries.filter(
    (summary) => !input.excludedAssetIds?.has(summary.assetId) && requiresAssetReviewIssue(summary)
  );
  const assetReviewIssueAssetIds = new Set(assetReviewIssueSummaries.map((summary) => summary.assetId));
  const transferGapIssues = buildProfileTransferGapAccountingIssues(input, assetReviewIssueAssetIds);
  const issues = [
    ...transferGapIssues,
    ...assetReviewIssueSummaries.map((summary) => buildAssetReviewAccountingIssue(input.scopeKey, summary)),
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

function buildProfileTransferGapAccountingIssues(
  input: BuildProfileAccountingIssueScopeSnapshotInput,
  assetReviewIssueAssetIds: ReadonlySet<string>
): AccountingIssueScopeSnapshot['issues'] {
  if (input.ledgerLinkingGapIssues !== undefined) {
    return input.ledgerLinkingGapIssues
      .filter((issue) => !input.excludedAssetIds?.has(issue.assetId))
      .filter((issue) => !assetReviewIssueAssetIds.has(issue.assetId))
      .map((issue) => buildLedgerLinkingGapAccountingIssue(input.scopeKey, issue));
  }

  return input.linkGapIssues.map((issue) => buildTransferGapAccountingIssue(input.scopeKey, issue));
}

function buildLedgerLinkingGapAccountingIssue(
  scopeKey: string,
  gapIssue: LedgerLinkingGapIssue
): AccountingIssueScopeSnapshot['issues'][number] {
  const issueKey = buildTransferGapIssueKey(buildLedgerLinkingGapIssueKey(gapIssue));
  const gapRef = buildLedgerLinkingGapRef(gapIssue);
  const issue: AccountingIssueDetailItem = {
    issueRef: buildAccountingIssueRef(scopeKey, issueKey),
    scope: {
      kind: 'profile',
      key: scopeKey,
    },
    family: 'transfer_gap',
    code: 'LINK_GAP',
    severity: getLedgerLinkingGapSeverity(gapIssue.gapReason),
    summary: buildLedgerLinkingGapSummary(gapIssue),
    details: buildLedgerLinkingGapDetails(gapIssue),
    whyThisMatters:
      'Unresolved ledger-linking candidates leave transfer accounting incomplete until they are linked, dismissed, or explained.',
    evidenceRefs: buildLedgerLinkingGapEvidenceRefs(gapRef, gapIssue),
    nextActions: buildLedgerLinkingGapNextActions(),
  };

  return {
    issueKey,
    issue,
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
  const issueKey = buildAssetReviewRequiredIssueKey(summary);
  const issue: AccountingIssueDetailItem = {
    issueRef: buildAccountingIssueRef(scopeKey, issueKey),
    scope: {
      kind: 'profile',
      key: scopeKey,
    },
    family: 'asset_review_required',
    code: 'ASSET_REVIEW_REQUIRED',
    severity: summary.accountingBlocked ? 'blocked' : 'warning',
    summary: buildAssetReviewSummary(summary),
    details: buildAssetReviewDetails(summary),
    whyThisMatters: buildAssetReviewWhyThisMatters(summary),
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

function buildLedgerLinkingGapSummary(issue: LedgerLinkingGapIssue): string {
  return `${issue.assetSymbol} ${formatLedgerLinkingDirection(issue.direction)} remains unresolved in links-v2`;
}

function buildLedgerLinkingGapDetails(issue: LedgerLinkingGapIssue): string {
  const detailSegments = [
    `${issue.remainingAmount} ${issue.assetSymbol} remains unmatched on ${issue.platformKey}.`,
    `Reason: ${formatLedgerLinkingGapReason(issue.gapReason)}.`,
    `Activity: ${issue.activityDatetime.toISOString()}.`,
    `Posting: ${issue.postingFingerprint}.`,
  ];

  if (issue.blockchainTransactionHash) {
    detailSegments.push(`Transaction hash: ${issue.blockchainTransactionHash}.`);
  }

  if (issue.claimedAmount !== '0') {
    detailSegments.push(
      `Already claimed by accepted relationships: ${issue.claimedAmount} of ${issue.originalAmount}.`
    );
  }

  if (issue.timingCounterpart !== undefined) {
    detailSegments.push(
      `Nearest timing clue is candidate #${issue.timingCounterpart.candidateId}, but the target activity occurs before the source by ${formatDurationSeconds(
        issue.timingCounterpart.timeDistanceSeconds
      )}.`
    );
  }

  return detailSegments.join(' ');
}

function buildLedgerLinkingGapEvidenceRefs(gapRef: string, issue: LedgerLinkingGapIssue): AccountingIssueEvidenceRef[] {
  return [
    {
      kind: 'gap',
      ref: gapRef,
    },
    {
      kind: 'ledger_posting',
      journalFingerprint: issue.journalFingerprint,
      postingFingerprint: issue.postingFingerprint,
      sourceActivityFingerprint: issue.sourceActivityFingerprint,
    },
  ];
}

function buildLedgerLinkingGapNextActions(): AccountingIssueNextAction[] {
  return [
    {
      kind: 'review_links_v2_diagnostics',
      label: 'Review links-v2 diagnostics',
      mode: 'review_only',
      routeTarget: {
        family: 'links-v2',
      },
    },
  ];
}

function requiresAssetReviewIssue(summary: AssetReviewSummary): boolean {
  return summary.accountingBlocked || summary.reviewStatus === 'needs-review' || summary.confirmationIsStale;
}

function getLedgerLinkingGapSeverity(reason: LedgerLinkingGapReason): AccountingIssueDetailItem['severity'] {
  switch (reason) {
    case 'exchange_transfer_missing_hash':
    case 'missing_linking_evidence':
      return 'blocked';
    case 'bridge_or_migration_timing_mismatch':
    case 'external_transfer_evidence_unmatched':
    case 'unclassified_unmatched_transfer_candidate':
      return 'warning';
  }
}

function formatLedgerLinkingDirection(direction: LedgerLinkingGapIssue['direction']): string {
  return direction === 'source' ? 'outflow' : 'inflow';
}

function formatLedgerLinkingGapReason(reason: LedgerLinkingGapReason): string {
  switch (reason) {
    case 'bridge_or_migration_timing_mismatch':
      return 'timing suggests bridge or migration context, but not an acceptable normal transfer link';
    case 'exchange_transfer_missing_hash':
      return 'exchange-side transfer evidence is missing an on-chain transaction hash';
    case 'external_transfer_evidence_unmatched':
      return 'candidate has transfer hash or address evidence, but no accepted same-owner link';
    case 'missing_linking_evidence':
      return 'candidate has no hash or endpoint evidence for automatic linking';
    case 'unclassified_unmatched_transfer_candidate':
      return 'candidate remains unmatched and needs classification';
  }
}

function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(3).replace(/\.?0+$/, '')}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1).replace(/\.?0+$/, '')}m`;
  }

  const hours = minutes / 60;
  return `${hours.toFixed(1).replace(/\.?0+$/, '')}h`;
}

function buildAssetReviewDetails(summary: AssetReviewSummary): string {
  const detailSegments = [
    summary.accountingBlocked
      ? `Asset ${summary.assetId} currently blocks accounting.`
      : `Asset ${summary.assetId} needs review before dependent accounting work continues.`,
  ];

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

function buildAssetReviewSummary(summary: AssetReviewSummary): string {
  const assetLabel = truncateMiddle(summary.assetId, 44);
  if (summary.accountingBlocked) {
    return `Asset review blocks accounting for ${assetLabel}`;
  }

  return `Asset review needed for ${assetLabel}`;
}

function buildAssetReviewWhyThisMatters(summary: AssetReviewSummary): string {
  if (summary.accountingBlocked) {
    return 'Blocks accounting and reporting flows that involve this asset until review is complete.';
  }

  return 'Review evidence may change whether related transactions should be linked, excluded, or left unresolved.';
}

function formatPercent(value: string): string {
  return value.includes('.') ? `${value.replace(/\.?0+$/, '')}%` : `${value}%`;
}

function formatGapCueLabel(cue: GapCueKind): string {
  switch (cue) {
    case 'likely_dust':
      return 'likely low-value dust';
    case 'likely_asset_migration':
      return 'likely internal asset migration';
    case 'likely_correlated_service_swap':
      return 'likely correlated service swap';
    case 'likely_cross_chain_migration':
      return 'likely cross-chain migration';
    case 'likely_cross_chain_bridge':
      return 'likely same-owner cross-chain bridge';
    case 'unmatched_reference':
      return 'unmatched CoinGecko reference';
  }
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const visibleChars = Math.max(8, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, visibleChars)}…${value.slice(-visibleChars)}`;
}
