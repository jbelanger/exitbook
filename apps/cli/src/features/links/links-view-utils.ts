// Utilities and types for links view command

import type { LinkStatus, MatchCriteria, TransactionLink } from '@exitbook/accounting';
import type { AssetMovement, UniversalTransactionData } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { CommonViewFilters } from '../shared/view-utils.js';

/**
 * Parameters for links view command.
 */
export interface LinksViewParams extends CommonViewFilters {
  status?: LinkStatus | undefined;
  minConfidence?: number | undefined;
  maxConfidence?: number | undefined;
  verbose?: boolean | undefined;
}

/**
 * Transaction details for verbose display.
 */
export interface TransactionDetails {
  external_id: string | undefined;
  from_address: string | undefined;
  id: number;
  movements_inflows: AssetMovement[];
  movements_outflows: AssetMovement[];
  source_name: string;
  timestamp: string;
  to_address: string | undefined;
}

/**
 * Link info for display (with transaction details).
 */
export interface LinkInfo {
  id: string;
  source_transaction_id: number;
  target_transaction_id: number;
  link_type: string;
  confidence_score: string;
  match_criteria: MatchCriteria;
  status: LinkStatus;
  reviewed_by: string | undefined;
  reviewed_at: string | undefined;
  created_at: string;
  updated_at: string;
  source_transaction?: TransactionDetails | undefined;
  target_transaction?: TransactionDetails | undefined;
}

/**
 * Result of links view command.
 */
export interface LinksViewResult {
  links: LinkInfo[];
  count: number;
}

/**
 * Filter links by confidence score range.
 */
export function filterLinksByConfidence(
  links: TransactionLink[],
  minConfidence?: number,
  maxConfidence?: number
): TransactionLink[] {
  return links.filter((link) => {
    const score = link.confidenceScore.toNumber();

    if (minConfidence !== undefined && score < minConfidence) {
      return false;
    }

    if (maxConfidence !== undefined && score > maxConfidence) {
      return false;
    }

    return true;
  });
}

/**
 * Map UniversalTransactionData to TransactionDetails for display.
 */
export function mapTransactionToDetails(tx: UniversalTransactionData): TransactionDetails {
  return {
    external_id: tx.externalId ?? undefined,
    from_address: tx.from ?? undefined,
    id: tx.id ?? 0,
    movements_inflows: tx.movements?.inflows ?? [],
    movements_outflows: tx.movements?.outflows ?? [],
    source_name: tx.source,
    timestamp: tx.datetime,
    to_address: tx.to ?? undefined,
  };
}

/**
 * Format link info with optional transaction details.
 */
export function formatLinkInfo(
  link: TransactionLink,
  sourceTx?: UniversalTransactionData,
  targetTx?: UniversalTransactionData
): LinkInfo {
  const linkInfo: LinkInfo = {
    id: link.id,
    source_transaction_id: link.sourceTransactionId,
    target_transaction_id: link.targetTransactionId,
    link_type: link.linkType,
    confidence_score: link.confidenceScore.toFixed(),
    match_criteria: link.matchCriteria,
    status: link.status,
    reviewed_by: link.reviewedBy,
    reviewed_at: link.reviewedAt?.toISOString(),
    created_at: link.createdAt.toISOString(),
    updated_at: link.updatedAt.toISOString(),
  };

  // Add transaction details if provided
  if (sourceTx) {
    linkInfo.source_transaction = mapTransactionToDetails(sourceTx);
  }

  if (targetTx) {
    linkInfo.target_transaction = mapTransactionToDetails(targetTx);
  }

  return linkInfo;
}

/**
 * Get status icon for link.
 */
export function getLinkStatusIcon(status: LinkStatus): string {
  switch (status) {
    case 'confirmed':
      return '✓';
    case 'suggested':
      return '⚠';
    case 'rejected':
      return '✗';
    default:
      return '•';
  }
}

/**
 * Format confidence score as percentage.
 */
