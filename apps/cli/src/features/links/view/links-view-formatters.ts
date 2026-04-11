import type { LinkGapIssue } from '@exitbook/accounting/linking';
import {
  hasImpliedFeeAmount,
  isPartialMatchLinkMetadata,
  isSameHashExternalLinkMetadata,
  type LinkStatus,
  type MatchCriteria,
  type TransactionLink,
} from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type { LinkWithTransactions, TransferProposalWithTransactions } from '../links-view-model.js';

export interface LinkAmountDisplay {
  detailLabel?: string | undefined;
  detailSummary?: string | undefined;
  matchedAmount: string;
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

export function getProposalAmountDisplay(proposal: TransferProposalWithTransactions): LinkAmountDisplay {
  const link = proposal.representativeLink;
  const metadata = link.metadata;

  if (proposal.legs.length > 1) {
    const totalMatchedAmount = proposal.legs.reduce((sum, leg) => sum.plus(leg.link.sourceAmount), new Decimal(0));
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
      matchedAmount: totalMatchedAmount.toFixed(),
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
      matchedAmount: link.sourceAmount.toFixed(),
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
      matchedAmount: consumedAmount,
      detailSummary: `split match between ${fullSourceAmount} ${link.assetSymbol} sent and ${fullTargetAmount} ${link.assetSymbol} received`,
    };
  }

  if (link.sourceAmount.equals(link.targetAmount)) {
    return {
      matchedAmount: link.sourceAmount.toFixed(),
      detailSummary: undefined,
    };
  }

  if (link.sourceAmount.greaterThan(link.targetAmount)) {
    const changeAmount = link.sourceAmount.minus(link.targetAmount);
    const impliedFeeAmount = hasImpliedFeeAmount(link) ? link.impliedFeeAmount.toFixed() : changeAmount.toFixed();

    return {
      detailLabel: hasImpliedFeeAmount(link) ? 'Implied fee:' : 'Change:',
      matchedAmount: link.targetAmount.toFixed(),
      detailSummary: `${impliedFeeAmount} ${link.assetSymbol}`,
    };
  }

  return {
    detailLabel: 'Difference:',
    matchedAmount: link.sourceAmount.toFixed(),
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
