import type { AssetMovement, Currency, FeeMovement, UniversalTransactionData } from '@exitbook/core';
import { computeMovementFingerprint, computeTxFingerprint, err, ok, type Result } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import { normalizeTransactionHash } from '../../linking/strategies/exact-hash-utils.js';
import {
  allocateSameHashUtxoAmountInTxOrder,
  planSameHashUtxoSourceCapacities,
} from '../../shared/same-hash-utxo-allocation.js';

// ---------------------------------------------------------------------------
// Types — cost-basis-local, not shared
// ---------------------------------------------------------------------------

export interface ScopedAssetMovement extends AssetMovement {
  movementFingerprint: string;
  rawPosition: number;
}

export interface ScopedFeeMovement extends FeeMovement {
  originalTransactionId: number;
  rawPosition: number;
}

export interface AccountingScopedTransaction {
  tx: UniversalTransactionData;
  /**
   * Raw transaction ids that must accompany this scoped transaction when
   * rebuilding after price filtering, because same-hash scoping consumed
   * sibling rows to produce the current scoped shape.
   */
  rebuildDependencyTransactionIds: number[];
  movements: {
    inflows: ScopedAssetMovement[];
    outflows: ScopedAssetMovement[];
  };
  fees: ScopedFeeMovement[];
}

export interface FeeOnlyInternalCarryoverTarget {
  targetTransactionId: number;
  targetMovementFingerprint: string;
  quantity: Decimal;
}

export interface FeeOnlyInternalCarryover {
  assetId: string;
  assetSymbol: Currency;
  fee: ScopedFeeMovement;
  retainedQuantity: Decimal;
  sourceTransactionId: number;
  sourceMovementFingerprint: string;
  targets: FeeOnlyInternalCarryoverTarget[];
}

export interface AccountingScopedBuildResult {
  inputTransactions: UniversalTransactionData[];
  transactions: AccountingScopedTransaction[];
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[];
}

// ---------------------------------------------------------------------------
// Internal grouping types
// ---------------------------------------------------------------------------

interface CostBasisSameHashParticipant {
  txId: number;
  accountId: number;
  assetId: string;
  inflowGrossAmount: Decimal;
  inflowMovementCount: number;
  outflowGrossAmount: Decimal;
  outflowMovementCount: number;
  onChainFeeAmount: Decimal;
  /** Fingerprint of the single outflow movement (set only when outflowMovementCount === 1) */
  outflowMovementFingerprint: string | undefined;
  /** Fingerprint of the single inflow movement (set only when inflowMovementCount === 1) */
  inflowMovementFingerprint: string | undefined;
}

interface CostBasisSameHashAssetGroup {
  normalizedHash: string;
  blockchain: string;
  assetId: string;
  assetSymbol: string;
  participants: CostBasisSameHashParticipant[];
}

// ---------------------------------------------------------------------------
// Same-hash scoping decisions
// ---------------------------------------------------------------------------

/** A clearly internal same-hash group that still has external transfer quantity. */
interface InternalWithExternalAmount {
  type: 'internal_with_external';
  senderTxId: number;
  assetId: string;
  /** Total tracked internal inflow to subtract from source gross. */
  internalInflowTotal: Decimal;
  /** Deduped on-chain fee amount (max across participants). */
  dedupedFee: Decimal;
  /** Transaction IDs of pure inflow participants whose movements should be removed. */
  internalReceiverTxIds: number[];
}

/** A clearly internal same-hash group where all transfer quantity is internal (fee only). */
interface InternalFeeOnly {
  type: 'internal_fee_only';
  senderTxId: number;
  senderMovementFingerprint: string;
  assetId: string;
  assetSymbol: string;
  /** Deduped on-chain fee amount. */
  dedupedFee: Decimal;
  /** Per-receiver retained quantities. */
  receivers: {
    movementFingerprint: string;
    quantity: Decimal;
    txId: number;
  }[];
}

interface SameHashSourceAllocation {
  txId: number;
  movementFingerprint: string;
  externalAmount: Decimal;
  internalAmount: Decimal;
  feeDeducted: Decimal;
}

interface MultiSourceScopedExternalAmount {
  type: 'multi_source_scoped_external_amount';
  assetId: string;
  dedupedFee: Decimal;
  feeOwnerTxId: number;
  /** Pure inflow participants to remove after external amounts are scoped. */
  internalReceiverTxIds: number[];
  otherParticipantTxIds: number[];
  sourceAllocations: SameHashSourceAllocation[];
}

interface MultiSourceInternalFeeOnly {
  type: 'multi_source_internal_fee_only';
  assetId: string;
  assetSymbol: string;
  dedupedFee: Decimal;
  feeOwnerTxId: number;
  otherParticipantTxIds: number[];
  sourceCarryovers: {
    retainedQuantity: Decimal;
    sourceMovementFingerprint: string;
    sourceTxId: number;
    targets: {
      movementFingerprint: string;
      quantity: Decimal;
      txId: number;
    }[];
  }[];
}