export function formatConfidence(confidence: string | Decimal): string {
  const score = typeof confidence === 'string' ? parseFloat(confidence) : confidence.toNumber();
  return `${(score * 100).toFixed(1)}%`;
}

/**
 * Format match criteria for display.
 */
export function formatMatchCriteria(criteria: MatchCriteria): string {
  const parts: string[] = [];

  if (criteria.assetMatch) {
    parts.push('asset');
  }

  const amountSimilarity =
    typeof criteria.amountSimilarity === 'string'
      ? parseFloat(criteria.amountSimilarity)
      : criteria.amountSimilarity.toNumber();
  parts.push(`amount ${(amountSimilarity * 100).toFixed(1)}%`);

  if (criteria.timingValid) {
    parts.push(`timing ${criteria.timingHours.toFixed(1)}h`);
  }

  if (criteria.addressMatch) {
    parts.push('address');
  }

  return parts.join(', ');
}

/**
 * Format transaction movements for display.
 */
function formatMovements(inflows: AssetMovement[], outflows: AssetMovement[]): string {
  const parts: string[] = [];

  if (outflows.length > 0) {
    const outStr = outflows.map((m) => `${m.grossAmount.toFixed()} ${m.asset}`).join(', ');
    parts.push(`OUT: ${outStr}`);
  }

  if (inflows.length > 0) {
    const inStr = inflows.map((m) => `${m.grossAmount.toFixed()} ${m.asset}`).join(', ');
    parts.push(`IN: ${inStr}`);
  }

  return parts.join(' | ');
}

/**
 * Format transaction details for display.
 */
function formatTransactionDetails(tx: TransactionDetails, label: string): string[] {
  const lines: string[] = [];

  lines.push(`   ${label}:`);
  lines.push(`      ID: #${tx.id} | Source: ${tx.source_name}`);
  lines.push(`      Time: ${tx.timestamp}`);
  lines.push(`      Movement: ${formatMovements(tx.movements_inflows, tx.movements_outflows)}`);

  if (tx.from_address || tx.to_address) {
    const addressInfo: string[] = [];
    if (tx.from_address) addressInfo.push(`From: ${tx.from_address.slice(0, 12)}...`);
    if (tx.to_address) addressInfo.push(`To: ${tx.to_address.slice(0, 12)}...`);
    lines.push(`      ${addressInfo.join(' | ')}`);
  }

  return lines;
}

/**
 * Format a single link for text display.
 */
export function formatLinkForDisplay(link: LinkInfo): string {
  const statusIcon = getLinkStatusIcon(link.status);
  const lines: string[] = [];

  lines.push(
    `${statusIcon} Link #${link.id.slice(0, 8)} - ${link.link_type.replace(/_/g, ' ')} (${formatConfidence(link.confidence_score)})`
  );
  lines.push(`   Source TX: #${link.source_transaction_id} → Target TX: #${link.target_transaction_id}`);
  lines.push(`   Status: ${link.status}`);
  lines.push(`   Match: ${formatMatchCriteria(link.match_criteria)}`);
  lines.push(`   Created: ${link.created_at}`);

  if (link.reviewed_by) {
    lines.push(`   Reviewed by: ${link.reviewed_by} at ${link.reviewed_at}`);
  }

  // Add transaction details if available (verbose mode)
  if (link.source_transaction) {
    lines.push('');
    lines.push(...formatTransactionDetails(link.source_transaction, 'Source Transaction'));
  }

  if (link.target_transaction) {
    lines.push('');
    lines.push(...formatTransactionDetails(link.target_transaction, 'Target Transaction'));
  }

  return lines.join('\n');
}

/**
 * Format links list for text display.
 */
export function formatLinksListForDisplay(links: LinkInfo[], count: number): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Transaction Links:');
  lines.push('=============================');
  lines.push('');

  if (links.length === 0) {
    lines.push('No links found.');
  } else {
    for (const link of links) {
      lines.push(formatLinkForDisplay(link));
      lines.push('');
    }
  }

  lines.push('=============================');
  lines.push(`Total: ${count} links`);

  return lines.join('\n');
}
