import {
  filterTransferEligibleMovements,
  getExplainedTargetResidual,
  hasAnyDiagnosticCode,
  getTransactionScamAssessment,
  getMovementRole,
  type Account,
  type AssetReviewSummary,
  type MovementRole,
  type Transaction,
  type TransactionLink,
} from '@exitbook/core';
import { isFiat, parseAssetId, parseDecimal, type Currency } from '@exitbook/foundation';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
import type { Decimal } from 'decimal.js';

import {
  buildLinkGapIssueKey,
  type GapCueKind,
  type GapContextHint,
  type LinkGapAnalysis,
  type LinkGapAssetSummary,
  type LinkGapDirection,
  type LinkGapIssue,
} from './gap-model.js';

const LIKELY_SERVICE_FLOW_WINDOW_MS = 60 * 60 * 1000;
const CORRELATED_SERVICE_SWAP_WINDOW_MS = 5 * 60 * 1000;
const CROSS_CHAIN_MIGRATION_CUE_WINDOW_MS = 60 * 60 * 1000;
const POSSIBLE_ASSET_MIGRATION_CUE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CROSS_CHAIN_MIGRATION_MIN_RATIO = parseDecimal('0.9999');
const LIKELY_DUST_MAX_FIAT_VALUE = parseDecimal('10');
const LIKELY_DUST_DIAGNOSTIC_CODES = new Set(['unsolicited_dust_fanout']);
const MINTING_OPERATION_TYPES = new Set(['reward', 'airdrop']);
const GAP_SUPPRESSION_DIAGNOSTIC_CODES = new Set(['off_platform_cash_movement']);
const GAP_DIAGNOSTIC_PRIORITY = [
  'staking_withdrawal',
  'unsolicited_dust_fanout',
  'allocation_uncertain',
  'classification_uncertain',
  'classification_failed',
  'batch_operation',
  'proxy_operation',
  'multisig_operation',
  'exchange_deposit_address_credit',
] as const;
const GAP_MOVEMENT_ROLE_CONTEXT_PRIORITY: readonly Exclude<MovementRole, 'principal'>[] = [
  'staking_reward',
  'protocol_overhead',
  'refund_rebate',
];