type SameHashDecision =
  | InternalWithExternalAmount
  | InternalFeeOnly
  | MultiSourceScopedExternalAmount
  | MultiSourceInternalFeeOnly;

// ---------------------------------------------------------------------------
// Builder entry point
// ---------------------------------------------------------------------------

/**
 * Build the cost-basis-owned accounting view from processed transactions.
 *
 * This scoped result is the seam for later accounting exclusions: callers can
 * remove scoped movements, assets, or fees after this build step and before
 * price validation or lot matching, without reopening matcher-local UTXO logic.
 */
export function buildCostBasisScopedTransactions(
  transactions: UniversalTransactionData[],
  logger: Logger
): Result<AccountingScopedBuildResult, Error> {
  // Step 1: Clone all transactions into scoped form
  const scopedByTxId = new Map<number, AccountingScopedTransaction>();
  for (const tx of transactions) {
    const cloneResult = cloneScopedTransaction(tx);
    if (cloneResult.isErr()) return err(cloneResult.error);
    scopedByTxId.set(tx.id, cloneResult.value);
  }

  // Step 2: Group same-hash blockchain transactions
  const groupsResult = groupSameHashTransactionsForCostBasis(transactions, scopedByTxId);
  if (groupsResult.isErr()) return err(groupsResult.error);

  // Step 3: Reduce each group and apply scoping decisions
  const feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[] = [];

  for (const group of groupsResult.value) {
    const decisionResult = reduceSameHashGroupForCostBasis(group);
    if (decisionResult.isErr()) return err(decisionResult.error);

    const decision = decisionResult.value;
    if (decision === undefined) continue;

    const applyResult = applyDecisionToScopedTransactions(scopedByTxId, feeOnlyInternalCarryovers, decision, logger);
    if (applyResult.isErr()) return err(applyResult.error);
  }

  return ok({
    inputTransactions: transactions,
    transactions: [...scopedByTxId.values()],
    feeOnlyInternalCarryovers,
  });
}

// ---------------------------------------------------------------------------
// Clone a raw transaction into scoped form
// ---------------------------------------------------------------------------

function cloneScopedTransaction(tx: UniversalTransactionData): Result<AccountingScopedTransaction, Error> {
  const txFpResult = computeTxFingerprint({
    source: tx.source,
    accountId: tx.accountId,
    externalId: tx.externalId,
  });
  if (txFpResult.isErr()) return err(txFpResult.error);
  const txFp = txFpResult.value;

  const inflows: ScopedAssetMovement[] = [];
  for (let i = 0; i < (tx.movements.inflows?.length ?? 0); i++) {
    const raw = tx.movements.inflows![i]!;
    const fpResult = computeMovementFingerprint({ txFingerprint: txFp, movementType: 'inflow', position: i });
    if (fpResult.isErr()) return err(fpResult.error);
    inflows.push({
      assetId: raw.assetId,
      assetSymbol: raw.assetSymbol,
      grossAmount: new Decimal(raw.grossAmount.toString()),
      netAmount: raw.netAmount !== undefined ? new Decimal(raw.netAmount.toString()) : undefined,
      priceAtTxTime: raw.priceAtTxTime,
      movementFingerprint: fpResult.value,
      rawPosition: i,
    });
  }

  const outflows: ScopedAssetMovement[] = [];
  for (let i = 0; i < (tx.movements.outflows?.length ?? 0); i++) {
    const raw = tx.movements.outflows![i]!;
    const fpResult = computeMovementFingerprint({ txFingerprint: txFp, movementType: 'outflow', position: i });
    if (fpResult.isErr()) return err(fpResult.error);
    outflows.push({
      assetId: raw.assetId,
      assetSymbol: raw.assetSymbol,
      grossAmount: new Decimal(raw.grossAmount.toString()),
      netAmount: raw.netAmount !== undefined ? new Decimal(raw.netAmount.toString()) : undefined,
      priceAtTxTime: raw.priceAtTxTime,
      movementFingerprint: fpResult.value,
      rawPosition: i,
    });
  }

  const fees: ScopedFeeMovement[] = [];
  for (let i = 0; i < (tx.fees?.length ?? 0); i++) {
    const raw = tx.fees[i]!;
    fees.push({
      assetId: raw.assetId,
      assetSymbol: raw.assetSymbol,
      amount: new Decimal(raw.amount.toString()),
      originalTransactionId: tx.id,
      scope: raw.scope,
      settlement: raw.settlement,
      priceAtTxTime: raw.priceAtTxTime,
      rawPosition: i,
    });
  }

  return ok({ tx, rebuildDependencyTransactionIds: [], movements: { inflows, outflows }, fees });
}

// ---------------------------------------------------------------------------
// Group same-hash blockchain transactions by (blockchain, normalizedHash, assetId)
// ---------------------------------------------------------------------------

