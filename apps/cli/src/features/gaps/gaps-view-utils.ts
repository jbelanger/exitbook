// Utilities and types for gaps view command

import type { UniversalTransaction } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { CommonViewFilters } from '../shared/view-utils.ts';

/**
 * Gap category types for filtering.
 */
export type GapCategory = 'fees' | 'prices' | 'links' | 'validation';

/**
 * Parameters for gaps view command.
 */
export interface GapsViewParams extends CommonViewFilters {
  category?: GapCategory | undefined;
}

/**
 * Fee gap issue types.
 */
export type FeeGapType =
  | 'outflow_without_fee_field' // Outflow that could be a fee but isn't in fee fields
  | 'fee_without_price' // Fee movement without price data
  | 'missing_fee_fields' // Transaction has fees but both network and platform are empty
  | 'fee_in_movements'; // Fee amount found in movements instead of fee fields

/**
 * Individual fee gap issue.
 */
export interface FeeGapIssue {
  transaction_id: number;
  external_id: string;
  source: string;
  timestamp: string;
  issue_type: FeeGapType;
  description: string;
  asset?: string | undefined;
  amount?: string | undefined;
  suggestion?: string | undefined;
}

/**
 * Fee gap analysis result.
 */
export interface FeeGapAnalysis {
  issues: FeeGapIssue[];
  summary: {
    affected_transactions: number;
    by_type: Record<FeeGapType, number>;
    total_issues: number;
  };
}

/**
 * Result of gaps view command.
 */
export interface GapsViewResult {
  category: GapCategory;
  analysis: FeeGapAnalysis;
}

/**
 * Analyze transactions for fee-related gaps.
 */
export function analyzeFeeGaps(transactions: UniversalTransaction[]): FeeGapAnalysis {
  const issues: FeeGapIssue[] = [];
  const affectedTransactionIds = new Set<number>();

  for (const tx of transactions) {
    const txIssues = detectFeeIssuesInTransaction(tx);
    issues.push(...txIssues);
    if (txIssues.length > 0 && tx.id) {
      affectedTransactionIds.add(tx.id);
    }
  }

  // Build summary by type
  const byType: Record<FeeGapType, number> = {
    outflow_without_fee_field: 0,
    fee_without_price: 0,
    missing_fee_fields: 0,
    fee_in_movements: 0,
  };

  for (const issue of issues) {
    byType[issue.issue_type]++;
  }

  return {
    issues,
    summary: {
      total_issues: issues.length,
      by_type: byType,
      affected_transactions: affectedTransactionIds.size,
    },
  };
}

/**
 * Detect fee-related issues in a single transaction.
 */
function detectFeeIssuesInTransaction(tx: UniversalTransaction): FeeGapIssue[] {
  const issues: FeeGapIssue[] = [];

  // Check if fees exist in fee fields
  const networkFee = tx.fees?.find((fee) => fee.scope === 'network');
  const platformFee = tx.fees?.find((fee) => fee.scope === 'platform');
  const hasNetworkFee = networkFee !== undefined;
  const hasPlatformFee = platformFee !== undefined;
  const hasFeeFields = hasNetworkFee || hasPlatformFee;

  // Check for fee movements without prices
  if (hasNetworkFee && !networkFee?.priceAtTxTime) {
    issues.push({
      transaction_id: tx.id ?? 0,
      external_id: tx.externalId,
      source: tx.source,
      timestamp: tx.datetime,
      issue_type: 'fee_without_price',
      description: 'Network fee exists but has no price data',
      asset: networkFee?.asset,
      amount: networkFee?.amount.toFixed(),
      suggestion: 'Run `exitbook prices fetch` to populate missing prices',
    });
  }

  if (hasPlatformFee && !platformFee?.priceAtTxTime) {
    issues.push({
      transaction_id: tx.id ?? 0,
      external_id: tx.externalId,
      source: tx.source,
      timestamp: tx.datetime,
      issue_type: 'fee_without_price',
      description: 'Platform fee exists but has no price data',
      asset: platformFee?.asset,
      amount: platformFee?.amount.toFixed(),
      suggestion: 'Run `exitbook prices fetch` to populate missing prices',
    });
  }

  // Check for outflows that might be fees but aren't in fee fields
  // (Look for small outflows without corresponding inflows that could be fees)
  const outflows = tx.movements?.outflows ?? [];
  const inflows = tx.movements?.inflows ?? [];

  if (!hasFeeFields && outflows.length > 0 && inflows.length === 0) {
    // Transaction has only outflows and no fee fields - might be a fee transaction
    if (tx.operation.category === 'fee' || tx.operation.type === 'fee') {
      issues.push({
        transaction_id: tx.id ?? 0,
        external_id: tx.externalId,
        source: tx.source,
        timestamp: tx.datetime,
        issue_type: 'missing_fee_fields',
        description: 'Transaction classified as fee but has no fee fields populated',
        suggestion: 'Review processor to ensure fees are mapped to fee.network or fee.platform fields',
      });
    }
  }

  // Check for outflows that have "fee" in metadata or notes
  for (const outflow of outflows) {
    // Check if this outflow is already in fee fields
    const isInFeeFields =
      (hasNetworkFee && isSameMovement(outflow, networkFee)) ||
      (hasPlatformFee && isSameMovement(outflow, platformFee));

    if (!isInFeeFields) {
      // This outflow is not in fee fields - check if it should be
      // Look for hints in transaction notes or metadata
      const noteText = tx.note?.message?.toLowerCase() ?? '';
      const hasFeeHint = noteText.includes('fee') || noteText.includes('cost');

      if (hasFeeHint) {
        issues.push({
          transaction_id: tx.id ?? 0,
          external_id: tx.externalId,
          source: tx.source,
          timestamp: tx.datetime,
          issue_type: 'fee_in_movements',
          description: 'Transaction note mentions fees but movement is not in fee fields',
          asset: outflow.asset,
          amount: outflow.grossAmount.toFixed(),
          suggestion: 'Review processor to map this outflow to appropriate fee field',
        });
      }
    }
  }

  return issues;
}

