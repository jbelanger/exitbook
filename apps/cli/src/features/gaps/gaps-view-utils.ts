// Utilities and types for gaps view command

import type { TransactionLink } from '@exitbook/accounting';
import type { UniversalTransactionData } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type { CommonViewFilters } from '../shared/view-utils.js';

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
export type GapsViewResult =
  | {
      analysis: FeeGapAnalysis;
      category: 'fees';
    }
  | {
      analysis: LinkGapAnalysis;
      category: 'links';
    };

/**
 * Link gap issue details.
 */
export type LinkGapDirection = 'inflow' | 'outflow';

export interface LinkGapIssue {
  transactionId: number;
  externalId: string;
  source: string;
  blockchain?: string | undefined;
  timestamp: string;
  asset: string;
  missingAmount: string;
  totalAmount: string;
  confirmedCoveragePercent: string;
  operationCategory: string;
  operationType: string;
  suggestedCount: number;
  highestSuggestedConfidencePercent?: string | undefined;
  direction: LinkGapDirection;
}

/**
 * Link gap summary per asset.
 */
export interface LinkGapAssetSummary {
  asset: string;
  inflowOccurrences: number;
  inflowMissingAmount: string;
  outflowOccurrences: number;
  outflowMissingAmount: string;
}

/**
 * Link gap analysis result.
 */
export interface LinkGapAnalysis {
  issues: LinkGapIssue[];
  summary: {
    affected_assets: number;
    assets: LinkGapAssetSummary[];
    total_issues: number;
    uncovered_inflows: number;
    unmatched_outflows: number;
  };
}

/**
 * Analyze transactions for fee-related gaps.
 */