function groupSameHashTransactionsForCostBasis(
  transactions: UniversalTransactionData[],
  scopedByTxId: Map<number, AccountingScopedTransaction>
): Result<CostBasisSameHashAssetGroup[], Error> {
  // Group by (blockchain, normalizedHash)
  const txsByBlockchainAndHash = new Map<
    string,
    { blockchain: string; normalizedHash: string; txs: UniversalTransactionData[] }
  >();

  for (const tx of transactions) {
    if (tx.sourceType !== 'blockchain') continue;
    if (!tx.blockchain?.name || !tx.blockchain?.transaction_hash) continue;

    const hasMovements = (tx.movements.inflows?.length ?? 0) > 0 || (tx.movements.outflows?.length ?? 0) > 0;
    if (!hasMovements) continue;

    const normalizedHash = normalizeTransactionHash(tx.blockchain.transaction_hash);
    const bucketKey = buildSameHashBucketKey(tx.blockchain.name, normalizedHash);
    const entry = txsByBlockchainAndHash.get(bucketKey) ?? {
      blockchain: tx.blockchain.name,
      normalizedHash,
      txs: [],
    };
    entry.txs.push(tx);
    txsByBlockchainAndHash.set(bucketKey, entry);
  }

  const groups: CostBasisSameHashAssetGroup[] = [];

  for (const { normalizedHash, blockchain, txs } of txsByBlockchainAndHash.values()) {
    if (txs.length < 2) continue;

    const accountIds = new Set(txs.map((tx) => tx.accountId));
    if (accountIds.size < 2) continue;

    // Collect all assets involved — key by assetId
    const assetMap = new Map<string, { assetId: string; assetSymbol: string }>();
    for (const tx of txs) {
      for (const inflow of tx.movements.inflows ?? []) {
        const existing = assetMap.get(inflow.assetId);
        if (existing && existing.assetSymbol !== inflow.assetSymbol) {
          return err(
            new Error(
              `Asset identity collision in same-hash group: assetId ${inflow.assetId} has symbols ` +
                `"${existing.assetSymbol}" and "${inflow.assetSymbol}" in hash ${normalizedHash} (${blockchain})`
            )
          );
        }
        assetMap.set(inflow.assetId, { assetId: inflow.assetId, assetSymbol: inflow.assetSymbol });
      }
      for (const outflow of tx.movements.outflows ?? []) {
        const existing = assetMap.get(outflow.assetId);
        if (existing && existing.assetSymbol !== outflow.assetSymbol) {
          return err(
            new Error(
              `Asset identity collision in same-hash group: assetId ${outflow.assetId} has symbols ` +
                `"${existing.assetSymbol}" and "${outflow.assetSymbol}" in hash ${normalizedHash} (${blockchain})`
            )
          );
        }
        assetMap.set(outflow.assetId, { assetId: outflow.assetId, assetSymbol: outflow.assetSymbol });
      }
    }

    // Rule 0: Check for same-symbol different-assetId collisions
    const symbolToAssetIds = new Map<string, Set<string>>();
    for (const { assetId, assetSymbol } of assetMap.values()) {
      const ids = symbolToAssetIds.get(assetSymbol) ?? new Set<string>();
      ids.add(assetId);
      symbolToAssetIds.set(assetSymbol, ids);
    }
    for (const [symbol, ids] of symbolToAssetIds) {
      if (ids.size > 1) {
        return err(
          new Error(
            `Asset identity collision in same-hash group: symbol "${symbol}" maps to multiple assetIds ` +
              `[${[...ids].join(', ')}] in hash ${normalizedHash} (${blockchain})`
          )
        );
      }
    }

    // Build a group per asset
    for (const { assetId, assetSymbol } of assetMap.values()) {
      const participants: CostBasisSameHashParticipant[] = [];

      for (const tx of txs) {
        const scoped = scopedByTxId.get(tx.id)!;

        let inflowGrossAmount = new Decimal(0);
        let outflowGrossAmount = new Decimal(0);
        let inflowMovementCount = 0;
        let outflowMovementCount = 0;
        let outflowMovementFingerprint: string | undefined;
        let inflowMovementFingerprint: string | undefined;

        for (const inflow of scoped.movements.inflows) {
          if (inflow.assetId !== assetId) continue;
          inflowGrossAmount = inflowGrossAmount.plus(inflow.grossAmount);
          inflowMovementCount++;
          if (inflowMovementCount === 1) {
            inflowMovementFingerprint = inflow.movementFingerprint;
          } else {
            inflowMovementFingerprint = undefined;
          }
        }

        for (const outflow of scoped.movements.outflows) {
          if (outflow.assetId !== assetId) continue;
          outflowGrossAmount = outflowGrossAmount.plus(outflow.grossAmount);
          outflowMovementCount++;
          if (outflowMovementCount === 1) {
            outflowMovementFingerprint = outflow.movementFingerprint;
          } else {
            outflowMovementFingerprint = undefined;
          }
        }

        if (inflowGrossAmount.isZero() && outflowGrossAmount.isZero()) continue;

        let onChainFeeAmount = new Decimal(0);
        for (const fee of scoped.fees) {
          if (fee.assetId !== assetId) continue;
          if (fee.settlement !== 'on-chain') continue;
          onChainFeeAmount = onChainFeeAmount.plus(fee.amount);
        }

        participants.push({
          txId: tx.id,
          accountId: tx.accountId,
          assetId,
          inflowGrossAmount,
          inflowMovementCount,
          outflowGrossAmount,
          outflowMovementCount,
          onChainFeeAmount,
          outflowMovementFingerprint,
          inflowMovementFingerprint,
        });
      }

      if (participants.length >= 2) {
        const participantAccountIds = new Set(participants.map((p) => p.accountId));
        if (participantAccountIds.size >= 2) {
          groups.push({ normalizedHash, blockchain, assetId, assetSymbol, participants });
        }
      }
    }
  }

  return ok(groups);
}

