// Utilities and types for links view command

import type { LinkStatus, MatchCriteria } from '@exitbook/core';
import type { AssetMovementDraft, Transaction, TransactionLink } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { CommonViewFilters } from '../../shared/view-utils.js';

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
  tx_fingerprint: string;
  from_address: string | undefined;
  id: number;
  movements_inflows: AssetMovementDraft[];
  movements_outflows: AssetMovementDraft[];
  platform_key: string;
  source_type: Transaction['sourceType'];
  timestamp: string;
  to_address: string | undefined;
}

/**
 * Link info for display (with transaction details).
 */
export interface LinkInfo {
  id: number;
  source_transaction_id: number;
  target_transaction_id: number;
  asset_symbol: string;
  source_amount: string;
  target_amount: string;
  link_type: string;
  confidence_score: string;
  match_criteria: MatchCriteria;
  status: LinkStatus;
  reviewed_by: string | undefined;
  reviewed_at: string | undefined;
  created_at: string;
  updated_at: string;
  source_timestamp?: string | undefined;
  target_timestamp?: string | undefined;
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
 * Map Transaction to TransactionDetails for display.
 */
export function mapTransactionToDetails(tx: Transaction): TransactionDetails {
  return {
    tx_fingerprint: tx.txFingerprint,
    from_address: tx.from,
    id: tx.id,
    movements_inflows: tx.movements?.inflows ?? [],
    movements_outflows: tx.movements?.outflows ?? [],
    platform_key: tx.source,
    source_type: tx.sourceType,
    timestamp: tx.datetime,
    to_address: tx.to,
  };
}

/**
 * Format link info with optional transaction details.
 */
export function formatLinkInfo(link: TransactionLink, sourceTx?: Transaction, targetTx?: Transaction): LinkInfo {
  const linkInfo: LinkInfo = {
    id: link.id,
    source_transaction_id: link.sourceTransactionId,
    target_transaction_id: link.targetTransactionId,
    asset_symbol: link.assetSymbol,
    source_amount: link.sourceAmount.toFixed(),
    target_amount: link.targetAmount.toFixed(),
    link_type: link.linkType,
    confidence_score: link.confidenceScore.toFixed(),
    match_criteria: link.matchCriteria,
    status: link.status,
    reviewed_by: link.reviewedBy,
    reviewed_at: link.reviewedAt?.toISOString(),
    created_at: link.createdAt.toISOString(),
    updated_at: link.updatedAt.toISOString(),
    source_timestamp: sourceTx?.datetime,
    target_timestamp: targetTx?.datetime,
  };

  // Add full transaction details if provided (for verbose mode)
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
function getLinkStatusIcon(status: LinkStatus): string {
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
function formatConfidence(confidence: string | Decimal): string {
  const score = typeof confidence === 'string' ? parseFloat(confidence) : confidence.toNumber();
  return `${(score * 100).toFixed(1)}%`;
}

/**
 * Format match criteria for display.
 */
function formatMatchCriteria(criteria: MatchCriteria): string {
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
function formatMovements(inflows: AssetMovementDraft[], outflows: AssetMovementDraft[]): string {
  const parts: string[] = [];

  if (outflows.length > 0) {
    const outStr = outflows.map((m) => `${m.grossAmount.toFixed()} ${m.assetSymbol}`).join(', ');
    parts.push(`OUT: ${outStr}`);
  }

  if (inflows.length > 0) {
    const inStr = inflows.map((m) => `${m.grossAmount.toFixed()} ${m.assetSymbol}`).join(', ');
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
  lines.push(`      ID: #${tx.id} | Source: ${tx.platform_key}`);
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
  const linkType = formatDisplayLinkType(link);

  // Title line with asset symbol
  lines.push(
    `${statusIcon} Link #${link.id} - ${link.asset_symbol} ${linkType} (${formatConfidence(link.confidence_score)})`
  );

  // Transaction IDs and amounts
  lines.push(`   Source TX: #${link.source_transaction_id} → Target TX: #${link.target_transaction_id}`);
  lines.push(`   Amount: ${link.source_amount} ${link.asset_symbol} → ${link.target_amount} ${link.asset_symbol}`);

  // Transaction timestamps (always show if available)
  if (link.source_timestamp || link.target_timestamp) {
    const sourceTime = link.source_timestamp ?? '?';
    const targetTime = link.target_timestamp ?? '?';
    lines.push(`   Time: ${sourceTime} → ${targetTime}`);
  }

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

function formatDisplayLinkType(link: LinkInfo): string {
  const sourceType = link.source_transaction?.source_type;
  const targetType = link.target_transaction?.source_type;

  if (sourceType === 'blockchain' && targetType === 'exchange') {
    return 'blockchain to exchange';
  }

  if (sourceType === 'exchange' && targetType === 'blockchain') {
    return 'exchange to blockchain';
  }

  if (sourceType === 'blockchain' && targetType === 'blockchain') {
    return link.link_type === 'blockchain_internal' ? 'blockchain internal' : 'blockchain to blockchain';
  }

  if (sourceType === 'exchange' && targetType === 'exchange') {
    return 'exchange to exchange';
  }

  return link.link_type.replace(/_/g, ' ');
}