export interface AnalyzeLinkGapsOptions {
  accounts?: readonly Pick<Account, 'id' | 'identifier' | 'profileId'>[] | undefined;
  excludedAssetIds?: ReadonlySet<string> | undefined;
  transactionAnnotations?: readonly TransactionAnnotation[] | undefined;
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

interface OneSidedTransferActivity {
  assetId: string;
  assetSymbol: string;
  direction: LinkGapDirection;
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

interface ServiceSwapCueCandidate {
  accountId: number;
  assetId: string;
  blockchainName: string;
  direction: LinkGapDirection;
  issueKey: string;
  selfAddress: string;
  timestampMs: number;
}

interface PairedGapCueCandidate {
  accountId: number;
  assetId: string;
  assetSymbol: string;
  blockchainName: string;
  counterpartyAddress?: string | undefined;
  direction: LinkGapDirection;
  isNativeAsset: boolean;
  issueKey: string;
  profileId: number;
  selfAddress: string;
  timestampMs: number;
  totalAmount: Decimal;
  txFingerprint: string;
}

interface GapCueAnnotation {
  cue: GapCueKind;
  counterpartTxFingerprint?: string | undefined;
}

function buildAnnotationsByTransactionId(
  transactionAnnotations: readonly TransactionAnnotation[] | undefined
): Map<number, readonly TransactionAnnotation[]> {
  const annotationsByTransactionId = new Map<number, TransactionAnnotation[]>();

  for (const annotation of transactionAnnotations ?? []) {
    const existing = annotationsByTransactionId.get(annotation.transactionId);
    if (existing) {
      existing.push(annotation);
      continue;
    }

    annotationsByTransactionId.set(annotation.transactionId, [annotation]);
  }

  return annotationsByTransactionId;
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

function isTransferReceiveTransaction(tx: Transaction): boolean {
  return tx.operation.category === 'transfer' && (tx.operation.type === 'deposit' || tx.operation.type === 'transfer');
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

function getBridgeParticipantAnnotationForDirection(
  annotations: readonly TransactionAnnotation[] | undefined,
  direction: LinkGapDirection
): TransactionAnnotation | undefined {
  const role = direction === 'outflow' ? 'source' : 'target';
  const bridgeAnnotations = annotations?.filter(
    (annotation) => annotation.kind === 'bridge_participant' && annotation.role === role
  );
  if (!bridgeAnnotations || bridgeAnnotations.length === 0) {
    return undefined;
  }

  return bridgeAnnotations.find((annotation) => annotation.tier === 'asserted') ?? bridgeAnnotations[0];
}

function formatBridgeContextLabel(annotation: TransactionAnnotation): string {
  if (annotation.tier === 'asserted') {
    return annotation.protocolRef ? `bridge participant (${annotation.protocolRef.id})` : 'bridge participant';
  }

  return 'heuristic bridge participant';
}

function buildBridgeContextMessage(annotation: TransactionAnnotation): string {
  if (annotation.tier === 'asserted') {
    if (annotation.protocolRef) {
      return `Transaction carries asserted bridge interpretation for protocol ${annotation.protocolRef.id}.`;
    }

    return 'Transaction carries asserted bridge interpretation.';
  }

  return 'Transaction carries heuristic bridge interpretation derived from same-owner cross-chain bridge evidence.';
}

function getBridgeCounterpartTxFingerprint(annotation: TransactionAnnotation): string | undefined {
  const counterpartTxFingerprint = annotation.metadata?.['counterpartTxFingerprint'];
  return typeof counterpartTxFingerprint === 'string' && counterpartTxFingerprint.length > 0
    ? counterpartTxFingerprint
    : undefined;
}

function getAssetMigrationParticipantAnnotationForDirection(
  annotations: readonly TransactionAnnotation[] | undefined,
  direction: LinkGapDirection
): TransactionAnnotation | undefined {
  const role = direction === 'outflow' ? 'source' : 'target';
  const migrationAnnotations = annotations?.filter(
    (annotation) => annotation.kind === 'asset_migration_participant' && annotation.role === role
  );
  if (!migrationAnnotations || migrationAnnotations.length === 0) {
    return undefined;
  }

  return migrationAnnotations.find((annotation) => annotation.tier === 'asserted') ?? migrationAnnotations[0];
}

function formatAssetMigrationContextLabel(annotation: TransactionAnnotation): string {
  if (annotation.tier === 'asserted') {
    return 'asset migration participant';
  }

  return 'possible asset migration';
}

function buildAssetMigrationContextMessage(annotation: TransactionAnnotation): string {
  const providerSubtype = annotation.metadata?.['providerSubtype'];
  if (typeof providerSubtype === 'string' && providerSubtype.length > 0) {
    return `Transaction carries heuristic asset migration interpretation from ${providerSubtype} rows.`;
  }

  if (annotation.tier === 'asserted') {
    return 'Transaction carries asserted asset migration interpretation.';
  }

  return 'Transaction carries heuristic asset migration interpretation.';
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

function getOneSidedTransferActivity(
  tx: Transaction,
  excludedAssetIds?: ReadonlySet<string>
): OneSidedTransferActivity | undefined {
  const inflowTotals = buildPositiveAssetTotalsByAssetId(
    filterTransferEligibleMovements(tx.movements.inflows),
    excludedAssetIds
  );
  const outflowTotals = buildPositiveAssetTotalsByAssetId(
    filterTransferEligibleMovements(tx.movements.outflows),
    excludedAssetIds
  );

  if (outflowTotals.size === 0 && inflowTotals.size > 0 && isTransferReceiveTransaction(tx)) {
    const entry = getSingleAssetEntryById(inflowTotals);
    if (!entry) {
      return undefined;
    }

    const [assetId, { assetSymbol, amount: totalAmount }] = entry;
    return {
      assetId,
      assetSymbol,
      direction: 'inflow',
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
      direction: 'outflow',
      timestampMs: tx.timestamp,
      totalAmount,
      transaction: tx,
    };
  }

  return undefined;
}

function getOneSidedBlockchainActivity(
  tx: Transaction,
  excludedAssetIds?: ReadonlySet<string>
): OneSidedBlockchainActivity | undefined {
  if (!tx.blockchain) {
    return undefined;
  }

  const activity = getOneSidedTransferActivity(tx, excludedAssetIds);
  if (activity === undefined) {
    return undefined;
  }

  if (activity.direction === 'inflow' && isExcludedInflowGapTransaction(tx)) {
    return undefined;
  }

  return {
    ...activity,
    blockchainName: tx.blockchain.name,
    selfAddress: normalizeAddress(activity.direction === 'inflow' ? tx.to : tx.from),
  };
}

function calculateOneSidedActivityFiatValue(activity: OneSidedBlockchainActivity): Decimal | undefined {
  const pricedMovements = filterTransferEligibleMovements(
    activity.direction === 'inflow' ? activity.transaction.movements.inflows : activity.transaction.movements.outflows
  ).filter((movement) => movement.assetId === activity.assetId);

  if (pricedMovements.length === 0) {
    return undefined;
  }

  let totalFiatValue = parseDecimal('0');
  for (const movement of pricedMovements) {
    const amount = movement.netAmount ?? movement.grossAmount;
    if (!amount.greaterThan(0)) {
      continue;
    }

    const priceAtTxTime = movement.priceAtTxTime?.price.amount;
    if (priceAtTxTime === undefined) {
      return undefined;
    }

    totalFiatValue = totalFiatValue.plus(amount.times(priceAtTxTime));
  }

  return totalFiatValue;
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
  transactionAnnotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>;
  tx: Transaction;
  uncoveredAmount: Decimal;
}): LinkGapIssue {
  const {
    tx,
    assetId,
    assetSymbol,
    uncoveredAmount,
    totalAmount,
    confirmedAmount,
    suggestedLinks,
    direction,
    transactionAnnotationsByTransactionId,
  } = params;

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
    contextHint: deriveGapContextHint(tx, direction, transactionAnnotationsByTransactionId.get(tx.id)),
  };
}

function deriveGapContextHint(
  tx: Transaction,
  direction: LinkGapDirection,
  annotations: readonly TransactionAnnotation[] | undefined
): GapContextHint | undefined {
  const bridgeAnnotation = getBridgeParticipantAnnotationForDirection(annotations, direction);
  if (bridgeAnnotation) {
    return {
      kind: 'annotation',
      code: bridgeAnnotation.kind,
      label: formatBridgeContextLabel(bridgeAnnotation),
      message: buildBridgeContextMessage(bridgeAnnotation),
    };
  }

  const assetMigrationAnnotation = getAssetMigrationParticipantAnnotationForDirection(annotations, direction);
  if (assetMigrationAnnotation) {
    return {
      kind: 'annotation',
      code: assetMigrationAnnotation.kind,
      label: formatAssetMigrationContextLabel(assetMigrationAnnotation),
      message: buildAssetMigrationContextMessage(assetMigrationAnnotation),
    };
  }

  for (const code of GAP_DIAGNOSTIC_PRIORITY) {
    const diagnostic = tx.diagnostics?.find((entry) => entry.code === code);
    if (!diagnostic) {
      continue;
    }

    return {
      kind: 'diagnostic',
      code: diagnostic.code,
      label: formatGapDiagnosticContextLabel(diagnostic.code, diagnostic.message),
      message: diagnostic.message,
    };
  }

  return deriveGapMovementRoleContextHint(tx);
}

function deriveGapMovementRoleContextHint(tx: Transaction): GapContextHint | undefined {
  const movementRoles = new Set<Exclude<MovementRole, 'principal'>>();
  const movements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? [])];