// ---------------------------------------------------------------------------
// Reduce a single same-hash group to a scoping decision
// ---------------------------------------------------------------------------

function reduceSameHashGroupForCostBasis(
  group: CostBasisSameHashAssetGroup
): Result<SameHashDecision | undefined, Error> {
  const pureOutflows: CostBasisSameHashParticipant[] = [];
  const pureInflows: CostBasisSameHashParticipant[] = [];
  const mixed: CostBasisSameHashParticipant[] = [];

  for (const p of group.participants) {
    const hasInflow = p.inflowGrossAmount.gt(0);
    const hasOutflow = p.outflowGrossAmount.gt(0);

    if (hasInflow && hasOutflow) {
      mixed.push(p);
    } else if (hasOutflow) {
      pureOutflows.push(p);
    } else if (hasInflow) {
      pureInflows.push(p);
    }
  }

  // Rule 4 (ambiguous): mixed inflow/outflow on same participant
  if (mixed.length > 0) {
    return err(
      new Error(
        `Ambiguous same-hash group: participant has both inflows and outflows for ${group.assetSymbol} ` +
          `in hash ${group.normalizedHash} (${group.blockchain}), participant txIds: [${mixed.map((p) => p.txId).join(', ')}]`
      )
    );
  }

  // Rule 2: pure outflows + pure inflows → internal tracked sibling quantity exists
  if (pureOutflows.length === 0) {
    return ok(undefined);
  }

  // Ambiguity: multi-movement participants
  for (const sender of pureOutflows) {
    if (sender.outflowMovementCount !== 1) {
      return err(
        new Error(
          `Ambiguous same-hash group: sender has ${sender.outflowMovementCount} outflow movements for ${group.assetSymbol} ` +
            `in hash ${group.normalizedHash} (${group.blockchain}), sender txId: ${sender.txId}`
        )
      );
    }
  }

  const planResult = planSameHashSourceAllocations(group, pureOutflows, pureInflows);
  if (planResult.isErr()) {
    return err(planResult.error);
  }

  const { dedupedFee, feeOwnerTxId, externalAmount, sourceAllocations, totalInflows } = planResult.value;

  // Rule 1: pure external multi-source send. No tracked internal inflows exist,
  // but the per-account rows can still duplicate the same on-chain fee.
  if (pureInflows.length === 0) {
    return ok({
      type: 'multi_source_scoped_external_amount',
      assetId: group.assetId,
      dedupedFee,
      feeOwnerTxId,
      internalReceiverTxIds: [],
      otherParticipantTxIds: group.participants
        .map((participant) => participant.txId)
        .filter((txId) => txId !== feeOwnerTxId),
      sourceAllocations,
    });
  }

  for (const receiver of pureInflows) {
    if (receiver.inflowMovementCount !== 1) {
      return err(
        new Error(
          `Ambiguous same-hash group: receiver has ${receiver.inflowMovementCount} inflow movements for ${group.assetSymbol} ` +
            `in hash ${group.normalizedHash} (${group.blockchain}), receiver txId: ${receiver.txId}`
        )
      );
    }
  }

  if (pureOutflows.length === 1) {
    const sender = pureOutflows[0]!;

    if (externalAmount.gt(0)) {
      return ok({
        type: 'internal_with_external',
        senderTxId: sender.txId,
        assetId: group.assetId,
        internalInflowTotal: totalInflows,
        dedupedFee,
        internalReceiverTxIds: pureInflows.map((r) => r.txId),
      });
    }

    return ok({
      type: 'internal_fee_only',
      senderTxId: sender.txId,
      senderMovementFingerprint: sender.outflowMovementFingerprint!,
      assetId: group.assetId,
      assetSymbol: group.assetSymbol,
      dedupedFee,
      receivers: pureInflows.map((r) => ({
        txId: r.txId,
        movementFingerprint: r.inflowMovementFingerprint!,
        quantity: r.inflowGrossAmount,
      })),
    });
  }

  if (externalAmount.gt(0)) {
    return ok({
      type: 'multi_source_scoped_external_amount',
      assetId: group.assetId,
      dedupedFee,
      feeOwnerTxId,
      internalReceiverTxIds: pureInflows.map((receiver) => receiver.txId),
      otherParticipantTxIds: group.participants
        .map((participant) => participant.txId)
        .filter((txId) => txId !== feeOwnerTxId),
      sourceAllocations,
    });
  }

  const carryoverAllocationsResult = allocateSameHashReceiversAcrossSources(sourceAllocations, pureInflows);
  if (carryoverAllocationsResult.isErr()) {
    return err(carryoverAllocationsResult.error);
  }

  return ok({
    type: 'multi_source_internal_fee_only',
    assetId: group.assetId,
    assetSymbol: group.assetSymbol,
    dedupedFee,
    feeOwnerTxId,
    otherParticipantTxIds: group.participants
      .map((participant) => participant.txId)
      .filter((txId) => txId !== feeOwnerTxId),
    sourceCarryovers: carryoverAllocationsResult.value,
  });
}

