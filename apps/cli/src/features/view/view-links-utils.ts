// Utilities and types for view links command

import type { LinkStatus, MatchCriteria } from '@exitbook/accounting';
import type { AssetMovement } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { CommonViewFilters } from './view-utils.ts';

/**
 * Parameters for view links command.
 */
export interface ViewLinksParams extends CommonViewFilters {
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
  source_id: string;
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
 * Result of view links command.
 */
export interface ViewLinksResult {
  links: LinkInfo[];
  count: number;
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
    const outStr = outflows.map((m) => `${m.amount.toFixed()} ${m.asset}`).join(', ');
    parts.push(`OUT: ${outStr}`);
  }

  if (inflows.length > 0) {
    const inStr = inflows.map((m) => `${m.amount.toFixed()} ${m.asset}`).join(', ');
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
  lines.push(`      ID: #${tx.id} | Source: ${tx.source_id}`);
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