  for (const movement of movements) {
    const movementRole = getMovementRole(movement);
    if (movementRole === 'principal') {
      continue;
    }

    movementRoles.add(movementRole);
  }

  for (const movementRole of GAP_MOVEMENT_ROLE_CONTEXT_PRIORITY) {
    if (!movementRoles.has(movementRole)) {
      continue;
    }

    return {
      kind: 'movement_role',
      code: movementRole,
      label: formatGapMovementRoleContextLabel(movementRole),
      message: buildGapMovementRoleContextMessage(movementRole),
    };
  }

  return undefined;
}

function formatGapDiagnosticContextLabel(code: string, message: string): string {
  if (code === 'staking_withdrawal') {
    return 'staking withdrawal in same tx';
  }

  if (code === 'unsolicited_dust_fanout') {
    return 'unsolicited dust fan-out';
  }

  if (code === 'allocation_uncertain') {
    return 'allocation uncertainty';
  }

  if (code === 'classification_uncertain') {
    if (message.toLowerCase().includes('staking withdrawal')) {
      return 'staking withdrawal in same tx';
    }

    return 'classification uncertainty';
  }

  if (code === 'classification_failed') {
    return 'classification failed';
  }

  if (code === 'batch_operation') {
    return 'batch operation';
  }

  if (code === 'proxy_operation') {
    return 'proxy operation';
  }

  if (code === 'multisig_operation') {
    return 'multisig operation';
  }

  if (code === 'exchange_deposit_address_credit') {
    return 'credit into exchange deposit address';
  }

  return code.replace(/_/g, ' ');
}

function formatGapMovementRoleContextLabel(movementRole: Exclude<MovementRole, 'principal'>): string {
  switch (movementRole) {
    case 'staking_reward':
      return 'staking reward in same tx';
    case 'protocol_overhead':
      return 'protocol overhead in same tx';
    case 'refund_rebate':
      return 'refund or rebate in same tx';
  }
}

function buildGapMovementRoleContextMessage(movementRole: Exclude<MovementRole, 'principal'>): string {
  switch (movementRole) {
    case 'staking_reward':
      return 'Transaction includes a staking reward movement that is excluded from transfer matching.';
    case 'protocol_overhead':
      return 'Transaction includes a protocol-overhead movement that is excluded from transfer matching.';
    case 'refund_rebate':
      return 'Transaction includes a refund or rebate movement that is excluded from transfer matching.';
  }
}

function buildTransactionById(transactions: readonly Transaction[]): Map<number, Transaction> {
  const transactionById = new Map<number, Transaction>();

  for (const tx of transactions) {
    transactionById.set(tx.id, tx);
  }

  return transactionById;
}

function buildServiceSwapCueCandidates(
  issues: readonly LinkGapIssue[],
  transactionById: ReadonlyMap<number, Transaction>
): ServiceSwapCueCandidate[] {
  const candidates: ServiceSwapCueCandidate[] = [];

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

function isBlockchainNativeAsset(assetId: string, blockchainName: string): boolean {
  const parsedAssetId = parseAssetId(assetId);
  return (
    parsedAssetId.isOk() &&
    parsedAssetId.value.namespace === 'blockchain' &&
    parsedAssetId.value.chain === blockchainName &&
    parsedAssetId.value.ref === 'native'
  );
}

function hasAmountSimilarity(leftAmount: Decimal, rightAmount: Decimal, minRatio: Decimal): boolean {
  const largerAmount = leftAmount.greaterThan(rightAmount) ? leftAmount : rightAmount;
  const smallerAmount = leftAmount.greaterThan(rightAmount) ? rightAmount : leftAmount;
  if (largerAmount.isZero()) {
    return false;
  }

  return smallerAmount.dividedBy(largerAmount).greaterThanOrEqualTo(minRatio);
}

function getCorrelatedServiceSwapCue(windowCandidates: readonly ServiceSwapCueCandidate[]): GapCueKind | undefined {
  if (windowCandidates.length < 2) {
    return undefined;
  }

  const directions = new Set(windowCandidates.map((candidate) => candidate.direction));
  if (!directions.has('inflow') || !directions.has('outflow')) {
    return undefined;
  }

  const nonNativeCandidates = windowCandidates.filter(
    (candidate) => !isBlockchainNativeAsset(candidate.assetId, candidate.blockchainName)
  );
  if (nonNativeCandidates.length < 2) {
    return undefined;
  }

  const nonNativeDirections = new Set(nonNativeCandidates.map((candidate) => candidate.direction));
  if (!nonNativeDirections.has('inflow') || !nonNativeDirections.has('outflow')) {
    return undefined;
  }

  const nonNativeAssetIds = new Set(nonNativeCandidates.map((candidate) => candidate.assetId));
  if (nonNativeAssetIds.size < 2) {
    return undefined;
  }

  return 'likely_correlated_service_swap';
}

function detectCorrelatedServiceSwapCueIssueKeys(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[]
): Map<string, GapCueKind> {
  const transactionById = buildTransactionById(transactions);
  const candidates = buildServiceSwapCueCandidates(issues, transactionById);
  if (candidates.length === 0) {
    return new Map<string, GapCueKind>();
  }

  const candidatesByGroup = new Map<string, ServiceSwapCueCandidate[]>();
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

function buildPairedGapCueCandidates(
  issues: readonly LinkGapIssue[],
  transactionById: ReadonlyMap<number, Transaction>,
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>
): PairedGapCueCandidate[] {
  const candidates: PairedGapCueCandidate[] = [];

  for (const issue of issues) {
    const tx = transactionById.get(issue.transactionId);
    if (!tx?.blockchain) {
      continue;
    }

    const accountContext = accountContextById.get(tx.accountId);
    if (accountContext?.profileId === undefined) {
      continue;
    }

    const selfAddress = normalizeAddress(issue.direction === 'inflow' ? tx.to : tx.from);
    if (selfAddress === undefined || normalizeAddress(accountContext.identifier) !== selfAddress) {
      continue;
    }

    candidates.push({
      accountId: tx.accountId,
      assetId: issue.assetId,
      assetSymbol: issue.assetSymbol.toUpperCase(),
      blockchainName: tx.blockchain.name,
      counterpartyAddress: getCounterpartyAddress({
        assetId: issue.assetId,
        assetSymbol: issue.assetSymbol.toUpperCase(),
        blockchainName: tx.blockchain.name,
        direction: issue.direction,
        selfAddress,
        timestampMs: tx.timestamp,
        totalAmount: parseDecimal(issue.totalAmount),
        transaction: tx,
      }),
      direction: issue.direction,
      isNativeAsset: isBlockchainNativeAssetForTransaction(tx, issue.assetId),
      issueKey: buildLinkGapIssueKey({
        txFingerprint: issue.txFingerprint,
        assetId: issue.assetId,
        direction: issue.direction,
      }),
      profileId: accountContext.profileId,
      selfAddress,
      timestampMs: tx.timestamp,
      totalAmount: parseDecimal(issue.totalAmount),
      txFingerprint: issue.txFingerprint,
    });
  }

  return candidates;
}

function isLikelyCrossChainMigrationCuePair(left: PairedGapCueCandidate, right: PairedGapCueCandidate): boolean {
  if (left.direction === right.direction) {
    return false;
  }

  if (left.profileId !== right.profileId || left.accountId === right.accountId) {
    return false;
  }

  if (left.blockchainName === right.blockchainName || left.assetId === right.assetId) {
    return false;
  }

  if (
    left.assetSymbol !== right.assetSymbol ||
    !hasAmountSimilarity(left.totalAmount, right.totalAmount, CROSS_CHAIN_MIGRATION_MIN_RATIO)
  ) {
    return false;
  }

  return Math.abs(left.timestampMs - right.timestampMs) <= CROSS_CHAIN_MIGRATION_CUE_WINDOW_MS;
}

function addCuePairMatch(
  matchesByIssueKey: Map<string, Set<string>>,
  leftIssueKey: string,
  rightIssueKey: string
): void {
  addValueToSetMap(matchesByIssueKey, leftIssueKey, rightIssueKey);
  addValueToSetMap(matchesByIssueKey, rightIssueKey, leftIssueKey);
}

function addValueToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key) ?? new Set<string>();
  existing.add(value);
  map.set(key, existing);
}

function findUniquePairedCueCounterparts(
  candidates: readonly PairedGapCueCandidate[],
  isPairMatch: (left: PairedGapCueCandidate, right: PairedGapCueCandidate) => boolean
): Map<string, PairedGapCueCandidate> {
  if (candidates.length < 2) {
    return new Map<string, PairedGapCueCandidate>();
  }

  const outflowCandidates = candidates.filter((candidate) => candidate.direction === 'outflow');
  const inflowCandidates = candidates.filter((candidate) => candidate.direction === 'inflow');
  const candidateByIssueKey = new Map(candidates.map((candidate) => [candidate.issueKey, candidate]));
  const matchesByIssueKey = new Map<string, Set<string>>();

  for (const outflowCandidate of outflowCandidates) {
    for (const inflowCandidate of inflowCandidates) {
      if (!isPairMatch(outflowCandidate, inflowCandidate)) {
        continue;
      }

      addCuePairMatch(matchesByIssueKey, outflowCandidate.issueKey, inflowCandidate.issueKey);
    }
  }

  const counterpartByIssueKey = new Map<string, PairedGapCueCandidate>();
  for (const [issueKey, matches] of matchesByIssueKey.entries()) {
    if (matches.size !== 1) {
      continue;
    }

    const [counterpartIssueKey] = matches;
    const counterpartMatches = counterpartIssueKey ? matchesByIssueKey.get(counterpartIssueKey) : undefined;
    if (counterpartIssueKey === undefined || counterpartMatches?.size !== 1 || !counterpartMatches.has(issueKey)) {
      continue;
    }

    const counterpartCandidate = candidateByIssueKey.get(counterpartIssueKey);
    if (counterpartCandidate === undefined) {
      continue;
    }

    counterpartByIssueKey.set(issueKey, counterpartCandidate);
  }

  return counterpartByIssueKey;
}

function detectUniquePairedCueAnnotations(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[],
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>,
  isPairMatch: (left: PairedGapCueCandidate, right: PairedGapCueCandidate) => boolean,
  cue: GapCueKind
): Map<string, GapCueAnnotation> {
  const transactionById = buildTransactionById(transactions);
  const candidates = buildPairedGapCueCandidates(issues, transactionById, accountContextById);
  const counterpartByIssueKey = findUniquePairedCueCounterparts(candidates, isPairMatch);
  const cueByIssueKey = new Map<string, GapCueAnnotation>();
  for (const [issueKey, counterpartCandidate] of counterpartByIssueKey.entries()) {
    cueByIssueKey.set(issueKey, {
      cue,
      counterpartTxFingerprint: counterpartCandidate.txFingerprint,
    });
  }

  return cueByIssueKey;
}

function detectCrossChainMigrationCueIssueKeys(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[],
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>
): Map<string, GapCueAnnotation> {
  return detectUniquePairedCueAnnotations(
    issues,
    transactions,
    accountContextById,
    isLikelyCrossChainMigrationCuePair,
    'likely_cross_chain_migration'
  );
}

function detectBridgeCueIssueKeysFromAnnotations(
  issues: readonly LinkGapIssue[],
  transactionAnnotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>
): Map<string, GapCueAnnotation> {
  const cueByIssueKey = new Map<string, GapCueAnnotation>();

  for (const issue of issues) {
    const bridgeAnnotation = getBridgeParticipantAnnotationForDirection(
      transactionAnnotationsByTransactionId.get(issue.transactionId),
      issue.direction
    );
    const counterpartTxFingerprint = bridgeAnnotation ? getBridgeCounterpartTxFingerprint(bridgeAnnotation) : undefined;
    if (counterpartTxFingerprint === undefined) {
      continue;
    }

    cueByIssueKey.set(
      buildLinkGapIssueKey({
        txFingerprint: issue.txFingerprint,
        assetId: issue.assetId,
        direction: issue.direction,
      }),
      {
        cue: 'likely_cross_chain_bridge',
        counterpartTxFingerprint,
      }
    );
  }

  return cueByIssueKey;
}

interface PossibleAssetMigrationCueCandidate {
  accountId: number;
  assetId: string;
  direction: LinkGapDirection;
  issueKey: string;
  migrationGroupKey?: string | undefined;
  platformKey: string;
  platformKind: Transaction['platformKind'];
  timestampMs: number;
  totalAmount: Decimal;
  txFingerprint: string;
}

function buildPossibleAssetMigrationCueCandidates(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[],
  transactionAnnotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>,
  excludedAssetIds?: ReadonlySet<string>
): PossibleAssetMigrationCueCandidate[] {
  const transactionById = buildTransactionById(transactions);
  const candidates: PossibleAssetMigrationCueCandidate[] = [];

  for (const issue of issues) {
    const tx = transactionById.get(issue.transactionId);
    if (tx?.id === undefined) {
      continue;
    }

    const activity = getOneSidedTransferActivity(tx, excludedAssetIds);
    if (
      activity === undefined ||
      activity.assetId !== issue.assetId ||
      activity.direction !== issue.direction ||
      !activity.totalAmount.eq(parseDecimal(issue.totalAmount))
    ) {
      continue;
    }

    const assetMigrationAnnotation = getAssetMigrationParticipantAnnotationForDirection(
      transactionAnnotationsByTransactionId.get(issue.transactionId),
      issue.direction
    );
    if (assetMigrationAnnotation === undefined) {
      continue;
    }

    candidates.push({
      accountId: tx.accountId,
      assetId: activity.assetId,
      direction: activity.direction,
      issueKey: buildLinkGapIssueKey({
        txFingerprint: issue.txFingerprint,
        assetId: issue.assetId,
        direction: issue.direction,
      }),
      ...(assetMigrationAnnotation.groupKey === undefined
        ? {}
        : { migrationGroupKey: assetMigrationAnnotation.groupKey }),
      platformKey: tx.platformKey,
      platformKind: tx.platformKind,
      timestampMs: activity.timestampMs,
      totalAmount: activity.totalAmount,
      txFingerprint: tx.txFingerprint,
    });
  }

  return candidates;
}

function findPossibleAssetMigrationCueCounterparts(
  candidate: PossibleAssetMigrationCueCandidate,
  candidates: readonly PossibleAssetMigrationCueCandidate[]
): PossibleAssetMigrationCueCandidate[] {
  const baseMatches = candidates.filter(
    (other) =>
      other.issueKey !== candidate.issueKey &&
      other.accountId === candidate.accountId &&
      other.platformKey === candidate.platformKey &&
      other.platformKind === candidate.platformKind &&
      other.direction !== candidate.direction &&
      other.assetId !== candidate.assetId &&
      hasAmountSimilarity(candidate.totalAmount, other.totalAmount, CROSS_CHAIN_MIGRATION_MIN_RATIO)
  );

  if (candidate.migrationGroupKey !== undefined) {
    const sameGroupMatches = baseMatches.filter((other) => other.migrationGroupKey === candidate.migrationGroupKey);
    if (sameGroupMatches.length === 1) {
      return sameGroupMatches;
    }
  }

  return baseMatches.filter(
    (other) => Math.abs(other.timestampMs - candidate.timestampMs) <= POSSIBLE_ASSET_MIGRATION_CUE_WINDOW_MS
  );
}

function detectPossibleAssetMigrationCueIssueKeys(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[],
  transactionAnnotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>,
  excludedAssetIds?: ReadonlySet<string>
): Map<string, GapCueAnnotation> {
  const candidates = buildPossibleAssetMigrationCueCandidates(
    issues,
    transactions,
    transactionAnnotationsByTransactionId,
    excludedAssetIds
  );
  if (candidates.length === 0) {
    return new Map<string, GapCueAnnotation>();
  }

  const cueByIssueKey = new Map<string, GapCueAnnotation>();

  for (const candidate of candidates) {
    const counterparts = findPossibleAssetMigrationCueCounterparts(candidate, candidates);
    if (counterparts.length !== 1) {
      continue;
    }

    const counterpart = counterparts[0]!;
    cueByIssueKey.set(candidate.issueKey, {
      cue: 'likely_asset_migration',
      counterpartTxFingerprint: counterpart.txFingerprint,
    });
  }

  return cueByIssueKey;
}

function isLikelyServiceSwapFundingReceiptPair(
  fundingCandidate: PairedGapCueCandidate,
  receiptCandidate: PairedGapCueCandidate
): boolean {
  if (
    fundingCandidate.direction !== 'outflow' ||
    receiptCandidate.direction !== 'inflow' ||
    !fundingCandidate.isNativeAsset ||
    receiptCandidate.isNativeAsset ||
    fundingCandidate.issueKey === receiptCandidate.issueKey
  ) {
    return false;
  }

  if (
    fundingCandidate.profileId !== receiptCandidate.profileId ||
    fundingCandidate.accountId !== receiptCandidate.accountId ||
    fundingCandidate.blockchainName !== receiptCandidate.blockchainName ||
    fundingCandidate.selfAddress !== receiptCandidate.selfAddress
  ) {
    return false;
  }

  if (fundingCandidate.counterpartyAddress === undefined || receiptCandidate.counterpartyAddress === undefined) {
    return false;
  }

  if (
    fundingCandidate.counterpartyAddress === fundingCandidate.selfAddress ||
    receiptCandidate.counterpartyAddress === receiptCandidate.selfAddress ||
    receiptCandidate.counterpartyAddress === fundingCandidate.counterpartyAddress ||
    receiptCandidate.assetId === fundingCandidate.assetId
  ) {
    return false;
  }

  if (
    fundingCandidate.timestampMs > receiptCandidate.timestampMs ||
    receiptCandidate.timestampMs - fundingCandidate.timestampMs > LIKELY_SERVICE_FLOW_WINDOW_MS
  ) {
    return false;
  }

  return true;
}

function detectServiceSwapCueIssueKeys(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[],
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>
): Map<string, GapCueAnnotation> {
  return detectUniquePairedCueAnnotations(
    issues,
    transactions,
    accountContextById,
    isLikelyServiceSwapFundingReceiptPair,
    'likely_correlated_service_swap'
  );
}

function detectLikelyDustCueIssueKeys(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[],
  excludedAssetIds?: ReadonlySet<string>
): Map<string, GapCueAnnotation> {
  const transactionById = buildTransactionById(transactions);
  const cueByIssueKey = new Map<string, GapCueAnnotation>();

  for (const issue of issues) {
    if (issue.suggestedCount > 0) {
      continue;
    }

    const transaction = transactionById.get(issue.transactionId);
    if (transaction === undefined) {
      continue;
    }

    const activity = getOneSidedBlockchainActivity(transaction, excludedAssetIds);
    if (
      activity === undefined ||
      activity.assetId !== issue.assetId ||
      activity.direction !== issue.direction ||
      !activity.totalAmount.eq(parseDecimal(issue.totalAmount))
    ) {
      continue;
    }

    if (hasAnyDiagnosticCode(transaction.diagnostics, LIKELY_DUST_DIAGNOSTIC_CODES)) {
      cueByIssueKey.set(
        buildLinkGapIssueKey({
          txFingerprint: issue.txFingerprint,
          assetId: issue.assetId,
          direction: issue.direction,
        }),
        { cue: 'likely_dust' }
      );
      continue;
    }

    const fiatValue = calculateOneSidedActivityFiatValue(activity);
    if (fiatValue === undefined || fiatValue.greaterThan(LIKELY_DUST_MAX_FIAT_VALUE)) {
      continue;
    }

    cueByIssueKey.set(
      buildLinkGapIssueKey({
        txFingerprint: issue.txFingerprint,
        assetId: issue.assetId,
        direction: issue.direction,
      }),
      { cue: 'likely_dust' }
    );
  }

  return cueByIssueKey;
}

function mergeGapCueIssueKeys(
  ...cueMaps: readonly ReadonlyMap<string, GapCueAnnotation>[]
): Map<string, GapCueAnnotation> {
  const merged = new Map<string, GapCueAnnotation>();

  for (const cueMap of cueMaps) {
    for (const [issueKey, cue] of cueMap.entries()) {
      if (!merged.has(issueKey)) {
        merged.set(issueKey, cue);
      }
    }
  }

  return merged;
}

function detectGapCueIssueKeys(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[],
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>,
  transactionAnnotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>,
  excludedAssetIds?: ReadonlySet<string>
): Map<string, GapCueAnnotation> {
  const serviceSwapCues = detectServiceSwapCueIssueKeys(issues, transactions, accountContextById);
  const correlatedServiceSwapCues = detectCorrelatedServiceSwapCueIssueKeys(issues, transactions);
  const correlatedServiceSwapAnnotations = new Map(
    [...correlatedServiceSwapCues.entries()].map(([issueKey, cue]) => [issueKey, { cue } satisfies GapCueAnnotation])
  );

  return mergeGapCueIssueKeys(
    serviceSwapCues,
    correlatedServiceSwapAnnotations,
    detectPossibleAssetMigrationCueIssueKeys(
      issues,
      transactions,
      transactionAnnotationsByTransactionId,
      excludedAssetIds
    ),
    detectCrossChainMigrationCueIssueKeys(issues, transactions, accountContextById),
    detectBridgeCueIssueKeysFromAnnotations(issues, transactionAnnotationsByTransactionId),
    detectLikelyDustCueIssueKeys(issues, transactions, excludedAssetIds)
  );
}

function applyGapCues(
  issues: readonly LinkGapIssue[],
  transactions: readonly Transaction[],
  accountContextById: ReadonlyMap<number, GapAnalysisAccountContext>,
  transactionAnnotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>,
  excludedAssetIds?: ReadonlySet<string>
): LinkGapIssue[] {
  const cueByIssueKey = detectGapCueIssueKeys(
    issues,
    transactions,
    accountContextById,
    transactionAnnotationsByTransactionId,
    excludedAssetIds
  );
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
      )?.cue ?? issue.gapCue,
    gapCueCounterpartTxFingerprint:
      cueByIssueKey.get(
        buildLinkGapIssueKey({
          txFingerprint: issue.txFingerprint,
          assetId: issue.assetId,
          direction: issue.direction,
        })
      )?.counterpartTxFingerprint ?? issue.gapCueCounterpartTxFingerprint,
  }));
}