function planSameHashSourceAllocations(
  group: CostBasisSameHashAssetGroup,
  pureOutflows: CostBasisSameHashParticipant[],
  pureInflows: CostBasisSameHashParticipant[]
): Result<
  {
    dedupedFee: Decimal;
    externalAmount: Decimal;
    feeOwnerTxId: number;
    sourceAllocations: SameHashSourceAllocation[];
    totalInflows: Decimal;
  },
  Error
> {
  let dedupedFee = new Decimal(0);
  for (const participant of group.participants) {
    if (participant.onChainFeeAmount.gt(dedupedFee)) {
      dedupedFee = participant.onChainFeeAmount;
    }
  }

  const capacityPlanResult = planSameHashUtxoSourceCapacities(
    pureOutflows.map((source) => ({
      txId: source.txId,
      grossAmount: source.outflowGrossAmount,
      feeAmount: source.onChainFeeAmount,
    })),
    { dedupedFeeAmount: dedupedFee }
  );
  if (capacityPlanResult.isErr()) {
    return err(
      new Error(
        `Same-hash source allocation failed for ${group.assetSymbol} in hash ${group.normalizedHash} ` +
          `(${group.blockchain}): ${capacityPlanResult.error.message}`
      )
    );
  }
  const capacityPlan = capacityPlanResult.value;
  const outflowsByTxId = new Map(pureOutflows.map((source) => [source.txId, source] as const));

  let totalInflows = new Decimal(0);
  for (const receiver of pureInflows) {
    totalInflows = totalInflows.plus(receiver.inflowGrossAmount);
  }

  const externalAmount = capacityPlan.totalCapacity.minus(totalInflows);
  if (externalAmount.lt(0)) {
    return err(
      new Error(
        `Invalid same-hash group: internal inflows plus deduped fee exceed sender outflow for ${group.assetSymbol} ` +
          `in hash ${group.normalizedHash} (${group.blockchain}), ` +
          `totalSourceCapacity=${capacityPlan.totalCapacity.toFixed()}, internalInflows=${totalInflows.toFixed()}, ` +
          `dedupedFee=${capacityPlan.dedupedFee.toFixed()}, externalAmount=${externalAmount.toFixed()}`
      )
    );
  }

  const sourceAllocations = allocateSameHashUtxoAmountInTxOrder(capacityPlan.capacities, externalAmount);
  if (!sourceAllocations) {
    return err(
      new Error(
        `Invalid same-hash group: external allocation did not reconcile for ${group.assetSymbol} ` +
          `in hash ${group.normalizedHash} (${group.blockchain}), externalAmount=${externalAmount.toFixed()}`
      )
    );
  }

  const mappedSourceAllocations: SameHashSourceAllocation[] = [];
  for (const allocation of sourceAllocations) {
    const source = outflowsByTxId.get(allocation.txId);
    if (!source?.outflowMovementFingerprint) {
      return err(new Error(`Same-hash source tx ${allocation.txId} not found while mapping allocations`));
    }

    mappedSourceAllocations.push({
      txId: allocation.txId,
      movementFingerprint: source.outflowMovementFingerprint,
      externalAmount: allocation.allocatedAmount,
      internalAmount: allocation.unallocatedAmount,
      feeDeducted: allocation.feeDeducted,
    });
  }

  return ok({
    dedupedFee: capacityPlan.dedupedFee,
    externalAmount,
    feeOwnerTxId: capacityPlan.feeOwnerTxId,
    sourceAllocations: mappedSourceAllocations,
    totalInflows,
  });
}

function allocateSameHashReceiversAcrossSources(
  sourceAllocations: SameHashSourceAllocation[],
  pureInflows: CostBasisSameHashParticipant[]
): Result<
  {
    retainedQuantity: Decimal;
    sourceMovementFingerprint: string;
    sourceTxId: number;
    targets: {
      movementFingerprint: string;
      quantity: Decimal;
      txId: number;
    }[];
  }[],
  Error
