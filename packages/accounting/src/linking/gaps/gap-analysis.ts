import { filterTransferEligibleMovements, type Account, type Transaction, type TransactionLink } from '@exitbook/core';
import { parseAssetId, parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import {
  buildLinkGapIssueKey,
  type GapCueKind,
  type LinkGapAnalysis,
  type LinkGapAssetSummary,
  type LinkGapDirection,
  type LinkGapIssue,
} from './gap-model.js';

const LIKELY_SERVICE_FLOW_WINDOW_MS = 60 * 60 * 1000;
const CORRELATED_SERVICE_SWAP_WINDOW_MS = 5 * 60 * 1000;
const MINTING_OPERATION_TYPES = new Set(['reward', 'airdrop']);
const GAP_SUPPRESSED_DIAGNOSTIC_CODES = new Set(['SCAM_TOKEN', 'SUSPICIOUS_AIRDROP']);

export interface AnalyzeLinkGapsOptions {
  accounts?: readonly Pick<Account, 'id' | 'identifier' | 'profileId'>[] | undefined;
  excludedAssetIds?: ReadonlySet<string> | undefined;
}

export interface ResolvedLinkGapVisibilityResult {
  analysis: LinkGapAnalysis;
  hiddenResolvedIssueCount: number;
}

interface GapAnalysisAccountContext {
  identifier: string;
  profileId?: number | undefined;
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

interface LinkCoverageIndex {
  confirmedByTargetTxId: Map<number, TransactionLink[]>;
  confirmedBySourceTxId: Map<number, TransactionLink[]>;
  suggestedByTargetTxId: Map<number, TransactionLink[]>;
  suggestedBySourceTxId: Map<number, TransactionLink[]>;
}

interface AssetTotalsEntry {
  amount: Decimal;
  assetSymbol: string;
}

interface GapCueCandidate {
  accountId: number;
  assetId: string;
  blockchainName: string;
  direction: LinkGapDirection;
  issueKey: string;
  selfAddress: string;
  timestampMs: number;
}

function normalizeAddress(address: string | undefined): string | undefined {
  const normalized = address?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isTransferSendTransaction(tx: Transaction): boolean {
  return (
    tx.operation.category === 'transfer' && (tx.operation.type === 'withdrawal' || tx.operation.type === 'transfer')
  );
}

function isExcludedInflowGapTransaction(tx: Transaction): boolean {
  if (MINTING_OPERATION_TYPES.has(tx.operation.type)) {
    return true;
  }

  return tx.operation.category === 'staking';
}

function findHighestConfidence(links: readonly TransactionLink[]): string | undefined {
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

function buildAccountContextById(
  accounts: readonly Pick<Account, 'id' | 'identifier' | 'profileId'>[] | undefined
): Map<number, GapAnalysisAccountContext> {
  const contexts = new Map<number, GapAnalysisAccountContext>();

  for (const account of accounts ?? []) {
    contexts.set(account.id, {
      identifier: account.identifier,
      profileId: account.profileId,
    });
  }

  return contexts;
}

function buildPositiveAssetTotalsByAssetId(
  movements: { assetId: string; assetSymbol: string; grossAmount: Decimal; netAmount?: Decimal | undefined }[],
  excludedAssetIds?: ReadonlySet<string>
): Map<string, AssetTotalsEntry> {
  const totals = new Map<string, AssetTotalsEntry>();

  for (const movement of movements) {
    if (excludedAssetIds?.has(movement.assetId)) {
      continue;
    }

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

function getSingleAssetEntryById(assetTotals: Map<string, AssetTotalsEntry>): [string, AssetTotalsEntry] | undefined {
  if (assetTotals.size !== 1) {
    return undefined;
  }

  return assetTotals.entries().next().value as [string, AssetTotalsEntry];
}

function buildLinkCoverageIndex(links: readonly TransactionLink[]): LinkCoverageIndex {
  const index: LinkCoverageIndex = {
    confirmedByTargetTxId: new Map<number, TransactionLink[]>(),
    confirmedBySourceTxId: new Map<number, TransactionLink[]>(),
    suggestedByTargetTxId: new Map<number, TransactionLink[]>(),
    suggestedBySourceTxId: new Map<number, TransactionLink[]>(),
  };

  const pushToMap = (map: Map<number, TransactionLink[]>, key: number, link: TransactionLink) => {
    const existing = map.get(key);
    if (existing) {
      existing.push(link);
      return;
    }

    map.set(key, [link]);
  };

  for (const link of links) {
    if (link.status === 'confirmed') {
      pushToMap(index.confirmedByTargetTxId, link.targetTransactionId, link);
      pushToMap(index.confirmedBySourceTxId, link.sourceTransactionId, link);
      continue;
    }

    if (link.status === 'suggested') {
      pushToMap(index.suggestedByTargetTxId, link.targetTransactionId, link);
      pushToMap(index.suggestedBySourceTxId, link.sourceTransactionId, link);
    }
  }

  return index;
}

function getOneSidedBlockchainActivity(
  tx: Transaction,
  excludedAssetIds?: ReadonlySet<string>
): OneSidedBlockchainActivity | undefined {
  if (!tx.blockchain) {
    return undefined;
  }

  const inflowTotals = buildPositiveAssetTotalsByAssetId(
    filterTransferEligibleMovements(tx.movements.inflows),
    excludedAssetIds
  );
  const outflowTotals = buildPositiveAssetTotalsByAssetId(
    filterTransferEligibleMovements(tx.movements.outflows),
    excludedAssetIds
  );

  if (outflowTotals.size === 0 && inflowTotals.size > 0 && !isExcludedInflowGapTransaction(tx)) {
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

  if (inflowTotals.size === 0 && outflowTotals.size > 0 && isTransferSendTransaction(tx)) {
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

function getConfirmedCoverageLinks(
  activity: OneSidedBlockchainActivity,
  coverageIndex: LinkCoverageIndex
): TransactionLink[] {
  const txId = activity.transaction.id;
  if (txId === undefined) {
    return [];
  }

  return activity.direction === 'inflow'
    ? (coverageIndex.confirmedByTargetTxId.get(txId) ?? [])
    : (coverageIndex.confirmedBySourceTxId.get(txId) ?? []);
}

function hasFullConfirmedCoverage(activity: OneSidedBlockchainActivity, coverageIndex: LinkCoverageIndex): boolean {
  const confirmedAmount = getConfirmedCoverageLinks(activity, coverageIndex)
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

function hasExplicitNetworkFeeInAsset(tx: Transaction, assetId: string): boolean {
  return tx.fees.some(
    (fee) =>
      fee.assetId === assetId && fee.scope === 'network' && fee.settlement === 'balance' && fee.amount.greaterThan(0)
  );
}

function isBlockchainNativeAssetForTransaction(tx: Transaction, assetId: string): boolean {
  if (!tx.blockchain) {
    return false;
  }

  const parsedAssetId = parseAssetId(assetId);
  return (
    parsedAssetId.isOk() &&
    parsedAssetId.value.namespace === 'blockchain' &&
    parsedAssetId.value.chain === tx.blockchain.name &&
    parsedAssetId.value.ref === 'native'
  );
}

function getConfirmedCoverageAmountForSourceAsset(
  txId: number,
  assetId: string,
  coverageIndex: LinkCoverageIndex
): Decimal {
  const confirmedLinks = coverageIndex.confirmedBySourceTxId.get(txId) ?? [];
  return confirmedLinks
    .filter((link) => link.sourceAssetId === assetId)
    .reduce((sum, link) => sum.plus(link.sourceAmount), parseDecimal('0'));
}

function isResidualFeeAssetGapOnOtherwiseCoveredSend(
  tx: Transaction,
  assetId: string,
  coverageIndex: LinkCoverageIndex
): boolean {
  if (
    tx.id === undefined ||
    !isBlockchainNativeAssetForTransaction(tx, assetId) ||
    !hasExplicitNetworkFeeInAsset(tx, assetId)
  ) {
    return false;
  }

  const outflowTotals = buildPositiveAssetTotalsByAssetId(filterTransferEligibleMovements(tx.movements.outflows));
  const otherOutflowAssets = Array.from(outflowTotals.entries()).filter(([otherAssetId]) => otherAssetId !== assetId);
  if (otherOutflowAssets.length === 0) {
    return false;
  }

  return otherOutflowAssets.every(([otherAssetId, { amount }]) =>
    getConfirmedCoverageAmountForSourceAsset(tx.id, otherAssetId, coverageIndex).greaterThanOrEqualTo(amount)
  );
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

  if (activity.selfAddress === undefined) {
    return false;
  }

  return hasMatchingSelfAddress(tx, activity.selfAddress);
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
  if (!activityAccount || !otherAccount) {
    return false;
  }

  if (activityAccount.profileId !== otherAccount.profileId) {
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

function classifySuppressedGapTransactionIds(
  transactions: readonly Transaction[],
  coverageIndex: LinkCoverageIndex,
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>,
  excludedAssetIds?: ReadonlySet<string>
): Set<number> {
  const uncoveredActivities = transactions
    .map((tx) => getOneSidedBlockchainActivity(tx, excludedAssetIds))
    .filter((activity): activity is OneSidedBlockchainActivity => activity !== undefined)
    .filter(
      (activity) =>
        activity.selfAddress !== undefined &&
        activity.transaction.id !== undefined &&
        !hasFullConfirmedCoverage(activity, coverageIndex)
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

function splitResolvedLinkGapIssues(
  issues: readonly LinkGapIssue[],
  resolvedIssueKeys?: ReadonlySet<string>
): {
  hiddenIssueCount: number;
  visibleIssues: LinkGapIssue[];
} {
  if (!resolvedIssueKeys || resolvedIssueKeys.size === 0) {
    return {
      hiddenIssueCount: 0,
      visibleIssues: [...issues],
    };
  }

  const visibleIssues: LinkGapIssue[] = [];
  let hiddenIssueCount = 0;

  for (const issue of issues) {
    if (
      resolvedIssueKeys.has(
        buildLinkGapIssueKey({
          txFingerprint: issue.txFingerprint,
          assetId: issue.assetId,
          direction: issue.direction,
        })
      )
    ) {
      hiddenIssueCount += 1;
      continue;
    }

    visibleIssues.push(issue);
  }

  return {
    hiddenIssueCount,
    visibleIssues,
  };
}

function createLinkGapIssue(params: {
  assetId: string;
  assetSymbol: string;
  confirmedAmount: Decimal;
  direction: LinkGapDirection;
  suggestedLinks: readonly TransactionLink[];
  totalAmount: Decimal;
  tx: Transaction;
  uncoveredAmount: Decimal;
}): LinkGapIssue {
  const { tx, assetId, assetSymbol, uncoveredAmount, totalAmount, confirmedAmount, suggestedLinks, direction } = params;

  const coveragePercent = totalAmount.isZero() ? parseDecimal('0') : confirmedAmount.dividedBy(totalAmount).times(100);

  return {
    transactionId: tx.id,
    txFingerprint: tx.txFingerprint,
    platformKey: tx.platformKey,
    blockchainName: tx.blockchain?.name,
    timestamp: tx.datetime,
    assetId,
    assetSymbol,
    missingAmount: uncoveredAmount.toFixed(),
    totalAmount: totalAmount.toFixed(),
    confirmedCoveragePercent: coveragePercent.toFixed(),
    operationCategory: tx.operation.category,
    operationType: tx.operation.type,
    suggestedCount: suggestedLinks.length,
    highestSuggestedConfidencePercent: findHighestConfidence(suggestedLinks),
    direction,
  };
}

function buildTransactionById(transactions: readonly Transaction[]): Map<number, Transaction> {
  const transactionById = new Map<number, Transaction>();

  for (const tx of transactions) {
    transactionById.set(tx.id, tx);
  }

  return transactionById;
}

function buildGapCueCandidates(
  issues: readonly LinkGapIssue[],
  transactionById: ReadonlyMap<number, Transaction>
): GapCueCandidate[] {
  const candidates: GapCueCandidate[] = [];

  for (const issue of issues) {
    const tx = transactionById.get(issue.transactionId);
    if (!tx?.blockchain) {
      continue;
    }

    const selfAddress = normalizeAddress(issue.direction === 'inflow' ? tx.to : tx.from);
    if (selfAddress === undefined) {
      continue;
    }

    candidates.push({
      accountId: tx.accountId,
      assetId: issue.assetId,
      blockchainName: tx.blockchain.name,
      direction: issue.direction,
      issueKey: buildLinkGapIssueKey({
        txFingerprint: issue.txFingerprint,
        assetId: issue.assetId,
        direction: issue.direction,
      }),
      selfAddress,
      timestampMs: tx.timestamp,
    });
  }

  return candidates;
}

function getCorrelatedServiceSwapCue(windowCandidates: readonly GapCueCandidate[]): GapCueKind | undefined {
  if (windowCandidates.length < 2) {
    return undefined;
  }

  const directions = new Set(windowCandidates.map((candidate) => candidate.direction));
  if (!directions.has('inflow') || !directions.has('outflow')) {
    return undefined;
  }

  const assetIds = new Set(windowCandidates.map((candidate) => candidate.assetId));
  if (assetIds.size < 2) {
    return undefined;
  }

  return 'likely_correlated_service_swap';
}

function detectGapCueIssueKeys(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[]
): Map<string, GapCueKind> {
  const transactionById = buildTransactionById(transactions);
  const candidates = buildGapCueCandidates(issues, transactionById);
  if (candidates.length === 0) {
    return new Map<string, GapCueKind>();
  }

  const candidatesByGroup = new Map<string, GapCueCandidate[]>();
  for (const candidate of candidates) {
    const groupKey = `${candidate.accountId}|${candidate.blockchainName}|${candidate.selfAddress}`;
    const existing = candidatesByGroup.get(groupKey);
    if (existing) {
      existing.push(candidate);
      continue;
    }

    candidatesByGroup.set(groupKey, [candidate]);
  }

  const cueByIssueKey = new Map<string, GapCueKind>();

  for (const groupCandidates of candidatesByGroup.values()) {
    const sortedCandidates = [...groupCandidates].sort((left, right) => left.timestampMs - right.timestampMs);

    for (let startIndex = 0; startIndex < sortedCandidates.length; startIndex += 1) {
      const windowStart = sortedCandidates[startIndex]!;
      const windowCandidates = [windowStart];

      for (let endIndex = startIndex + 1; endIndex < sortedCandidates.length; endIndex += 1) {
        const candidate = sortedCandidates[endIndex]!;
        if (candidate.timestampMs - windowStart.timestampMs > CORRELATED_SERVICE_SWAP_WINDOW_MS) {
          break;
        }

        windowCandidates.push(candidate);
      }

      const cue = getCorrelatedServiceSwapCue(windowCandidates);
      if (!cue) {
        continue;
      }

      for (const candidate of windowCandidates) {
        cueByIssueKey.set(candidate.issueKey, cue);
      }
    }
  }

  return cueByIssueKey;
}

function applyGapCues(issues: readonly LinkGapIssue[], transactions: readonly Transaction[]): LinkGapIssue[] {
  const cueByIssueKey = detectGapCueIssueKeys(issues, transactions);
  if (cueByIssueKey.size === 0) {
    return [...issues];
  }

  return issues.map((issue) => ({
    ...issue,
    gapCue:
      cueByIssueKey.get(
        buildLinkGapIssueKey({
          txFingerprint: issue.txFingerprint,
          assetId: issue.assetId,
          direction: issue.direction,
        })
      ) ?? issue.gapCue,
  }));
}

function shouldSuppressGapByPolicy(tx: Transaction): boolean {
  if (tx.excludedFromAccounting === true || tx.isSpam === true) {
    return true;
  }

  return tx.diagnostics?.some((diagnostic) => GAP_SUPPRESSED_DIAGNOSTIC_CODES.has(diagnostic.code)) ?? false;
}

function collectInflowGapIssues(
  transactions: readonly Transaction[],
  coverageIndex: LinkCoverageIndex,
  suppressedTxIds: ReadonlySet<number>,
  excludedAssetIds?: ReadonlySet<string>
): LinkGapIssue[] {
  const issues: LinkGapIssue[] = [];

  for (const tx of transactions) {
    if (tx.id !== undefined && suppressedTxIds.has(tx.id)) {
      continue;
    }

    if (shouldSuppressGapByPolicy(tx)) {
      continue;
    }

    const inflows = filterTransferEligibleMovements(tx.movements.inflows);
    const outflows = filterTransferEligibleMovements(tx.movements.outflows);
    if (!tx.blockchain || inflows.length === 0 || outflows.length > 0 || isExcludedInflowGapTransaction(tx)) {
      continue;
    }

    const inflowTotals = buildPositiveAssetTotalsByAssetId(inflows, excludedAssetIds);
    for (const [assetId, { amount: totalAmount, assetSymbol }] of inflowTotals.entries()) {
      const confirmedLinks = (tx.id !== undefined ? coverageIndex.confirmedByTargetTxId.get(tx.id) : undefined) ?? [];
      const confirmedForAsset = confirmedLinks.filter((link) => link.targetAssetId === assetId);
      const confirmedAmount = confirmedForAsset.reduce((sum, link) => sum.plus(link.targetAmount), parseDecimal('0'));

      if (confirmedAmount.greaterThanOrEqualTo(totalAmount)) {
        continue;
      }

      const uncoveredAmount = totalAmount.minus(confirmedAmount);
      if (uncoveredAmount.lte(0)) {
        continue;
      }

      const suggestedLinks = (
        (tx.id !== undefined ? coverageIndex.suggestedByTargetTxId.get(tx.id) : undefined) ?? []
      ).filter((link) => link.targetAssetId === assetId);

      issues.push(
        createLinkGapIssue({
          tx,
          assetId,
          assetSymbol,
          uncoveredAmount,
          totalAmount,
          confirmedAmount,
          suggestedLinks,
          direction: 'inflow',
        })
      );
    }
  }

  return issues;
}

function collectOutflowGapIssues(
  transactions: readonly Transaction[],
  coverageIndex: LinkCoverageIndex,
  suppressedTxIds: ReadonlySet<number>,
  excludedAssetIds?: ReadonlySet<string>
): LinkGapIssue[] {
  const issues: LinkGapIssue[] = [];

  for (const tx of transactions) {
    if (tx.id !== undefined && suppressedTxIds.has(tx.id)) {
      continue;
    }

    if (shouldSuppressGapByPolicy(tx)) {
      continue;
    }

    const inflows = filterTransferEligibleMovements(tx.movements.inflows);
    const outflows = filterTransferEligibleMovements(tx.movements.outflows);
    if (outflows.length === 0 || inflows.length > 0 || !isTransferSendTransaction(tx)) {
      continue;
    }

    const outflowTotals = buildPositiveAssetTotalsByAssetId(outflows, excludedAssetIds);
    for (const [assetId, { amount: totalAmount, assetSymbol }] of outflowTotals.entries()) {
      const confirmedLinks = (tx.id !== undefined ? coverageIndex.confirmedBySourceTxId.get(tx.id) : undefined) ?? [];
      const confirmedForAsset = confirmedLinks.filter((link) => link.sourceAssetId === assetId);
      const confirmedAmount = confirmedForAsset.reduce((sum, link) => sum.plus(link.sourceAmount), parseDecimal('0'));

      if (confirmedAmount.greaterThanOrEqualTo(totalAmount)) {
        continue;
      }

      const uncoveredAmount = totalAmount.minus(confirmedAmount);
      if (uncoveredAmount.lte(0)) {
        continue;
      }

      if (isResidualFeeAssetGapOnOtherwiseCoveredSend(tx, assetId, coverageIndex)) {
        continue;
      }

      const suggestedLinks = (
        (tx.id !== undefined ? coverageIndex.suggestedBySourceTxId.get(tx.id) : undefined) ?? []
      ).filter((link) => link.sourceAssetId === assetId);

      issues.push(
        createLinkGapIssue({
          tx,
          assetId,
          assetSymbol,
          uncoveredAmount,
          totalAmount,
          confirmedAmount,
          suggestedLinks,
          direction: 'outflow',
        })
      );
    }
  }

  return issues;
}

function buildLinkGapSummary(issues: readonly LinkGapIssue[]): LinkGapAnalysis['summary'] {
  const inflowIssueCount = issues.reduce((count, issue) => (issue.direction === 'inflow' ? count + 1 : count), 0);
  const outflowIssueCount = issues.length - inflowIssueCount;
  const assetTotals = new Map<
    string,
    {
      inflow: { missingAmount: Decimal; occurrences: number };
      outflow: { missingAmount: Decimal; occurrences: number };
    }
  >();

  for (const issue of issues) {
    const totals = assetTotals.get(issue.assetSymbol) ?? {
      inflow: { missingAmount: parseDecimal('0'), occurrences: 0 },
      outflow: { missingAmount: parseDecimal('0'), occurrences: 0 },
    };

    const directionTotals = issue.direction === 'inflow' ? totals.inflow : totals.outflow;
    directionTotals.occurrences += 1;
    directionTotals.missingAmount = directionTotals.missingAmount.plus(parseDecimal(issue.missingAmount));
    assetTotals.set(issue.assetSymbol, totals);
  }

  const assets: LinkGapAssetSummary[] = Array.from(assetTotals.entries())
    .map(([assetSymbol, totals]) => ({
      assetSymbol,
      inflowOccurrences: totals.inflow.occurrences,
      inflowMissingAmount: totals.inflow.missingAmount.toFixed(),
      outflowOccurrences: totals.outflow.occurrences,
      outflowMissingAmount: totals.outflow.missingAmount.toFixed(),
    }))
    .filter((summary) => summary.inflowOccurrences > 0 || summary.outflowOccurrences > 0)
    .sort((left, right) => {
      const leftTotal = left.inflowOccurrences + left.outflowOccurrences;
      const rightTotal = right.inflowOccurrences + right.outflowOccurrences;
      return rightTotal - leftTotal || left.assetSymbol.localeCompare(right.assetSymbol);
    });

  return {
    total_issues: issues.length,
    uncovered_inflows: inflowIssueCount,
    unmatched_outflows: outflowIssueCount,
    affected_assets: assets.length,
    assets,
  };
}

export function analyzeLinkGaps(
  transactions: Transaction[],
  links: TransactionLink[],
  options: AnalyzeLinkGapsOptions = {}
): LinkGapAnalysis {
  const coverageIndex = buildLinkCoverageIndex(links);
  const accountContextById = buildAccountContextById(options.accounts);
  const suppressedTxIds = classifySuppressedGapTransactionIds(
    transactions,
    coverageIndex,
    accountContextById,
    options.excludedAssetIds
  );
  const rawIssues = [
    ...collectInflowGapIssues(transactions, coverageIndex, suppressedTxIds, options.excludedAssetIds),
    ...collectOutflowGapIssues(transactions, coverageIndex, suppressedTxIds, options.excludedAssetIds),
  ];
  // This cue is intentionally local to the gaps lens. It complements, rather than
  // replaces, the existing suppression heuristics for explicit same-account swaps
  // and cross-account service-flow pairs.
  const issues = applyGapCues(rawIssues, transactions);
  return {
    issues,
    summary: buildLinkGapSummary(issues),
  };
}

export function applyResolvedLinkGapVisibility(
  analysis: LinkGapAnalysis,
  resolvedIssueKeys?: ReadonlySet<string>
): ResolvedLinkGapVisibilityResult {
  const resolvedIssueState = splitResolvedLinkGapIssues(analysis.issues, resolvedIssueKeys);

  return {
    analysis: {
      issues: resolvedIssueState.visibleIssues,
      summary: buildLinkGapSummary(resolvedIssueState.visibleIssues),
    },
    hiddenResolvedIssueCount: resolvedIssueState.hiddenIssueCount,
  };
}
