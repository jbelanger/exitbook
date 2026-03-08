import type { AssetMovement, Currency, FeeMovement, UniversalTransactionData } from '@exitbook/core';
import { computeMovementFingerprint, computeTxFingerprint, err, ok, type Result } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import { normalizeTransactionHash } from '../../linking/strategies/exact-hash-utils.js';

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

type SameHashDecision = InternalWithExternalAmount | InternalFeeOnly;

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
    if (decision === undefined) continue; // Rule 1 or 4: no action

    const applyResult = applyDecisionToScopedTransactions(scopedByTxId, feeOnlyInternalCarryovers, decision, logger);
    if (applyResult.isErr()) return err(applyResult.error);
  }

  return ok({
    transactions: [...scopedByTxId.values()],
    feeOnlyInternalCarryovers,
  });
}

// ---------------------------------------------------------------------------
// Clone a raw transaction into scoped form
// ---------------------------------------------------------------------------

function cloneScopedTransaction(tx: UniversalTransactionData): Result<AccountingScopedTransaction, Error> {
  const txFpResult = computeTxFingerprint({ source: tx.source, externalId: tx.externalId });
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

  return ok({ tx, movements: { inflows, outflows }, fees });
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

  // Rule 1: Only outflows → external send, no action
  if (pureInflows.length === 0 && mixed.length === 0) {
    return ok(undefined);
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

  // Rule 3 (ambiguous): multiple pure outflow participants with inflows present
  if (pureOutflows.length > 1) {
    return err(
      new Error(
        `Ambiguous same-hash group: multiple outflow participants for ${group.assetSymbol} ` +
          `in hash ${group.normalizedHash} (${group.blockchain}), ` +
          `outflow txIds: [${pureOutflows.map((p) => p.txId).join(', ')}], ` +
          `inflow txIds: [${pureInflows.map((p) => p.txId).join(', ')}]`
      )
    );
  }

  // Rule 2: exactly one pure outflow + pure inflows → clearly internal
  const sender = pureOutflows[0];
  if (!sender || pureInflows.length === 0) {
    return ok(undefined);
  }

  // Ambiguity: multi-movement participants
  if (sender.outflowMovementCount !== 1) {
    return err(
      new Error(
        `Ambiguous same-hash group: sender has ${sender.outflowMovementCount} outflow movements for ${group.assetSymbol} ` +
          `in hash ${group.normalizedHash} (${group.blockchain}), sender txId: ${sender.txId}`
      )
    );
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

  // Compute deduped fee (max across all participants)
  let dedupedFee = new Decimal(0);
  for (const p of group.participants) {
    if (p.onChainFeeAmount.gt(dedupedFee)) {
      dedupedFee = p.onChainFeeAmount;
    }
  }

  // Compute total internal inflows
  let totalInflows = new Decimal(0);
  for (const receiver of pureInflows) {
    totalInflows = totalInflows.plus(receiver.inflowGrossAmount);
  }

  // Determine if any external transfer quantity remains
  const externalAmount = sender.outflowGrossAmount.minus(totalInflows).minus(dedupedFee);

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

  if (externalAmount.lt(0)) {
    return err(
      new Error(
        `Invalid same-hash group: internal inflows plus deduped fee exceed sender outflow for ${group.assetSymbol} ` +
          `in hash ${group.normalizedHash} (${group.blockchain}), sender txId: ${sender.txId}, ` +
          `senderOutflow=${sender.outflowGrossAmount.toFixed()}, internalInflows=${totalInflows.toFixed()}, ` +
          `dedupedFee=${dedupedFee.toFixed()}, externalAmount=${externalAmount.toFixed()}`
      )
    );
  }

  // Fee-only internal transfer (exactly zero external amount)
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

// ---------------------------------------------------------------------------
// Apply a scoping decision to scoped transactions
// ---------------------------------------------------------------------------

function applyDecisionToScopedTransactions(
  scopedByTxId: Map<number, AccountingScopedTransaction>,
  feeOnlyInternalCarryovers: FeeOnlyInternalCarryover[],
  decision: SameHashDecision,
  logger: Logger
): Result<void, Error> {
  if (decision.type === 'internal_with_external') {
    return applyInternalWithExternalAmount(scopedByTxId, decision, logger);
  }

  return applyInternalFeeOnly(scopedByTxId, feeOnlyInternalCarryovers, decision, logger);
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