> {
  const orderedSources = sourceAllocations
    .filter((allocation) => allocation.internalAmount.gt(0))
    .sort((left, right) => left.txId - right.txId)
    .map((allocation) => ({
      ...allocation,
      remainingQuantity: allocation.internalAmount,
      targets: [] as {
        movementFingerprint: string;
        quantity: Decimal;
        txId: number;
      }[],
    }));
  const orderedReceivers = [...pureInflows].sort((left, right) => left.txId - right.txId);

  let sourceIndex = 0;
  for (const receiver of orderedReceivers) {
    let remainingReceiverQuantity = receiver.inflowGrossAmount;

    while (remainingReceiverQuantity.gt(0)) {
      const currentSource = orderedSources[sourceIndex];
      if (!currentSource) {
        return err(
          new Error(
            `Same-hash receiver allocation exhausted source capacity before receiver ${receiver.txId} was satisfied`
          )
        );
      }

      if (currentSource.remainingQuantity.eq(0)) {
        sourceIndex++;
        continue;
      }

      const allocatedQuantity = Decimal.min(currentSource.remainingQuantity, remainingReceiverQuantity);
      currentSource.targets.push({
        txId: receiver.txId,
        movementFingerprint: receiver.inflowMovementFingerprint!,
        quantity: allocatedQuantity,
      });
      currentSource.remainingQuantity = currentSource.remainingQuantity.minus(allocatedQuantity);
      remainingReceiverQuantity = remainingReceiverQuantity.minus(allocatedQuantity);

      if (currentSource.remainingQuantity.eq(0)) {
        sourceIndex++;
      }
    }
  }

  return ok(
    orderedSources.map(({ movementFingerprint, remainingQuantity: _remainingQuantity, targets, ...source }) => ({
      sourceTxId: source.txId,
      sourceMovementFingerprint: movementFingerprint,
      retainedQuantity: source.internalAmount,
      targets,
    }))
  );
}

function applyDecisionToScopedTransactions(
  scopedByTxId: Map<number, AccountingScopedTransaction>,
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[],
  decision: SameHashDecision,
  logger: Logger
): Result<void, Error> {
  if (decision.type === 'internal_with_external') {
    return applyInternalWithExternalAmount(scopedByTxId, decision, logger);
  }

  if (decision.type === 'internal_fee_only') {
    return applyInternalFeeOnly(scopedByTxId, feeOnlyInternalCarryovers, decision, logger);
  }

  if (decision.type === 'multi_source_scoped_external_amount') {
    return applyMultiSourceScopedExternalAmount(scopedByTxId, decision, logger);
  }

  return applyMultiSourceInternalFeeOnly(scopedByTxId, feeOnlyInternalCarryovers, decision, logger);
}

function addScopedRebuildDependencies(
  scopedTransaction: AccountingScopedTransaction,
  dependencyTransactionIds: number[]
): void {
  const existing = new Set(scopedTransaction.rebuildDependencyTransactionIds);
  for (const dependencyTransactionId of dependencyTransactionIds) {
    if (dependencyTransactionId === scopedTransaction.tx.id) {
      continue;
    }

    if (existing.has(dependencyTransactionId)) {
      continue;
    }

    existing.add(dependencyTransactionId);
    scopedTransaction.rebuildDependencyTransactionIds.push(dependencyTransactionId);
  }
}

function applyMultiSourceScopedExternalAmount(
  scopedByTxId: Map<number, AccountingScopedTransaction>,
  decision: MultiSourceScopedExternalAmount,
  logger: Logger
): Result<void, Error> {
  for (const sourceAllocation of decision.sourceAllocations) {
    const sourceScoped = scopedByTxId.get(sourceAllocation.txId);
    if (!sourceScoped) {
      return err(new Error(`Sender scoped transaction ${sourceAllocation.txId} not found`));
    }

    addScopedRebuildDependencies(sourceScoped, decision.internalReceiverTxIds);

    if (sourceAllocation.externalAmount.eq(0)) {
      sourceScoped.movements.outflows = sourceScoped.movements.outflows.filter(
        (movement) => movement.assetId !== decision.assetId
      );
      continue;
    }

    const sourceOutflowResult = getSingleScopedOutflow(sourceScoped, decision.assetId, sourceAllocation.txId);
    if (sourceOutflowResult.isErr()) return err(sourceOutflowResult.error);
    const sourceOutflow = sourceOutflowResult.value;

    sourceOutflow.grossAmount = sourceAllocation.externalAmount.plus(sourceAllocation.feeDeducted);
    sourceOutflow.netAmount = sourceAllocation.externalAmount;
  }

  const feeNormalizationResult = normalizeSameAssetOnChainFeeOwnership(
    scopedByTxId,
    decision.feeOwnerTxId,
    decision.otherParticipantTxIds,
    decision.assetId,
    decision.dedupedFee
  );
  if (feeNormalizationResult.isErr()) return err(feeNormalizationResult.error);

  for (const receiverTxId of decision.internalReceiverTxIds) {
    const receiverScoped = scopedByTxId.get(receiverTxId);
    if (!receiverScoped) continue;

    receiverScoped.movements.inflows = receiverScoped.movements.inflows.filter(
      (movement) => movement.assetId !== decision.assetId
    );
  }

  logger.debug(
    {
      assetId: decision.assetId,
      dedupedFee: decision.dedupedFee.toFixed(),
      feeOwnerTxId: decision.feeOwnerTxId,
      internalReceiverCount: decision.internalReceiverTxIds.length,
      sourceAllocations: decision.sourceAllocations.map((allocation) => ({
        txId: allocation.txId,
        externalAmount: allocation.externalAmount.toFixed(),
        internalAmount: allocation.internalAmount.toFixed(),
        feeDeducted: allocation.feeDeducted.toFixed(),
      })),
    },
    'Applied same-hash scoped external amount (multi-source)'
  );

  return ok(undefined);
}

