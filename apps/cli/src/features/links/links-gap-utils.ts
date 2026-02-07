// Types and utilities for link gap analysis

import type { TransactionLink } from '@exitbook/accounting';
import { parseDecimal, type UniversalTransactionData } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

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
 * Find the highest confidence score from a list of links.
 */
function findHighestConfidence(links: TransactionLink[]): string | undefined {
  if (links.length === 0) {
    return undefined;
  }

  let highest = links[0]!.confidenceScore;
  for (const link of links) {
    if (link.confidenceScore.greaterThan(highest)) {
      highest = link.confidenceScore;
    }
  }
  return highest.times(100).toFixed();
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
    const existing = map.get(key);
    if (existing) {
      existing.push(link);
    } else {
      map.set(key, [link]);
    }
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

        const highestSuggestedConfidencePercent = findHighestConfidence(suggestedForTx);

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

        const highestSuggestedConfidencePercent = findHighestConfidence(suggestedForTx);

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
