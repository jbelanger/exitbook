import { filterTransferEligibleMovements, transactionHasDiagnosticCode, type Transaction } from '@exitbook/core';
import { err, ok, parseAssetId, parseDecimal, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import { computeAnnotationFingerprint, type TransactionAnnotation } from '../annotations/index.js';
import type { InterpretationAccountContext } from '../runtime/transaction-interpretation-source-reader.js';

import type { DetectorOutput } from './transaction-annotation-detector.js';
import type {
  ITransactionAnnotationProfileDetector,
  ProfileDetectorInput,
} from './transaction-annotation-profile-detector.js';

const BRIDGE_DIAGNOSTIC_CODE = 'bridge_transfer';
const DETECTOR_ID = 'heuristic-bridge-participant';
const HEURISTIC_BRIDGE_WINDOW_MS = 60 * 60 * 1000;
const HEURISTIC_BRIDGE_MIN_RECEIPT_RATIO = parseDecimal('0.7');

interface AssetTotalsEntry {
  amount: Decimal;
  assetSymbol: string;
}

interface OneSidedTransferActivity {
  assetId: string;
  assetSymbol: string;
  direction: 'inflow' | 'outflow';
  timestampMs: number;
  totalAmount: Decimal;
  transaction: Transaction;
}

interface OneSidedBlockchainActivity extends OneSidedTransferActivity {
  blockchainName: string;
  selfAddress: string | undefined;
}

interface BridgeHeuristicCandidate {
  accountId: number;
  assetSymbol: string;
  blockchainName: string;
  counterpartyAddress: string | undefined;
  direction: 'inflow' | 'outflow';
  profileId: number;
  selfAddress: string;
  timestampMs: number;
  totalAmount: Decimal;
  transaction: Transaction;
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

function buildPositiveAssetTotalsByAssetId(
  movements: readonly {
    assetId: string;
    assetSymbol: string;
    grossAmount: Decimal;
    netAmount?: Decimal | undefined;
  }[]
): Map<string, AssetTotalsEntry> {
  const totals = new Map<string, AssetTotalsEntry>();

  for (const movement of movements) {
    const amount = movement.netAmount ?? movement.grossAmount;
    if (!amount.greaterThan(0)) {
      continue;
    }

    const existing = totals.get(movement.assetId);
    if (existing !== undefined) {
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

function getOneSidedTransferActivity(tx: Transaction): OneSidedTransferActivity | undefined {
  const inflowTotals = buildPositiveAssetTotalsByAssetId(filterTransferEligibleMovements(tx.movements.inflows));
  const outflowTotals = buildPositiveAssetTotalsByAssetId(filterTransferEligibleMovements(tx.movements.outflows));

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

function getOneSidedBlockchainActivity(tx: Transaction): OneSidedBlockchainActivity | undefined {
  if (!tx.blockchain) {
    return undefined;
  }

  const activity = getOneSidedTransferActivity(tx);
  if (activity === undefined) {
    return undefined;
  }

  return {
    ...activity,
    blockchainName: tx.blockchain.name,
    selfAddress: normalizeAddress(activity.direction === 'inflow' ? tx.to : tx.from),
  };
}

function getCounterpartyAddress(activity: OneSidedBlockchainActivity): string | undefined {
  return activity.direction === 'outflow'
    ? normalizeAddress(activity.transaction.to)
    : normalizeAddress(activity.transaction.from);
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

function buildAccountContextById(
  accounts: readonly InterpretationAccountContext[]
): ReadonlyMap<number, InterpretationAccountContext> {
  return new Map(accounts.map((account) => [account.accountId, account]));
}

function buildCandidates(input: ProfileDetectorInput): BridgeHeuristicCandidate[] {
  const accountContextById = buildAccountContextById(input.accounts);
  const candidates: BridgeHeuristicCandidate[] = [];

  for (const transaction of input.transactions) {
    if (transactionHasDiagnosticCode(transaction, BRIDGE_DIAGNOSTIC_CODE)) {
      continue;
    }

    const activity = getOneSidedBlockchainActivity(transaction);
    if (activity === undefined || activity.selfAddress === undefined) {
      continue;
    }

    if (!isBlockchainNativeAssetForTransaction(transaction, activity.assetId)) {
      continue;
    }

    const accountContext = accountContextById.get(transaction.accountId);
    if (accountContext === undefined) {
      continue;
    }

    if (normalizeAddress(accountContext.identifier) !== activity.selfAddress) {
      continue;
    }

    candidates.push({
      accountId: transaction.accountId,
      assetSymbol: activity.assetSymbol,
      blockchainName: activity.blockchainName,
      counterpartyAddress: getCounterpartyAddress(activity),
      direction: activity.direction,
      profileId: accountContext.profileId,
      selfAddress: activity.selfAddress,
      timestampMs: activity.timestampMs,
      totalAmount: activity.totalAmount,
      transaction,
    });
  }

  return candidates.sort((left, right) => left.transaction.id - right.transaction.id);
}

function isLikelyCrossChainBridgePair(left: BridgeHeuristicCandidate, right: BridgeHeuristicCandidate): boolean {
  if (left.direction === right.direction) {
    return false;
  }

  if (left.profileId !== right.profileId || left.accountId === right.accountId) {
    return false;
  }

  if (left.blockchainName === right.blockchainName) {
    return false;
  }

  if (left.assetSymbol !== right.assetSymbol || left.selfAddress !== right.selfAddress) {
    return false;
  }

  if (left.counterpartyAddress === undefined || right.counterpartyAddress === undefined) {
    return false;
  }

  if (left.counterpartyAddress === left.selfAddress || right.counterpartyAddress === right.selfAddress) {
    return false;
  }

  const outflowCandidate = left.direction === 'outflow' ? left : right;
  const inflowCandidate = left.direction === 'inflow' ? left : right;
  if (!outflowCandidate.totalAmount.greaterThan(inflowCandidate.totalAmount)) {
    return false;
  }

  const receiptRatio = inflowCandidate.totalAmount.dividedBy(outflowCandidate.totalAmount);
  if (receiptRatio.lessThan(HEURISTIC_BRIDGE_MIN_RECEIPT_RATIO)) {
    return false;
  }

  return Math.abs(left.timestampMs - right.timestampMs) <= HEURISTIC_BRIDGE_WINDOW_MS;
}

function findUniqueCounterparts(
  candidates: readonly BridgeHeuristicCandidate[]
): Map<number, BridgeHeuristicCandidate> {
  const matchesByTransactionId = new Map<number, BridgeHeuristicCandidate[]>();

  for (const candidate of candidates) {
    const matches = candidates.filter(
      (other) => other.transaction.id !== candidate.transaction.id && isLikelyCrossChainBridgePair(candidate, other)
    );

    if (matches.length === 1) {
      matchesByTransactionId.set(candidate.transaction.id, matches);
    }
  }

  const counterpartByTransactionId = new Map<number, BridgeHeuristicCandidate>();
  for (const candidate of candidates) {
    const matches = matchesByTransactionId.get(candidate.transaction.id);
    if (matches?.length !== 1) {
      continue;
    }

    const counterpart = matches[0]!;
    const reciprocalMatches = matchesByTransactionId.get(counterpart.transaction.id);
    if (reciprocalMatches?.length !== 1 || reciprocalMatches[0]?.transaction.id !== candidate.transaction.id) {
      continue;
    }

    counterpartByTransactionId.set(candidate.transaction.id, counterpart);
  }

  return counterpartByTransactionId;
}

function buildPairDerivedFromTxIds(leftTransactionId: number, rightTransactionId: number): readonly [number, number] {
  return leftTransactionId < rightTransactionId
    ? [leftTransactionId, rightTransactionId]
    : [rightTransactionId, leftTransactionId];
}

function buildPairGroupKey(leftTxFingerprint: string, rightTxFingerprint: string): string {
  return leftTxFingerprint < rightTxFingerprint
    ? `heuristic-bridge:${leftTxFingerprint}:${rightTxFingerprint}`
    : `heuristic-bridge:${rightTxFingerprint}:${leftTxFingerprint}`;
}

function buildBridgeAnnotation(
  candidate: BridgeHeuristicCandidate,
  counterpart: BridgeHeuristicCandidate,
  role: 'source' | 'target'
): Result<TransactionAnnotation, Error> {
  const metadata =
    role === 'source'
      ? {
          counterpartTxFingerprint: counterpart.transaction.txFingerprint,
          destinationChain: counterpart.blockchainName,
          sourceChain: candidate.blockchainName,
        }
      : {
          counterpartTxFingerprint: counterpart.transaction.txFingerprint,
          destinationChain: candidate.blockchainName,
          sourceChain: counterpart.blockchainName,
        };
  const groupKey = buildPairGroupKey(candidate.transaction.txFingerprint, counterpart.transaction.txFingerprint);
  const annotationFingerprintResult = computeAnnotationFingerprint({
    kind: 'bridge_participant',
    tier: 'heuristic',
    txFingerprint: candidate.transaction.txFingerprint,
    target: { scope: 'transaction' },
    role,
    groupKey,
    metadata,
  });
  if (annotationFingerprintResult.isErr()) {
    return err(annotationFingerprintResult.error);
  }

  return ok({
    annotationFingerprint: annotationFingerprintResult.value,
    accountId: candidate.transaction.accountId,
    transactionId: candidate.transaction.id,
    txFingerprint: candidate.transaction.txFingerprint,
    kind: 'bridge_participant',
    tier: 'heuristic',
    target: { scope: 'transaction' },
    role,
    groupKey,
    detectorId: DETECTOR_ID,
    derivedFromTxIds: buildPairDerivedFromTxIds(candidate.transaction.id, counterpart.transaction.id),
    provenanceInputs: ['timing', 'address_pattern', 'counterparty'],
    metadata,
  });
}

export class HeuristicBridgeParticipantDetector implements ITransactionAnnotationProfileDetector {
  readonly id = DETECTOR_ID;
  readonly kinds = ['bridge_participant'] as const;

  async run(input: ProfileDetectorInput): Promise<Result<DetectorOutput, Error>> {
    const candidates = buildCandidates(input);
    const candidateByTransactionId = new Map(candidates.map((candidate) => [candidate.transaction.id, candidate]));
    const annotations: TransactionAnnotation[] = [];
    const uniqueCounterparts = findUniqueCounterparts(candidates);
    const emittedPairKeys = new Set<string>();

    for (const [transactionId, counterpart] of uniqueCounterparts.entries()) {
      const candidate = candidateByTransactionId.get(transactionId);
      if (candidate === undefined) {
        continue;
      }

      const pairKey = buildPairGroupKey(candidate.transaction.txFingerprint, counterpart.transaction.txFingerprint);
      if (emittedPairKeys.has(pairKey)) {
        continue;
      }
      emittedPairKeys.add(pairKey);

      const outflowCandidate = candidate.direction === 'outflow' ? candidate : counterpart;
      const inflowCandidate = candidate.direction === 'inflow' ? candidate : counterpart;

      const sourceAnnotationResult = buildBridgeAnnotation(outflowCandidate, inflowCandidate, 'source');
      if (sourceAnnotationResult.isErr()) {
        return err(sourceAnnotationResult.error);
      }

      const targetAnnotationResult = buildBridgeAnnotation(inflowCandidate, outflowCandidate, 'target');
      if (targetAnnotationResult.isErr()) {
        return err(targetAnnotationResult.error);
      }

      annotations.push(sourceAnnotationResult.value, targetAnnotationResult.value);
    }

    return ok({ annotations });
  }
}