function applyMultiSourceInternalFeeOnly(
  scopedByTxId: Map<number, AccountingScopedTransaction>,
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[],
  decision: MultiSourceInternalFeeOnly,
  logger: Logger
): Result<void, Error> {
  for (const sourceCarryover of decision.sourceCarryovers) {
    const sourceScoped = scopedByTxId.get(sourceCarryover.sourceTxId);
    if (!sourceScoped) {
      return err(new Error(`Sender scoped transaction ${sourceCarryover.sourceTxId} not found`));
    }

    addScopedRebuildDependencies(
      sourceScoped,
      sourceCarryover.targets.map((target) => target.txId)
    );

    sourceScoped.movements.outflows = sourceScoped.movements.outflows.filter(
      (movement) => movement.assetId !== decision.assetId
    );
  }

  const feeNormalizationResult = normalizeSameAssetOnChainFeeOwnership(
    scopedByTxId,
    decision.feeOwnerTxId,
    decision.otherParticipantTxIds,
    decision.assetId,
    decision.dedupedFee
  );
  if (feeNormalizationResult.isErr()) return err(feeNormalizationResult.error);
  const feeOwnerScopedFee = feeNormalizationResult.value;

  if (feeOwnerScopedFee) {
    for (const sourceCarryover of decision.sourceCarryovers) {
      feeOnlyInternalCarryovers.push({
        assetId: decision.assetId,
        assetSymbol: decision.assetSymbol as Currency,
        fee:
          sourceCarryover.sourceTxId === decision.feeOwnerTxId
            ? feeOwnerScopedFee
            : {
                ...feeOwnerScopedFee,
                amount: new Decimal(0),
              },
        retainedQuantity: sourceCarryover.retainedQuantity,
        sourceTransactionId: sourceCarryover.sourceTxId,
        sourceMovementFingerprint: sourceCarryover.sourceMovementFingerprint,
        targets: sourceCarryover.targets.map((target) => ({
          targetTransactionId: target.txId,
          targetMovementFingerprint: target.movementFingerprint,
          quantity: target.quantity,
        })),
      });
    }
  }

  logger.debug(
    {
      assetId: decision.assetId,
      dedupedFee: decision.dedupedFee.toFixed(),
      feeOwnerTxId: decision.feeOwnerTxId,
      sourceCarryoverCount: decision.sourceCarryovers.length,
    },
    'Applied same-hash internal scoping (multi-source fee-only carryover)'
  );

  return ok(undefined);
}

function applyInternalWithExternalAmount(
  scopedByTxId: Map<number, AccountingScopedTransaction>,
  decision: InternalWithExternalAmount,
  logger: Logger
): Result<void, Error> {
  const senderScoped = scopedByTxId.get(decision.senderTxId);
  if (!senderScoped) {
    return err(new Error(`Sender scoped transaction ${decision.senderTxId} not found`));
  }

  addScopedRebuildDependencies(senderScoped, decision.internalReceiverTxIds);

  const senderOutflowResult = getSingleScopedOutflow(senderScoped, decision.assetId, decision.senderTxId);
  if (senderOutflowResult.isErr()) return err(senderOutflowResult.error);
  const senderOutflow = senderOutflowResult.value;

  // Reduce the source outflow gross by internal inflows
  const newGross = senderOutflow.grossAmount.minus(decision.internalInflowTotal);
  senderOutflow.grossAmount = newGross;
  senderOutflow.netAmount = newGross.minus(decision.dedupedFee);

  const feeNormalizationResult = normalizeSameAssetOnChainFeeOwnership(
    scopedByTxId,
    decision.senderTxId,
    decision.internalReceiverTxIds,
    decision.assetId,
    decision.dedupedFee
  );
  if (feeNormalizationResult.isErr()) return err(feeNormalizationResult.error);

  for (const receiverTxId of decision.internalReceiverTxIds) {
    const receiverScoped = scopedByTxId.get(receiverTxId);
    if (!receiverScoped) continue;

    // Remove same-asset inflow movements from receiver
    receiverScoped.movements.inflows = receiverScoped.movements.inflows.filter((m) => m.assetId !== decision.assetId);
  }

  logger.debug(
    {
      senderTxId: decision.senderTxId,
      assetId: decision.assetId,
      internalInflowTotal: decision.internalInflowTotal.toFixed(),
      dedupedFee: decision.dedupedFee.toFixed(),
    },
    'Applied same-hash internal scoping (with external amount)'
  );

  return ok(undefined);
}

