// Utilities and types for gaps view command

import type { TransactionLink } from '@exitbook/accounting';
import { parseDecimal, type UniversalTransactionData } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { CommonViewFilters } from '../shared/view-utils.js';

/**
 * Gap category types for filtering.
 */
export type GapCategory = 'prices' | 'links' | 'validation';

/**
 * Parameters for gaps view command.
 */
export interface GapsViewParams extends CommonViewFilters {
  category?: GapCategory | undefined;
}

/**
 * Result of gaps view command.
 */
export interface GapsViewResult {
  analysis: LinkGapAnalysis;
  category: 'links';
}

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
  assetSymbol: string;
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
  assetSymbol: string;
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
        inflow: { missingAmount: parseDecimal('0'), occurrences: 0 },
        outflow: { missingAmount: parseDecimal('0'), occurrences: 0 },
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

        const assetKey = inflow.assetSymbol.toUpperCase();
        const current = inflowTotals.get(assetKey) ?? parseDecimal('0');
        inflowTotals.set(assetKey, current.plus(amount));
      }

      for (const [assetKey, totalAmount] of inflowTotals.entries()) {
        const confirmedForTx = (confirmedLinksByTarget.get(tx.id) ?? []).filter(
          (link) => link.assetSymbol.toUpperCase() === assetKey
        );

        const confirmedAmount = confirmedForTx.reduce((sum, link) => sum.plus(link.targetAmount), parseDecimal('0'));

        if (confirmedAmount.greaterThanOrEqualTo(totalAmount)) {
          continue;
        }

        const uncoveredAmount = totalAmount.minus(confirmedAmount);

        if (uncoveredAmount.lte(0)) {
          continue;
        }

        const suggestedForTx = (suggestedLinksByTarget.get(tx.id) ?? []).filter(
          (link) => link.assetSymbol.toUpperCase() === assetKey
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
          ? parseDecimal('0')
          : confirmedAmount.dividedBy(totalAmount).times(100);

        issues.push({
          transactionId: tx.id ?? 0,
          externalId: tx.externalId,
          source: tx.source,
          blockchain: tx.blockchain?.name,
          timestamp: tx.datetime,
          assetSymbol: assetKey,
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

        const assetKey = outflow.assetSymbol.toUpperCase();
        const current = outflowTotals.get(assetKey) ?? parseDecimal('0');
        outflowTotals.set(assetKey, current.plus(amount));
      }

      for (const [assetKey, totalAmount] of outflowTotals.entries()) {
        const confirmedForTx = (confirmedLinksBySource.get(tx.id) ?? []).filter(
          (link) => link.assetSymbol.toUpperCase() === assetKey
        );

        const confirmedAmount = confirmedForTx.reduce((sum, link) => sum.plus(link.sourceAmount), parseDecimal('0'));

        if (confirmedAmount.greaterThanOrEqualTo(totalAmount)) {
          continue;
        }

        const uncoveredAmount = totalAmount.minus(confirmedAmount);

        if (uncoveredAmount.lte(0)) {
          continue;
        }

        const suggestedForTx = (suggestedLinksBySource.get(tx.id) ?? []).filter(
          (link) => link.assetSymbol.toUpperCase() === assetKey
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
          ? parseDecimal('0')
          : confirmedAmount.dividedBy(totalAmount).times(100);

        issues.push({
          transactionId: tx.id ?? 0,
          externalId: tx.externalId,
          source: tx.source,
          blockchain: tx.blockchain?.name,
          timestamp: tx.datetime,
          assetSymbol: assetKey,
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
      assetSymbol: asset,
      inflowOccurrences: data.inflow.occurrences,
      inflowMissingAmount: data.inflow.missingAmount.toFixed(),
      outflowOccurrences: data.outflow.occurrences,
      outflowMissingAmount: data.outflow.missingAmount.toFixed(),
    }))
    .filter((summary) => summary.inflowOccurrences > 0 || summary.outflowOccurrences > 0)
    .sort((a, b) => {
      const aTotal = a.inflowOccurrences + a.outflowOccurrences;
      const bTotal = b.inflowOccurrences + b.outflowOccurrences;
      return bTotal - aTotal || a.assetSymbol.localeCompare(b.assetSymbol);
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
 * Format gaps view result for text display.
 */
export function formatGapsViewResult(result: GapsViewResult): string {
  switch (result.category) {
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
          `  ${assetSummary.assetSymbol}: ${assetSummary.inflowOccurrences} inflow(s) missing ${assetSummary.inflowMissingAmount} ${assetSummary.assetSymbol}`
        );
      }
      if (assetSummary.outflowOccurrences > 0) {
        lines.push(
          `  ${assetSummary.assetSymbol}: ${assetSummary.outflowOccurrences} outflow(s) unmatched for ${assetSummary.outflowMissingAmount} ${assetSummary.assetSymbol}`
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
        `[${issue.assetSymbol}][${directionLabel}] TX #${issue.transactionId} (${issue.blockchain ?? issue.source})`
      );
      lines.push(`  Time: ${issue.timestamp}`);
      const movementLabel = issue.direction === 'inflow' ? 'inflow' : 'outflow';
      lines.push(
        `  Missing: ${issue.missingAmount} ${issue.assetSymbol} of ${issue.totalAmount} ${issue.assetSymbol} ${movementLabel}`
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