export function analyzeFeeGaps(transactions: UniversalTransactionData[]): FeeGapAnalysis {
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
function detectFeeIssuesInTransaction(tx: UniversalTransactionData): FeeGapIssue[] {
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
 * Analyze transactions for missing link coverage.
 *
 * Flags blockchain inflows with no confirmed provenance and transfer outflows
 * (blockchain or exchange) that lack a confirmed destination.
 */
export function analyzeLinkGaps(transactions: UniversalTransactionData[], links: TransactionLink[]): LinkGapAnalysis {
  const confirmedLinksByTarget = new Map<number, TransactionLink[]>();
  const confirmedLinksBySource = new Map<number, TransactionLink[]>();
  const suggestedLinksByTarget = new Map<number, TransactionLink[]>();
  const suggestedLinksBySource = new Map<number, TransactionLink[]>();

  const pushToMap = (map: Map<number, TransactionLink[]>, key: number, link: TransactionLink) => {
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(link);
  };

  for (const link of links) {
    if (link.status === 'confirmed') {
      pushToMap(confirmedLinksByTarget, link.targetTransactionId, link);
      pushToMap(confirmedLinksBySource, link.sourceTransactionId, link);
    } else if (link.status === 'suggested') {
      pushToMap(suggestedLinksByTarget, link.targetTransactionId, link);
      pushToMap(suggestedLinksBySource, link.sourceTransactionId, link);
    }
  }

  const issues: LinkGapIssue[] = [];
  const assetTotals = new Map<
    string,
    {
      inflow: { missingAmount: Decimal; occurrences: number };
      outflow: { missingAmount: Decimal; occurrences: number };
    }
  >();

  const getOrCreateAssetTotals = (assetKey: string) => {
    if (!assetTotals.has(assetKey)) {
      assetTotals.set(assetKey, {
        inflow: { missingAmount: new Decimal(0), occurrences: 0 },
        outflow: { missingAmount: new Decimal(0), occurrences: 0 },
      });
    }
    return assetTotals.get(assetKey)!;
  };

  const mintingTypes = new Set(['reward', 'airdrop']);

  for (const tx of transactions) {
    const isBlockchainTx = Boolean(tx.blockchain);
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];

    // --- Inflow analysis (missing provenance) ---
    if (isBlockchainTx && inflows.length > 0 && outflows.length === 0 && !mintingTypes.has(tx.operation.type)) {
      const inflowTotals = new Map<string, Decimal>();

      for (const inflow of inflows) {
        const amount = inflow.netAmount ?? inflow.grossAmount;
        if (!amount || amount.lte(0)) {
          continue;
        }

        const assetKey = inflow.asset.toUpperCase();
        const current = inflowTotals.get(assetKey) ?? new Decimal(0);
        inflowTotals.set(assetKey, current.plus(amount));
      }

      for (const [assetKey, totalAmount] of inflowTotals.entries()) {
        const confirmedForTx = (confirmedLinksByTarget.get(tx.id) ?? []).filter(
          (link) => link.asset.toUpperCase() === assetKey
        );

        const confirmedAmount = confirmedForTx.reduce((sum, link) => sum.plus(link.targetAmount), new Decimal(0));

        if (confirmedAmount.greaterThanOrEqualTo(totalAmount)) {
          continue;
        }

        const uncoveredAmount = totalAmount.minus(confirmedAmount);

        if (uncoveredAmount.lte(0)) {
          continue;
        }

        const suggestedForTx = (suggestedLinksByTarget.get(tx.id) ?? []).filter(
          (link) => link.asset.toUpperCase() === assetKey
        );

        let highestSuggestedConfidencePercent: string | undefined;
        if (suggestedForTx.length > 0) {
          let highestConfidence = suggestedForTx[0]!.confidenceScore;
          for (const link of suggestedForTx) {
            if (link.confidenceScore.greaterThan(highestConfidence)) {
              highestConfidence = link.confidenceScore;
            }
          }
          highestSuggestedConfidencePercent = highestConfidence.times(100).toFixed();
        }

        const coveragePercent = totalAmount.isZero()
          ? new Decimal(0)
          : confirmedAmount.dividedBy(totalAmount).times(100);

        issues.push({
          transactionId: tx.id ?? 0,
          externalId: tx.externalId,
          source: tx.source,
          blockchain: tx.blockchain?.name,
          timestamp: tx.datetime,
          asset: assetKey,
          missingAmount: uncoveredAmount.toFixed(),
          totalAmount: totalAmount.toFixed(),
          confirmedCoveragePercent: coveragePercent.toFixed(),
          operationCategory: tx.operation.category,
          operationType: tx.operation.type,
          suggestedCount: suggestedForTx.length,
          highestSuggestedConfidencePercent,
          direction: 'inflow',
        });

        const totals = getOrCreateAssetTotals(assetKey);
        totals.inflow.occurrences++;
        totals.inflow.missingAmount = totals.inflow.missingAmount.plus(uncoveredAmount);
      }
    }

    // --- Outflow analysis (missing destination wallet) ---
    const isTransferSend =
      tx.operation.category === 'transfer' && (tx.operation.type === 'withdrawal' || tx.operation.type === 'transfer');

    if (outflows.length > 0 && inflows.length === 0 && isTransferSend) {
      const outflowTotals = new Map<string, Decimal>();

      for (const outflow of outflows) {
        const amount = outflow.netAmount ?? outflow.grossAmount;
        if (!amount || amount.lte(0)) {
          continue;
        }

        const assetKey = outflow.asset.toUpperCase();
        const current = outflowTotals.get(assetKey) ?? new Decimal(0);
        outflowTotals.set(assetKey, current.plus(amount));
      }

      for (const [assetKey, totalAmount] of outflowTotals.entries()) {
        const confirmedForTx = (confirmedLinksBySource.get(tx.id) ?? []).filter(
          (link) => link.asset.toUpperCase() === assetKey
        );

        const confirmedAmount = confirmedForTx.reduce((sum, link) => sum.plus(link.sourceAmount), new Decimal(0));

        if (confirmedAmount.greaterThanOrEqualTo(totalAmount)) {
          continue;
        }

        const uncoveredAmount = totalAmount.minus(confirmedAmount);

        if (uncoveredAmount.lte(0)) {
          continue;
        }

        const suggestedForTx = (suggestedLinksBySource.get(tx.id) ?? []).filter(
          (link) => link.asset.toUpperCase() === assetKey
        );

        let highestSuggestedConfidencePercent: string | undefined;
        if (suggestedForTx.length > 0) {
          let highestConfidence = suggestedForTx[0]!.confidenceScore;
          for (const link of suggestedForTx) {
            if (link.confidenceScore.greaterThan(highestConfidence)) {
              highestConfidence = link.confidenceScore;
            }
          }
          highestSuggestedConfidencePercent = highestConfidence.times(100).toFixed();
        }

        const coveragePercent = totalAmount.isZero()
          ? new Decimal(0)
          : confirmedAmount.dividedBy(totalAmount).times(100);

        issues.push({
          transactionId: tx.id ?? 0,
          externalId: tx.externalId,
          source: tx.source,
          blockchain: tx.blockchain?.name,
          timestamp: tx.datetime,
          asset: assetKey,
          missingAmount: uncoveredAmount.toFixed(),
          totalAmount: totalAmount.toFixed(),
          confirmedCoveragePercent: coveragePercent.toFixed(),
          operationCategory: tx.operation.category,
          operationType: tx.operation.type,
          suggestedCount: suggestedForTx.length,
          highestSuggestedConfidencePercent,
          direction: 'outflow',
        });

        const totals = getOrCreateAssetTotals(assetKey);
        totals.outflow.occurrences++;
        totals.outflow.missingAmount = totals.outflow.missingAmount.plus(uncoveredAmount);
      }
    }
  }

  const inflowIssueCount = issues.reduce((count, issue) => (issue.direction === 'inflow' ? count + 1 : count), 0);
  const outflowIssueCount = issues.length - inflowIssueCount;

  const assetSummaries: LinkGapAssetSummary[] = Array.from(assetTotals.entries())
    .map(([asset, data]) => ({
      asset,
      inflowOccurrences: data.inflow.occurrences,
      inflowMissingAmount: data.inflow.missingAmount.toFixed(),
      outflowOccurrences: data.outflow.occurrences,
      outflowMissingAmount: data.outflow.missingAmount.toFixed(),
    }))
    .filter((summary) => summary.inflowOccurrences > 0 || summary.outflowOccurrences > 0)
    .sort((a, b) => {
      const aTotal = a.inflowOccurrences + a.outflowOccurrences;
      const bTotal = b.inflowOccurrences + b.outflowOccurrences;
      return bTotal - aTotal || a.asset.localeCompare(b.asset);
    });

  return {
    issues,
    summary: {
      total_issues: issues.length,
      uncovered_inflows: inflowIssueCount,
      unmatched_outflows: outflowIssueCount,
      affected_assets: assetSummaries.length,
      assets: assetSummaries,
    },
  };
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
    case 'links':
      return formatLinkGapAnalysis(result.analysis);
    default:
      return `Category '${(result as { category: string }).category}' analysis not yet implemented.`;
  }
}