function applyInternalFeeOnly(
  scopedByTxId: Map<number, AccountingScopedTransaction>,
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[],
  decision: InternalFeeOnly,
  logger: Logger
): Result<void, Error> {
  const senderScoped = scopedByTxId.get(decision.senderTxId);
  if (!senderScoped) {
    return err(new Error(`Sender scoped transaction ${decision.senderTxId} not found`));
  }

  addScopedRebuildDependencies(
    senderScoped,
    decision.receivers.map((receiver) => receiver.txId)
  );

  // Remove the source outflow movement (no external transfer quantity)
  senderScoped.movements.outflows = senderScoped.movements.outflows.filter((m) => m.assetId !== decision.assetId);

  const feeNormalizationResult = normalizeSameAssetOnChainFeeOwnership(
    scopedByTxId,
    decision.senderTxId,
    decision.receivers.map((receiver) => receiver.txId),
    decision.assetId,
    decision.dedupedFee
  );
  if (feeNormalizationResult.isErr()) return err(feeNormalizationResult.error);
  const senderFee = feeNormalizationResult.value;

  // Emit carryover sidecar
  if (senderFee) {
    const retainedQuantity = decision.receivers.reduce((sum, r) => sum.plus(r.quantity), new Decimal(0));

    feeOnlyInternalCarryovers.push({
      assetId: decision.assetId,
      assetSymbol: decision.assetSymbol as Currency,
      fee: senderFee,
      retainedQuantity,
      sourceTransactionId: decision.senderTxId,
      sourceMovementFingerprint: decision.senderMovementFingerprint,
      targets: decision.receivers.map((r) => ({
        targetTransactionId: r.txId,
        targetMovementFingerprint: r.movementFingerprint,
        quantity: r.quantity,
      })),
    });
  }

  logger.debug(
    {
      senderTxId: decision.senderTxId,
      assetId: decision.assetId,
      dedupedFee: decision.dedupedFee.toFixed(),
      receiverCount: decision.receivers.length,
    },
    'Applied same-hash internal scoping (fee-only carryover)'
  );

  return ok(undefined);
}

function buildSameHashBucketKey(blockchain: string, normalizedHash: string): string {
  return `${blockchain}:${normalizedHash}`;
}

function getSingleScopedOutflow(
  scoped: AccountingScopedTransaction,
  assetId: string,
  txId: number
): Result<ScopedAssetMovement, Error> {
  const matchingOutflows = scoped.movements.outflows.filter((movement) => movement.assetId === assetId);
  if (matchingOutflows.length !== 1) {
    return err(
      new Error(
        `Expected exactly one scoped outflow for asset ${assetId} in transaction ${txId}, found ${matchingOutflows.length}`
      )
    );
  }

  return ok(matchingOutflows[0]!);
}

function normalizeSameAssetOnChainFeeOwnership(
  scopedByTxId: Map<number, AccountingScopedTransaction>,
  senderTxId: number,
  receiverTxIds: number[],
  assetId: string,
  dedupedFeeAmount: Decimal
): Result<ScopedFeeMovement | undefined, Error> {
  const senderScoped = scopedByTxId.get(senderTxId);
  if (!senderScoped) {
    return err(new Error(`Sender scoped transaction ${senderTxId} not found`));
  }

  const relatedTransactions = [senderScoped];
  for (const receiverTxId of receiverTxIds) {
    const receiverScoped = scopedByTxId.get(receiverTxId);
    if (receiverScoped) {
      relatedTransactions.push(receiverScoped);
    }
  }

  let feeTemplate: ScopedFeeMovement | undefined;
  for (const scoped of relatedTransactions) {
    const matchingFee = scoped.fees.find((fee) => isSameAssetOnChainFee(fee, assetId));
    if (matchingFee) {
      feeTemplate = matchingFee;
      break;
    }
  }

  removeSameAssetOnChainFees(senderScoped, assetId);
  for (const receiverTxId of receiverTxIds) {
    const receiverScoped = scopedByTxId.get(receiverTxId);
    if (receiverScoped) {
      removeSameAssetOnChainFees(receiverScoped, assetId);
    }
  }

  if (dedupedFeeAmount.isZero()) {
    return ok(undefined);
  }

  if (!feeTemplate) {
    return err(
      new Error(
        `Expected at least one same-asset on-chain fee for asset ${assetId} when deduped fee amount is ${dedupedFeeAmount.toFixed()}`
      )
    );
  }

  const normalizedFee: ScopedFeeMovement = {
    ...feeTemplate,
    amount: new Decimal(dedupedFeeAmount.toString()),
  };
  senderScoped.fees.push(normalizedFee);

  return ok(normalizedFee);
}

function removeSameAssetOnChainFees(scoped: AccountingScopedTransaction, assetId: string): void {
  scoped.fees = scoped.fees.filter((fee) => !isSameAssetOnChainFee(fee, assetId));
}

function isSameAssetOnChainFee(fee: ScopedFeeMovement, assetId: string): boolean {
  return fee.assetId === assetId && fee.settlement === 'on-chain';
}