function shouldSuppressGapByPolicy(tx: Transaction): boolean {
  if (tx.excludedFromAccounting === true) {
    return true;
  }

  if (hasAnyDiagnosticCode(tx.diagnostics, GAP_SUPPRESSION_DIAGNOSTIC_CODES)) {
    return true;
  }

  return getTransactionScamAssessment(tx) !== undefined;
}

function isFullyExplainedTargetResidualGap(
  confirmedLinks: readonly TransactionLink[],
  uncoveredAmount: Decimal
): boolean {
  if (!uncoveredAmount.gt(0) || confirmedLinks.length === 0) {
    return false;
  }

  const explainedResidual = getExplainedTargetResidual(confirmedLinks);
  return explainedResidual?.role === 'staking_reward' && explainedResidual.amount.eq(uncoveredAmount);
}

function shouldSuppressExchangeFiatInflowGap(tx: Transaction, assetSymbol: string): boolean {
  return tx.platformKind === 'exchange' && isFiat(assetSymbol as Currency);
}

function collectInflowGapIssues(
  transactions: readonly Transaction[],
  coverageIndex: LinkCoverageIndex,
  suppressedTxIds: ReadonlySet<number>,
  transactionAnnotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>,
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
    if (
      inflows.length === 0 ||
      outflows.length > 0 ||
      !isTransferReceiveTransaction(tx) ||
      isExcludedInflowGapTransaction(tx)
    ) {
      continue;
    }

    const inflowTotals = buildPositiveAssetTotalsByAssetId(inflows, excludedAssetIds);
    for (const [assetId, { amount: totalAmount, assetSymbol }] of inflowTotals.entries()) {
      if (shouldSuppressExchangeFiatInflowGap(tx, assetSymbol)) {
        continue;
      }

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

      if (isFullyExplainedTargetResidualGap(confirmedForAsset, uncoveredAmount)) {
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
          transactionAnnotationsByTransactionId,
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
  transactionAnnotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>,
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
          transactionAnnotationsByTransactionId,
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
  const transactionAnnotationsByTransactionId = buildAnnotationsByTransactionId(options.transactionAnnotations);
  const suppressedTxIds = classifySuppressedGapTransactionIds(
    transactions,
    coverageIndex,
    accountContextById,
    options.excludedAssetIds
  );
  const rawIssues = [
    ...collectInflowGapIssues(
      transactions,
      coverageIndex,
      suppressedTxIds,
      transactionAnnotationsByTransactionId,
      options.excludedAssetIds
    ),
    ...collectOutflowGapIssues(
      transactions,
      coverageIndex,
      suppressedTxIds,
      transactionAnnotationsByTransactionId,
      options.excludedAssetIds
    ),
  ];
  // This cue is intentionally local to the gaps lens. It complements, rather than
  // replaces, the existing suppression heuristics for explicit same-account swaps
  // and cross-account service-flow pairs.
  const issues = applyGapCues(
    rawIssues,
    transactions,
    accountContextById,
    transactionAnnotationsByTransactionId,
    options.excludedAssetIds
  );
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

export function applyAssetReviewGapCues(
  analysis: LinkGapAnalysis,
  assetReviewSummaries: readonly AssetReviewSummary[] | undefined
): LinkGapAnalysis {
  if (!assetReviewSummaries || assetReviewSummaries.length === 0) {
    return analysis;
  }

  const unmatchedReferenceAssetIds = new Set(
    assetReviewSummaries.filter(shouldCueUnmatchedReferenceAssetReview).map((summary) => summary.assetId)
  );

  if (unmatchedReferenceAssetIds.size === 0) {
    return analysis;
  }

  let changed = false;
  const issues = analysis.issues.map((issue) => {
    if (issue.gapCue !== undefined || !unmatchedReferenceAssetIds.has(issue.assetId)) {
      return issue;
    }

    changed = true;
    return {
      ...issue,
      gapCue: 'unmatched_reference' as const,
    };
  });

  return changed ? { ...analysis, issues } : analysis;
}

function shouldCueUnmatchedReferenceAssetReview(summary: AssetReviewSummary): boolean {
  if (summary.referenceStatus !== 'unmatched') {
    return false;
  }

  if (!summary.evidence.some((item) => item.kind === 'unmatched-reference')) {
    return false;
  }

  return summary.reviewStatus === 'needs-review' || summary.confirmationIsStale;
}
