import type { GapCueKind, LinkGapIssue } from '@exitbook/accounting/linking';
import {
  hasImpliedFeeAmount,
  isPartialMatchLinkMetadata,
  isSameHashExternalLinkMetadata,
  type LinkStatus,
  type MatchCriteria,
  type TransactionLink,
} from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type { LinkGapBrowseCrossProfileCandidate, LinkGapBrowseItem } from '../links-gaps-browse-model.js';
import type {
  LinkProposalProvenanceSummary,
  LinkWithTransactions,
  TransferProposalWithTransactions,
} from '../links-view-model.js';

export interface LinkAmountDisplay {
  detailLabel?: string | undefined;
  detailSummary?: string | undefined;
  linkedAmount: string;
}

export function getStatusDisplay(status: LinkStatus): { icon: string; iconColor: string } {
  switch (status) {
    case 'confirmed':
      return { icon: '✓', iconColor: 'green' };
    case 'suggested':
      return { icon: '⚠', iconColor: 'yellow' };
    case 'rejected':
      return { icon: '✗', iconColor: 'dim' };
    default:
      return { icon: '•', iconColor: 'white' };
  }
}

export function formatAmount(amount: string, width: number): string {
  const num = parseFloat(amount);
  if (Number.isNaN(num)) {
    return amount.padStart(width);
  }

  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  return formatted.padStart(width);
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export function formatCompactAmount(amount: string): string {
  const num = Number.parseFloat(amount);
  if (Number.isNaN(num)) {
    return amount;
  }

  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  if (formatted === '0' && num !== 0) {
    return num.toExponential(2);
  }

  return formatted;
}

export function formatLinkDate(item: LinkWithTransactions): string {
  const rawTimestamp =
    item.sourceTransaction?.datetime ?? item.targetTransaction?.datetime ?? item.link.createdAt.toISOString();
  const parsed = new Date(rawTimestamp);

  if (Number.isNaN(parsed.getTime())) {
    return 'unknown'.padEnd(10);
  }

  return parsed.toISOString().slice(0, 10);
}

export function formatGapRowTimestamp(timestamp: string): string {
  return timestamp.substring(0, 16).replace('T', ' ');
}

export function formatConfidenceScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`.padStart(6);
}

export function getConfidenceColor(score: number): string {
  if (score >= 0.95) {
    return 'green';
  }

  if (score >= 0.7) {
    return 'yellow';
  }

  return 'red';
}

export function formatMatchCriteria(criteria: MatchCriteria): string {
  const parts: string[] = [];

  if (criteria.hashMatch === true) {
    parts.push('hash');
  }

  if (criteria.assetMatch) {
    parts.push('asset');
  }

  const amountSimilarity =
    typeof criteria.amountSimilarity === 'string'
      ? parseFloat(criteria.amountSimilarity)
      : criteria.amountSimilarity.toNumber();

  if (!(criteria.hashMatch === true && amountSimilarity === 1.0)) {
    parts.push(`amount ${(amountSimilarity * 100).toFixed(1)}%`);
  }

  if (criteria.timingValid) {
    const timingHours =
      typeof criteria.timingHours === 'string' ? parseFloat(criteria.timingHours) : criteria.timingHours;
    parts.push(`timing ${timingHours.toFixed(2)}h`);
  }

  if (criteria.addressMatch) {
    parts.push('address');
  }

  return parts.join(' · ');
}

export function formatCoverage(coveragePercent: string): string {
  const num = parseFloat(coveragePercent);
  return `${Math.round(num)}% covered`;
}

export function countGapSuggestionBuckets(issues: readonly LinkGapIssue[]): {
  withoutSuggestions: number;
  withSuggestions: number;
} {
  const withSuggestions = issues.filter((issue) => issue.suggestedCount > 0).length;
  return {
    withSuggestions,
    withoutSuggestions: issues.length - withSuggestions,
  };
}

export function countGapItemsWithCrossProfileCandidates(
  items: readonly Pick<LinkGapBrowseItem, 'crossProfileCandidates'>[]
): number {
  return items.reduce((count, item) => (item.crossProfileCandidates?.length ? count + 1 : count), 0);
}

export function getExactOtherProfileCounterpart(
  item: Pick<LinkGapBrowseItem, 'crossProfileCandidates'>
): LinkGapBrowseCrossProfileCandidate | undefined {
  return item.crossProfileCandidates?.length === 1 ? item.crossProfileCandidates[0] : undefined;
}

export function hasOtherProfileCounterparts(item: Pick<LinkGapBrowseItem, 'crossProfileCandidates'>): boolean {
  return (item.crossProfileCandidates?.length ?? 0) > 0;
}

export function formatGapCrossProfileCueLabel(
  item: Pick<LinkGapBrowseItem, 'crossProfileCandidates'>
): string | undefined {
  if (!hasOtherProfileCounterparts(item)) {
    return undefined;
  }

  const exactCounterpart = getExactOtherProfileCounterpart(item);
  if (exactCounterpart) {
    return `exact other-profile counterpart (${exactCounterpart.profileDisplayName})`;
  }

  const profileLabel = formatGapCrossProfileCueProfileLabel(item);
  return profileLabel ? `other-profile counterpart (${profileLabel})` : 'other-profile counterpart';
}

function formatGapCrossProfileCueProfileLabel(
  item: Pick<LinkGapBrowseItem, 'crossProfileCandidates'>
): string | undefined {
  const uniqueProfileDisplayNames = [
    ...new Set((item.crossProfileCandidates ?? []).map((candidate) => candidate.profileDisplayName)),
  ];

  if (uniqueProfileDisplayNames.length === 0) {
    return undefined;
  }

  if (uniqueProfileDisplayNames.length <= 2) {
    return uniqueProfileDisplayNames.join(', ');
  }

  return `${uniqueProfileDisplayNames.slice(0, 2).join(', ')}, +${uniqueProfileDisplayNames.length - 2}`;
}

export function formatCrossProfileProfileLabel(profileDisplayName: string, profileKey: string): string {
  return profileDisplayName === profileKey ? profileDisplayName : `${profileDisplayName} (${profileKey})`;
}

export function formatGapCrossProfileLikelyOutcome(
  item: Pick<LinkGapBrowseItem, 'crossProfileCandidates'>
): string | undefined {
  const counterpart = getExactOtherProfileCounterpart(item);
  if (!counterpart) {
    return undefined;
  }

  return `Tracked counterpart exists on profile ${formatCrossProfileProfileLabel(
    counterpart.profileDisplayName,
    counterpart.profileKey
  )}; inspect it before treating this as a generic same-profile gap.`;
}

export function formatResolvedGapExceptionCount(count: number): string {
  return `${count} resolved gap exception${count === 1 ? '' : 's'} hidden`;
}

export function formatNoOpenGapsMessage(hiddenResolvedIssueCount: number): string {
  if (hiddenResolvedIssueCount > 0) {
    return `No open gaps. ${hiddenResolvedIssueCount} resolved gap exception${
      hiddenResolvedIssueCount === 1 ? ' is' : 's are'
    } hidden.`;
  }

  return 'All movements have confirmed counterparties.';
}

export function getCoverageColor(percent: number): string {
  if (percent >= 50) {
    return 'green';
  }

  if (percent > 0) {
    return 'yellow';
  }

  return 'red';
}

export function getGapSuggestionColor(issue: LinkGapIssue): string {
  if (issue.suggestedCount === 0) {
    return 'yellow';
  }

  return issue.highestSuggestedConfidencePercent
    ? getConfidenceColor(parseFloat(issue.highestSuggestedConfidencePercent) / 100)
    : 'green';
}

export function formatGapCueLabel(cue: GapCueKind): string {
  switch (cue) {
    case 'likely_dust':
      return 'likely low-value dust';
    case 'likely_correlated_service_swap':
      return 'likely correlated service swap';
    case 'likely_receive_then_forward':
      return 'likely receive then forward';
    case 'likely_cross_chain_migration':
      return 'likely cross-chain migration';
    case 'likely_cross_chain_bridge':
      return 'likely same-owner cross-chain bridge';
    case 'unmatched_reference':
      return 'unmatched CoinGecko reference';
  }
}

export function gapCueSuggestsGapException(cue: GapCueKind | undefined): boolean {
  return cue === 'likely_correlated_service_swap' || cue === 'likely_receive_then_forward';
}

export function gapContextHintSuggestsGapException(_contextHint: LinkGapIssue['contextHint']): boolean {
  return false;
}

export function gapCueSuggestsManualLink(cue: GapCueKind | undefined): boolean {
  return cue === 'likely_cross_chain_bridge' || cue === 'likely_cross_chain_migration';
}

export function gapContextHintSuggestsManualLink(contextHint: LinkGapIssue['contextHint']): boolean {
  return contextHint?.kind === 'diagnostic' && contextHint.code === 'bridge_transfer';
}

export function gapIssueSuggestsGapException(issue: Pick<LinkGapIssue, 'gapCue' | 'contextHint'>): boolean {
  return gapCueSuggestsGapException(issue.gapCue) || gapContextHintSuggestsGapException(issue.contextHint);
}

export function gapIssueSuggestsManualLink(issue: Pick<LinkGapIssue, 'gapCue' | 'contextHint'>): boolean {
  return gapCueSuggestsManualLink(issue.gapCue) || gapContextHintSuggestsManualLink(issue.contextHint);
}

export function formatGapLikelyOutcome(
  issue: Pick<LinkGapIssue, 'gapCue' | 'contextHint'>,
  counterpartTransactionRef?: string
): string | undefined {
  if (issue.gapCue === 'unmatched_reference') {
    return 'CoinGecko could not match this token to a canonical asset; inspect asset review before treating this as a normal transfer gap.';
  }

  if (issue.contextHint?.kind === 'diagnostic' && issue.contextHint.code === 'exchange_deposit_address_credit') {
    return 'Exchange export only proves a credit into the platform deposit address; inspect the raw chain source before linking or resolving this gap.';
  }

  if (gapIssueSuggestsManualLink(issue)) {
    if (counterpartTransactionRef !== undefined) {
      return 'Likely same-owner bridge or migration; inspect the counterpart, then create or confirm a transfer link if basis should carry.';
    }

    return 'Bridge or migration evidence exists; inspect the counterpart and create or confirm a transfer link if this is same-owner movement.';
  }

  if (!gapIssueSuggestsGapException(issue)) {
    return undefined;
  }

  if (counterpartTransactionRef !== undefined) {
    return 'No direct internal transfer; inspect the counterpart, then resolve this gap if confirmed.';
  }

  return 'No direct internal transfer; resolve this gap if confirmed.';
}

export function formatGapSuggestionAvailability(issue: LinkGapIssue): string {
  if (issue.suggestedCount === 0) {
    return 'no suggestions yet';
  }

  return `${issue.suggestedCount} suggested${
    issue.highestSuggestedConfidencePercent ? ` (${issue.highestSuggestedConfidencePercent}%)` : ''
  }`;
}

export function formatGapCounterpartTimeDelta(secondsDeltaFromGap: number): string {
  if (secondsDeltaFromGap === 0) {
    return 'same time';
  }

  const absoluteSeconds = Math.abs(secondsDeltaFromGap);
  const direction = secondsDeltaFromGap > 0 ? 'later' : 'earlier';

  if (absoluteSeconds < 60) {
    return `${absoluteSeconds}s ${direction}`;
  }

  const absoluteMinutes = Math.round(absoluteSeconds / 60);
  if (absoluteMinutes < 60) {
    return `${absoluteMinutes}m ${direction}`;
  }

  const absoluteHours = Math.round(absoluteMinutes / 60);
  if (absoluteHours < 24) {
    return `${absoluteHours}h ${direction}`;
  }

  const absoluteDays = Math.round(absoluteHours / 24);
  return `${absoluteDays}d ${direction}`;
}

export function formatLinkTypeDisplay(
  link: TransactionLink,
  sourceTransaction: LinkWithTransactions['sourceTransaction'],
  targetTransaction: LinkWithTransactions['targetTransaction']
): string {
  if (sourceTransaction?.platformKind === 'blockchain' && targetTransaction?.platformKind === 'exchange') {
    return 'blockchain to exchange';
  }

  if (sourceTransaction?.platformKind === 'exchange' && targetTransaction?.platformKind === 'blockchain') {
    return 'exchange to blockchain';
  }

  if (sourceTransaction?.platformKind === 'blockchain' && targetTransaction?.platformKind === 'blockchain') {
    return link.linkType === 'blockchain_internal' ? 'blockchain internal' : 'blockchain to blockchain';
  }

  if (sourceTransaction?.platformKind === 'exchange' && targetTransaction?.platformKind === 'exchange') {
    return 'exchange to exchange';
  }

  return link.linkType.replace(/_/g, ' ');
}

export function formatProposalRoute(proposal: TransferProposalWithTransactions): string {
  const sourceNames = uniqueNonEmptyValues(proposal.legs.map((leg) => leg.sourceTransaction?.platformKey ?? 'unknown'));
  const targetNames = uniqueNonEmptyValues(proposal.legs.map((leg) => leg.targetTransaction?.platformKey ?? 'unknown'));

  return `${formatProposalEndpoint(sourceNames)} → ${formatProposalEndpoint(targetNames)}`;
}

export function formatProposalConfidence(proposal: TransferProposalWithTransactions): string {
  const confidenceValues = proposal.legs.map((leg) => leg.link.confidenceScore.toNumber());
  const min = Math.min(...confidenceValues);
  const max = Math.max(...confidenceValues);

  if (Math.abs(max - min) < 0.000001) {
    return formatConfidenceScore(max);
  }

  return `${(min * 100).toFixed(1)}-${(max * 100).toFixed(1)}%`;
}

export function getProposalConfidenceColor(proposal: TransferProposalWithTransactions): string {
  const confidenceValues = proposal.legs.map((leg) => leg.link.confidenceScore.toNumber());
  return getConfidenceColor(Math.min(...confidenceValues));
}

export function formatProposalProvenance(summary: LinkProposalProvenanceSummary): string {
  switch (summary.provenance) {
    case 'system':
      return 'system';
    case 'user':
      return 'user';
    case 'manual':
      return 'manual';
    case 'mixed':
      return 'mixed';
  }
}

export function formatProposalProvenanceDetail(summary: LinkProposalProvenanceSummary): string | undefined {
  if (summary.provenance === 'system' && summary.overrideIds.length === 0) {
    return undefined;
  }

  const provenanceParts = [
    summary.userLegCount > 0
      ? `${summary.userLegCount} user-reviewed ${summary.userLegCount === 1 ? 'leg' : 'legs'}`
      : undefined,
    summary.manualLegCount > 0
      ? `${summary.manualLegCount} manual ${summary.manualLegCount === 1 ? 'leg' : 'legs'}`
      : undefined,
    summary.provenance === 'mixed' && summary.systemLegCount > 0
      ? `${summary.systemLegCount} system ${summary.systemLegCount === 1 ? 'leg' : 'legs'}`
      : undefined,
  ].filter((value): value is string => value !== undefined);

  const overrideLabel = summary.overrideIds.length === 1 ? 'override' : 'overrides';
  const typeSummary =
    summary.overrideLinkTypes.length === 0
      ? undefined
      : `${summary.overrideLinkTypes.join(', ')} ${summary.overrideLinkTypes.length === 1 ? 'type' : 'types'}`;

  return [
    ...provenanceParts,
    ...(summary.overrideIds.length > 0 ? [`${summary.overrideIds.length} ${overrideLabel}`] : []),
    typeSummary,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' · ');
}

export function getProposalAmountDisplay(proposal: TransferProposalWithTransactions): LinkAmountDisplay {
  const link = proposal.representativeLink;
  const metadata = link.metadata;

  if (proposal.legs.length > 1) {
    const totalLinkedAmount = proposal.legs.reduce((sum, leg) => sum.plus(leg.link.sourceAmount), new Decimal(0));
    const sameHashSummary =
      isSameHashExternalLinkMetadata(metadata) &&
      metadata.sameHashMixedExternalGroup === true &&
      typeof metadata.sameHashTrackedSiblingInflowAmount === 'string' &&
      typeof metadata.sameHashTrackedSiblingInflowCount === 'number'
        ? `same-hash mixed group: ${metadata.sameHashExternalGroupAmount} ${link.assetSymbol} to exchange after ` +
          `${metadata.sameHashTrackedSiblingInflowAmount} ${link.assetSymbol} to ${metadata.sameHashTrackedSiblingInflowCount} ` +
          `${metadata.sameHashTrackedSiblingInflowCount === 1 ? 'tracked sibling inflow' : 'tracked sibling inflows'}`
        : undefined;

    return {
      detailLabel: 'Summary:',
      linkedAmount: totalLinkedAmount.toFixed(),
      detailSummary: sameHashSummary ?? `${proposal.legs.length} linked legs between ${formatProposalRoute(proposal)}`,
    };
  }

  if (
    isSameHashExternalLinkMetadata(metadata) &&
    metadata.sameHashMixedExternalGroup === true &&
    typeof metadata.sameHashTrackedSiblingInflowAmount === 'string' &&
    typeof metadata.sameHashTrackedSiblingInflowCount === 'number'
  ) {
    const siblingLabel =
      metadata.sameHashTrackedSiblingInflowCount === 1 ? 'tracked sibling inflow' : 'tracked sibling inflows';

    return {
      detailLabel: 'Summary:',
      linkedAmount: link.sourceAmount.toFixed(),
      detailSummary:
        `same-hash mixed group: ${metadata.sameHashExternalGroupAmount} ${link.assetSymbol} to exchange after ` +
        `${metadata.sameHashTrackedSiblingInflowAmount} ${link.assetSymbol} to ${metadata.sameHashTrackedSiblingInflowCount} ${siblingLabel}`,
    };
  }

  if (isPartialMatchLinkMetadata(metadata)) {
    const consumedAmount = metadata.consumedAmount ?? link.sourceAmount.toFixed();
    const fullSourceAmount = metadata.fullSourceAmount ?? link.sourceAmount.toFixed();
    const fullTargetAmount = metadata.fullTargetAmount ?? link.targetAmount.toFixed();

    return {
      detailLabel: 'Summary:',
      linkedAmount: consumedAmount,
      detailSummary: `split match between ${fullSourceAmount} ${link.assetSymbol} sent and ${fullTargetAmount} ${link.assetSymbol} received`,
    };
  }

  if (link.sourceAmount.equals(link.targetAmount)) {
    return {
      linkedAmount: link.sourceAmount.toFixed(),
      detailSummary: undefined,
    };
  }

  if (link.sourceAmount.greaterThan(link.targetAmount)) {
    const changeAmount = link.sourceAmount.minus(link.targetAmount);
    const impliedFeeAmount = hasImpliedFeeAmount(link) ? link.impliedFeeAmount.toFixed() : changeAmount.toFixed();

    return {
      detailLabel: hasImpliedFeeAmount(link) ? 'Implied fee:' : 'Change:',
      linkedAmount: link.targetAmount.toFixed(),
      detailSummary: `${impliedFeeAmount} ${link.assetSymbol}`,
    };
  }

  return {
    detailLabel: 'Difference:',
    linkedAmount: link.sourceAmount.toFixed(),
    detailSummary: `target exceeds source by ${link.targetAmount.minus(link.sourceAmount).toFixed()} ${link.assetSymbol}`,
  };
}

function uniqueNonEmptyValues(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function formatProposalEndpoint(names: string[]): string {
  if (names.length === 0) {
    return 'unknown';
  }

  if (names.length === 1) {
    return names[0]!;
  }

  return `${names[0]!} +${names.length - 1}`;
}