/**
 * Check if two movements represent the same asset movement.
 */
function isSameMovement(
  movement: { asset: string; grossAmount: Decimal },
  feeMovement: { amount: Decimal; asset: string } | undefined
): boolean {
  if (!feeMovement) return false;
  return movement.asset === feeMovement.asset && movement.grossAmount.equals(feeMovement.amount);
}

/**
 * Format fee gap analysis for text display.
 */
export function formatFeeGapAnalysis(analysis: FeeGapAnalysis): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Fee Gap Analysis:');
  lines.push('=============================');
  lines.push('');

  // Summary
  lines.push(`Total Issues: ${analysis.summary.total_issues}`);
  lines.push(`Affected Transactions: ${analysis.summary.affected_transactions}`);
  lines.push('');

  // By type
  lines.push('Issues by Type:');
  for (const [type, count] of Object.entries(analysis.summary.by_type)) {
    if (count > 0) {
      lines.push(`  ${getFeeGapTypeLabel(type as FeeGapType)}: ${count}`);
    }
  }
  lines.push('');

  // Detailed issues
  if (analysis.issues.length === 0) {
    lines.push('No fee gaps found. All transactions have properly mapped fees.');
  } else {
    lines.push('Detailed Issues:');
    lines.push('-----------------------------');
    for (const issue of analysis.issues) {
      lines.push('');
      lines.push(formatFeeGapIssue(issue));
    }
  }

  lines.push('');
  lines.push('=============================');

  return lines.join('\n');
}

/**
 * Get human-readable label for fee gap type.
 */
function getFeeGapTypeLabel(type: FeeGapType): string {
  switch (type) {
    case 'outflow_without_fee_field':
      return 'Outflows not mapped to fee fields';
    case 'fee_without_price':
      return 'Fees without price data';
    case 'missing_fee_fields':
      return 'Fee transactions with empty fee fields';
    case 'fee_in_movements':
      return 'Fees in movements instead of fee fields';
    default:
      return type;
  }
}

/**
 * Format a single fee gap issue for display.
 */
function formatFeeGapIssue(issue: FeeGapIssue): string {
  const lines: string[] = [];

  lines.push(`[${issue.issue_type.toUpperCase()}] TX #${issue.transaction_id}`);
  lines.push(`  Source: ${issue.source}`);
  lines.push(`  External ID: ${issue.external_id}`);
  lines.push(`  Time: ${issue.timestamp}`);
  lines.push(`  Issue: ${issue.description}`);

  if (issue.asset && issue.amount) {
    lines.push(`  Amount: ${issue.amount} ${issue.asset}`);
  }

  if (issue.suggestion) {
    lines.push(`  💡 Suggestion: ${issue.suggestion}`);
  }

  return lines.join('\n');
}

/**
 * Format gaps view result for text display.
 */
export function formatGapsViewResult(result: GapsViewResult): string {
  switch (result.category) {
    case 'fees':
      return formatFeeGapAnalysis(result.analysis);
    default:
      return `Category '${result.category}' analysis not yet implemented.`;
  }
}