/**
 * Format link gap analysis for text display.
 */
export function formatLinkGapAnalysis(analysis: LinkGapAnalysis): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Link Gap Analysis:');
  lines.push('=============================');
  lines.push('');
  lines.push(`Uncovered Inflows: ${analysis.summary.uncovered_inflows}`);
  lines.push(`Unmatched Outflows: ${analysis.summary.unmatched_outflows}`);
  lines.push(`Assets Affected: ${analysis.summary.affected_assets}`);
  lines.push('');

  if (analysis.summary.assets.length > 0) {
    lines.push('By Asset:');
    for (const assetSummary of analysis.summary.assets) {
      if (assetSummary.inflowOccurrences > 0) {
        lines.push(
          `  ${assetSummary.asset}: ${assetSummary.inflowOccurrences} inflow(s) missing ${assetSummary.inflowMissingAmount} ${assetSummary.asset}`
        );
      }
      if (assetSummary.outflowOccurrences > 0) {
        lines.push(
          `  ${assetSummary.asset}: ${assetSummary.outflowOccurrences} outflow(s) unmatched for ${assetSummary.outflowMissingAmount} ${assetSummary.asset}`
        );
      }
    }
    lines.push('');
  }

  if (analysis.issues.length === 0) {
    lines.push('All movements have confirmed counterparties. ✅');
  } else {
    lines.push('Uncovered Movements:');
    lines.push('-----------------------------');
    for (const issue of analysis.issues) {
      lines.push('');
      const directionLabel = issue.direction === 'inflow' ? 'IN' : 'OUT';
      lines.push(
        `[${issue.asset}][${directionLabel}] TX #${issue.transactionId} (${issue.blockchain ?? issue.source})`
      );
      lines.push(`  Time: ${issue.timestamp}`);
      const movementLabel = issue.direction === 'inflow' ? 'inflow' : 'outflow';
      lines.push(
        `  Missing: ${issue.missingAmount} ${issue.asset} of ${issue.totalAmount} ${issue.asset} ${movementLabel}`
      );
      lines.push(`  Confirmed Coverage: ${issue.confirmedCoveragePercent}%`);
      lines.push(`  Operation: ${issue.operationCategory}/${issue.operationType}`);
      if (issue.suggestedCount > 0) {
        lines.push(
          `  Suggested Matches: ${issue.suggestedCount}${
            issue.highestSuggestedConfidencePercent
              ? ` (best ${issue.highestSuggestedConfidencePercent}% confidence)`
              : ''
          }`
        );
      } else {
        lines.push('  Suggested Matches: none');
      }
      if (issue.direction === 'inflow') {
        lines.push('  Action: Run `exitbook links run` then confirm matches to bridge this gap.');
      } else {
        lines.push(
          '  Action: Identify the destination wallet or confirm a link; otherwise this may be treated as a gift.'
        );
      }
    }
  }

  lines.push('');
  lines.push('=============================');

  return lines.join('\n');
}
