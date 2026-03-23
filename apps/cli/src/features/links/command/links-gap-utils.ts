// Types and utilities for link gap analysis

import type { Account, Transaction, TransactionLink } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

const LIKELY_SERVICE_FLOW_WINDOW_MS = 60 * 60 * 1000;

/**
 * Link gap issue details.
 */
export type LinkGapDirection = 'inflow' | 'outflow';

export interface LinkGapIssue {
  transactionId: number;
  txFingerprint: string;
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

interface LinkGapAnalysisOptions {
  accounts?: readonly Pick<Account, 'id' | 'identifier' | 'userId'>[] | undefined;
}

interface OneSidedBlockchainActivity {
  assetId: string;
  assetSymbol: string;
  blockchainName: string;
  direction: LinkGapDirection;
  selfAddress: string | undefined;
  timestampMs: number;
  totalAmount: Decimal;
  transaction: Transaction;
}

interface GapAnalysisAccountContext {
  identifier: string;
  userId?: number | undefined;
}

function isExcludedInflowGapTransaction(tx: Transaction, mintingTypes: ReadonlySet<string>): boolean {
  if (mintingTypes.has(tx.operation.type)) {
    return true;
  }

  return tx.operation.category === 'staking';
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

function normalizeAddress(address: string | undefined): string | undefined {
  const normalized = address?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function buildAccountContextById(
  accounts: readonly Pick<Account, 'id' | 'identifier' | 'userId'>[] | undefined
): Map<number, GapAnalysisAccountContext> {
  const contexts = new Map<number, GapAnalysisAccountContext>();

  for (const account of accounts ?? []) {
    contexts.set(account.id, {
      identifier: account.identifier,
      userId: account.userId,
    });
  }

  return contexts;
}

function buildPositiveAssetTotalsByAssetId(
  movements: { assetId: string; assetSymbol: string; grossAmount: Decimal; netAmount?: Decimal | undefined }[]
): Map<string, { amount: Decimal; assetSymbol: string }> {
  const totals = new Map<string, { amount: Decimal; assetSymbol: string }>();

  for (const movement of movements) {
    const amount = movement.netAmount ?? movement.grossAmount;
    if (!amount || amount.lte(0)) {
      continue;
    }

    const existing = totals.get(movement.assetId);
    if (existing) {
      existing.amount = existing.amount.plus(amount);
      continue;
    }

    totals.set(movement.assetId, {
      amount,
      assetSymbol: movement.assetSymbol.toUpperCase(),
    });
  }

  return totals;
}

function getSingleAssetEntryById(
  assetTotals: Map<string, { amount: Decimal; assetSymbol: string }>
): [string, { amount: Decimal; assetSymbol: string }] | undefined {
  if (assetTotals.size !== 1) {
    return undefined;
  }

  return assetTotals.entries().next().value as [string, { amount: Decimal; assetSymbol: string }];
}

function getOneSidedBlockchainActivity(
  tx: Transaction,
  mintingTypes: ReadonlySet<string>
): OneSidedBlockchainActivity | undefined {
  if (!tx.blockchain) {
    return undefined;
  }

  const inflowTotals = buildPositiveAssetTotalsByAssetId(tx.movements.inflows ?? []);
  const outflowTotals = buildPositiveAssetTotalsByAssetId(tx.movements.outflows ?? []);

  if (outflowTotals.size === 0 && inflowTotals.size > 0 && !isExcludedInflowGapTransaction(tx, mintingTypes)) {
    const entry = getSingleAssetEntryById(inflowTotals);
    if (!entry) {
      return undefined;
    }

    const [assetId, { assetSymbol, amount: totalAmount }] = entry;
    return {
      assetId,
      assetSymbol,
      blockchainName: tx.blockchain.name,
      direction: 'inflow',
      selfAddress: normalizeAddress(tx.to),
      timestampMs: tx.timestamp,
      totalAmount,
      transaction: tx,
    };
  }

  const isTransferSend =
    tx.operation.category === 'transfer' && (tx.operation.type === 'withdrawal' || tx.operation.type === 'transfer');

  if (inflowTotals.size === 0 && outflowTotals.size > 0 && isTransferSend) {
    const entry = getSingleAssetEntryById(outflowTotals);
    if (!entry) {
      return undefined;
    }

    const [assetId, { assetSymbol, amount: totalAmount }] = entry;
    return {
      assetId,
      assetSymbol,
      blockchainName: tx.blockchain.name,
      direction: 'outflow',
      selfAddress: normalizeAddress(tx.from),
      timestampMs: tx.timestamp,
      totalAmount,
      transaction: tx,
    };
  }

  return undefined;
}

function hasFullConfirmedCoverage(
  activity: OneSidedBlockchainActivity,
  confirmedLinksByTarget: Map<number, TransactionLink[]>,
  confirmedLinksBySource: Map<number, TransactionLink[]>
): boolean {
  const txId = activity.transaction.id;
  if (txId === undefined) {
    return false;
  }

  const relevantLinks =
    activity.direction === 'inflow'
      ? (confirmedLinksByTarget.get(txId) ?? [])
      : (confirmedLinksBySource.get(txId) ?? []);

  const confirmedAmount = relevantLinks
    .filter((link) =>
      activity.direction === 'inflow'
        ? link.targetAssetId === activity.assetId
        : link.sourceAssetId === activity.assetId
    )
    .reduce(
      (sum, link) => sum.plus(activity.direction === 'inflow' ? link.targetAmount : link.sourceAmount),
      parseDecimal('0')
    );

  return confirmedAmount.greaterThanOrEqualTo(activity.totalAmount);
}

function hasMatchingSelfAddress(tx: Transaction, selfAddress: string): boolean {
  return normalizeAddress(tx.from) === selfAddress || normalizeAddress(tx.to) === selfAddress;
}

function getCounterpartyAddress(activity: OneSidedBlockchainActivity): string | undefined {
  return activity.direction === 'outflow'
    ? normalizeAddress(activity.transaction.to)
    : normalizeAddress(activity.transaction.from);
}

function hasTrackedSelfAddress(
  activity: OneSidedBlockchainActivity,
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>
): boolean {
  const account = accountContextById.get(activity.transaction.accountId);
  if (!account) {
    return false;
  }

  return normalizeAddress(account.identifier) === activity.selfAddress;
}

function isNearbySwapTransaction(tx: Transaction, activity: OneSidedBlockchainActivity): boolean {
  if (
    !tx.blockchain ||
    tx.id === activity.transaction.id ||
    tx.accountId !== activity.transaction.accountId ||
    tx.blockchain.name !== activity.blockchainName
  ) {
    return false;
  }

  if (Math.abs(tx.timestamp - activity.timestampMs) > LIKELY_SERVICE_FLOW_WINDOW_MS) {
    return false;
  }

  if (tx.operation.category !== 'trade' || tx.operation.type !== 'swap') {
    return false;
  }

  const selfAddress = activity.selfAddress;
  if (selfAddress === undefined) {
    return false;
  }

  return hasMatchingSelfAddress(tx, selfAddress);
}

function isLikelyCrossChainServiceFlowPair(
  activity: OneSidedBlockchainActivity,
  other: OneSidedBlockchainActivity,
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>
): boolean {
  if (activity.transaction.id === other.transaction.id) {
    return false;
  }

  if (activity.direction === other.direction || activity.assetSymbol === other.assetSymbol) {
    return false;
  }

  if (activity.transaction.accountId === other.transaction.accountId) {
    return false;
  }

  if (Math.abs(other.timestampMs - activity.timestampMs) > LIKELY_SERVICE_FLOW_WINDOW_MS) {
    return false;
  }

  const activityAccount = accountContextById.get(activity.transaction.accountId);
  const otherAccount = accountContextById.get(other.transaction.accountId);
  if (!activityAccount || !otherAccount || activityAccount.userId === undefined || otherAccount.userId === undefined) {
    return false;
  }

  if (activityAccount.userId !== otherAccount.userId) {
    return false;
  }

  if (!hasTrackedSelfAddress(activity, accountContextById) || !hasTrackedSelfAddress(other, accountContextById)) {
    return false;
  }

  const activityCounterparty = getCounterpartyAddress(activity);
  const otherCounterparty = getCounterpartyAddress(other);
  if (activityCounterparty === undefined && otherCounterparty === undefined) {
    return false;
  }

  const activityIdentifier = normalizeAddress(activityAccount.identifier);
  const otherIdentifier = normalizeAddress(otherAccount.identifier);

  if (activityCounterparty !== undefined && activityCounterparty === activityIdentifier) {
    return false;
  }

  if (otherCounterparty !== undefined && otherCounterparty === otherIdentifier) {
    return false;
  }

  return true;
}

function buildSuppressedGapTransactionIds(
  transactions: Transaction[],
  confirmedLinksByTarget: Map<number, TransactionLink[]>,
  confirmedLinksBySource: Map<number, TransactionLink[]>,
  mintingTypes: ReadonlySet<string>,
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>
): Set<number> {
  const uncoveredActivities = transactions
    .map((tx) => getOneSidedBlockchainActivity(tx, mintingTypes))
    .filter((activity): activity is OneSidedBlockchainActivity => activity !== undefined)
    .filter(
      (activity) =>
        activity.selfAddress !== undefined &&
        activity.transaction.id !== undefined &&
        !hasFullConfirmedCoverage(activity, confirmedLinksByTarget, confirmedLinksBySource)
    );

  const suppressedTxIds = new Set<number>();

  for (const activity of uncoveredActivities) {
    const hasNearbySwap = transactions.some((tx) => isNearbySwapTransaction(tx, activity));
    const hasNearbyOppositeUncoveredTransfer = uncoveredActivities.some(
      (other) =>
        other.transaction.id !== activity.transaction.id &&
        other.transaction.accountId === activity.transaction.accountId &&
        other.blockchainName === activity.blockchainName &&
        other.selfAddress === activity.selfAddress &&
        other.direction !== activity.direction &&
        other.assetSymbol !== activity.assetSymbol &&
        Math.abs(other.timestampMs - activity.timestampMs) <= LIKELY_SERVICE_FLOW_WINDOW_MS
    );

    const hasCrossChainServiceFlowPair = uncoveredActivities.some((other) =>
      isLikelyCrossChainServiceFlowPair(activity, other, accountContextById)
    );

    if ((hasNearbySwap && hasNearbyOppositeUncoveredTransfer) || hasCrossChainServiceFlowPair) {
      suppressedTxIds.add(activity.transaction.id);
    }
  }

  return suppressedTxIds;
}

/**
 * Analyze transactions for missing link coverage.
 *
 * Flags blockchain inflows with no confirmed provenance and transfer outflows
 * (blockchain or exchange) that lack a confirmed destination.
 */
export function analyzeLinkGaps(
  transactions: Transaction[],
  links: TransactionLink[],
  options: LinkGapAnalysisOptions = {}
): LinkGapAnalysis {
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
  const accountContextById = buildAccountContextById(options.accounts);
  const suppressedTxIds = buildSuppressedGapTransactionIds(
    transactions,
    confirmedLinksByTarget,
    confirmedLinksBySource,
    mintingTypes,
    accountContextById
  );

  for (const tx of transactions) {
    if (tx.id !== undefined && suppressedTxIds.has(tx.id)) {
      continue;
    }

    const isBlockchainTx = Boolean(tx.blockchain);
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];

    // --- Inflow analysis (missing provenance) ---
    if (
      isBlockchainTx &&
      inflows.length > 0 &&
      outflows.length === 0 &&
      !isExcludedInflowGapTransaction(tx, mintingTypes)
    ) {
      const inflowTotals = buildPositiveAssetTotalsByAssetId(inflows);

      for (const [assetId, assetEntry] of inflowTotals.entries()) {
        const { amount: totalAmount, assetSymbol } = assetEntry;
        const confirmedForTx = (confirmedLinksByTarget.get(tx.id) ?? []).filter(
          (link) => link.targetAssetId === assetId
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
          (link) => link.targetAssetId === assetId
        );

        const highestSuggestedConfidencePercent = findHighestConfidence(suggestedForTx);

        const coveragePercent = totalAmount.isZero()
          ? parseDecimal('0')
          : confirmedAmount.dividedBy(totalAmount).times(100);

        issues.push({
          transactionId: tx.id,
          txFingerprint: tx.txFingerprint,
          source: tx.source,
          blockchain: tx.blockchain?.name,
          timestamp: tx.datetime,
          assetSymbol,
          missingAmount: uncoveredAmount.toFixed(),
          totalAmount: totalAmount.toFixed(),
          confirmedCoveragePercent: coveragePercent.toFixed(),
          operationCategory: tx.operation.category,
          operationType: tx.operation.type,
          suggestedCount: suggestedForTx.length,
          highestSuggestedConfidencePercent,
          direction: 'inflow',
        });

        const totals = getOrCreateAssetTotals(assetSymbol);
        totals.inflow.occurrences++;
        totals.inflow.missingAmount = totals.inflow.missingAmount.plus(uncoveredAmount);
      }
    }

    // --- Outflow analysis (missing destination wallet) ---
    const isTransferSend =
      tx.operation.category === 'transfer' && (tx.operation.type === 'withdrawal' || tx.operation.type === 'transfer');

    if (outflows.length > 0 && inflows.length === 0 && isTransferSend) {
      const outflowTotals = buildPositiveAssetTotalsByAssetId(outflows);

      for (const [assetId, assetEntry] of outflowTotals.entries()) {
        const { amount: totalAmount, assetSymbol } = assetEntry;
        const confirmedForTx = (confirmedLinksBySource.get(tx.id) ?? []).filter(
          (link) => link.sourceAssetId === assetId
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
          (link) => link.sourceAssetId === assetId
        );

        const highestSuggestedConfidencePercent = findHighestConfidence(suggestedForTx);

        const coveragePercent = totalAmount.isZero()
          ? parseDecimal('0')
          : confirmedAmount.dividedBy(totalAmount).times(100);

        issues.push({
          transactionId: tx.id,
          txFingerprint: tx.txFingerprint,
          source: tx.source,
          blockchain: tx.blockchain?.name,
          timestamp: tx.datetime,
          assetSymbol,
          missingAmount: uncoveredAmount.toFixed(),
          totalAmount: totalAmount.toFixed(),
          confirmedCoveragePercent: coveragePercent.toFixed(),
          operationCategory: tx.operation.category,
          operationType: tx.operation.type,
          suggestedCount: suggestedForTx.length,
          highestSuggestedConfidencePercent,
          direction: 'outflow',
        });

        const totals = getOrCreateAssetTotals(assetSymbol);
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
