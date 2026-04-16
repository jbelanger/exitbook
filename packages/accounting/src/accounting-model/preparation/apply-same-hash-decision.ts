import type { AssetMovement } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import type {
  InternalTransferCarryoverDraft,
  PreparedAccountingTransaction,
  PreparedFeeMovement,
} from '../prepared-accounting-types.js';

import type {
  InternalFeeOnly,
  InternalWithExternalAmount,
  MultiSourceInternalFeeOnly,
  MultiSourcePreparedExternalAmount,
  MultiSourceSameHashFeeAccounting,
  SameHashPreparedDecision,
} from './same-hash-preparation-types.js';

export function applySameHashDecisionToPreparedTransactions(
  preparedByTxId: Map<number, PreparedAccountingTransaction>,
  internalTransferCarryoverDrafts: InternalTransferCarryoverDraft[],
  decision: SameHashPreparedDecision,
  logger: Logger
): Result<void, Error> {
  if (decision.type === 'internal_with_external') {
    return applyInternalWithExternalAmount(preparedByTxId, decision, logger);
  }

  if (decision.type === 'internal_fee_only') {
    return applyInternalFeeOnly(preparedByTxId, internalTransferCarryoverDrafts, decision, logger);
  }

  if (decision.type === 'multi_source_prepared_external_amount') {
    return applyMultiSourcePreparedExternalAmount(preparedByTxId, decision, logger);
  }

  return applyMultiSourceInternalFeeOnly(preparedByTxId, internalTransferCarryoverDrafts, decision, logger);
}

function addPreparedRebuildDependencies(
  preparedTransaction: PreparedAccountingTransaction,
  dependencyTransactionIds: number[]
): void {
  const existing = new Set(preparedTransaction.rebuildDependencyTransactionIds);
  for (const dependencyTransactionId of dependencyTransactionIds) {
    if (dependencyTransactionId === preparedTransaction.tx.id) continue;
    if (existing.has(dependencyTransactionId)) continue;

    existing.add(dependencyTransactionId);
    preparedTransaction.rebuildDependencyTransactionIds.push(dependencyTransactionId);
  }
}

function applyMultiSourcePreparedExternalAmount(
  preparedByTxId: Map<number, PreparedAccountingTransaction>,
  decision: MultiSourcePreparedExternalAmount,
  logger: Logger
): Result<void, Error> {
  for (const sourceAllocation of decision.sourceAllocations) {
    const sourcePreparedTransaction = preparedByTxId.get(sourceAllocation.txId);
    if (!sourcePreparedTransaction) {
      return err(new Error(`Sender prepared transaction ${sourceAllocation.txId} not found`));
    }

    addPreparedRebuildDependencies(sourcePreparedTransaction, decision.internalReceiverTxIds);

    if (sourceAllocation.externalAmount.eq(0)) {
      sourcePreparedTransaction.movements.outflows = sourcePreparedTransaction.movements.outflows.filter(
        (movement) => movement.assetId !== decision.assetId
      );
      continue;
    }

    const sourceOutflowResult = getSinglePreparedOutflow(
      sourcePreparedTransaction,
      decision.assetId,
      sourceAllocation.txId
    );
    if (sourceOutflowResult.isErr()) return err(sourceOutflowResult.error);

    const sourceOutflow = sourceOutflowResult.value;
    sourceOutflow.grossAmount = sourceAllocation.externalAmount.plus(sourceAllocation.feeDeducted);
    sourceOutflow.netAmount = sourceAllocation.externalAmount;
  }

  if (decision.feeAccounting.kind === 'deduped_shared_fee') {
    const feeNormalizationResult = normalizeSameAssetOnChainFeeOwnership(
      preparedByTxId,
      decision.feeAccounting.feeOwnerTxId,
      decision.feeAccounting.otherParticipantTxIds,
      decision.assetId,
      decision.feeAccounting.totalFee
    );
    if (feeNormalizationResult.isErr()) return err(feeNormalizationResult.error);
  }

  for (const receiverTxId of decision.internalReceiverTxIds) {
    const receiverPreparedTransaction = preparedByTxId.get(receiverTxId);
    if (!receiverPreparedTransaction) continue;

    receiverPreparedTransaction.movements.inflows = receiverPreparedTransaction.movements.inflows.filter(
      (movement) => movement.assetId !== decision.assetId
    );
  }

  logger.debug(
    {
      assetId: decision.assetId,
      feeAccounting: summarizeMultiSourceFeeAccounting(decision.feeAccounting),
      internalReceiverCount: decision.internalReceiverTxIds.length,
      sourceAllocations: decision.sourceAllocations.map((allocation) => ({
        txId: allocation.txId,
        externalAmount: allocation.externalAmount.toFixed(),
        internalAmount: allocation.internalAmount.toFixed(),
        feeDeducted: allocation.feeDeducted.toFixed(),
      })),
    },
    'Applied same-hash prepared external amount (multi-source)'
  );

  return ok(undefined);
}

function applyMultiSourceInternalFeeOnly(
  preparedByTxId: Map<number, PreparedAccountingTransaction>,
  internalTransferCarryoverDrafts: InternalTransferCarryoverDraft[],
  decision: MultiSourceInternalFeeOnly,
  logger: Logger
): Result<void, Error> {
  for (const sourceCarryover of decision.sourceCarryovers) {
    const sourcePreparedTransaction = preparedByTxId.get(sourceCarryover.sourceTxId);
    if (!sourcePreparedTransaction) {
      return err(new Error(`Sender prepared transaction ${sourceCarryover.sourceTxId} not found`));
    }

    addPreparedRebuildDependencies(
      sourcePreparedTransaction,
      sourceCarryover.targets.map((target) => target.txId)
    );

    sourcePreparedTransaction.movements.outflows = sourcePreparedTransaction.movements.outflows.filter(
      (movement) => movement.assetId !== decision.assetId
    );
  }

  if (decision.feeAccounting.kind === 'deduped_shared_fee') {
    const feeNormalizationResult = normalizeSameAssetOnChainFeeOwnership(
      preparedByTxId,
      decision.feeAccounting.feeOwnerTxId,
      decision.feeAccounting.otherParticipantTxIds,
      decision.assetId,
      decision.feeAccounting.totalFee
    );
    if (feeNormalizationResult.isErr()) return err(feeNormalizationResult.error);

    const feeOwnerPreparedFee = feeNormalizationResult.value;
    if (feeOwnerPreparedFee) {
      for (const sourceCarryover of decision.sourceCarryovers) {
        internalTransferCarryoverDrafts.push({
          assetId: decision.assetId,
          assetSymbol: decision.assetSymbol,
          fee:
            sourceCarryover.sourceTxId === decision.feeAccounting.feeOwnerTxId
              ? feeOwnerPreparedFee
              : {
                  ...feeOwnerPreparedFee,
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
  } else {
    for (const sourceCarryover of decision.sourceCarryovers) {
      const sourcePreparedTransaction = preparedByTxId.get(sourceCarryover.sourceTxId);
      if (!sourcePreparedTransaction) {
        return err(new Error(`Sender prepared transaction ${sourceCarryover.sourceTxId} not found`));
      }

      const sourceFee = detachSameAssetOnChainFee(sourcePreparedTransaction, decision.assetId);
      if (!sourceFee) continue;

      internalTransferCarryoverDrafts.push({
        assetId: decision.assetId,
        assetSymbol: decision.assetSymbol,
        fee: sourceFee,
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
      feeAccounting: summarizeMultiSourceFeeAccounting(decision.feeAccounting),
      sourceCarryoverCount: decision.sourceCarryovers.length,
    },
    'Applied same-hash prepared internal scoping (multi-source fee-only carryover)'
  );

  return ok(undefined);
}

function applyInternalWithExternalAmount(
  preparedByTxId: Map<number, PreparedAccountingTransaction>,
  decision: InternalWithExternalAmount,
  logger: Logger
): Result<void, Error> {
  const senderPreparedTransaction = preparedByTxId.get(decision.senderTxId);
  if (!senderPreparedTransaction) {
    return err(new Error(`Sender prepared transaction ${decision.senderTxId} not found`));
  }

  addPreparedRebuildDependencies(senderPreparedTransaction, decision.internalReceiverTxIds);

  const senderOutflowResult = getSinglePreparedOutflow(
    senderPreparedTransaction,
    decision.assetId,
    decision.senderTxId
  );
  if (senderOutflowResult.isErr()) return err(senderOutflowResult.error);

  const senderOutflow = senderOutflowResult.value;
  const newGrossAmount = senderOutflow.grossAmount.minus(decision.internalInflowTotal);
  senderOutflow.grossAmount = newGrossAmount;
  senderOutflow.netAmount = newGrossAmount.minus(decision.dedupedFee);

  const feeNormalizationResult = normalizeSameAssetOnChainFeeOwnership(
    preparedByTxId,
    decision.senderTxId,
    decision.internalReceiverTxIds,
    decision.assetId,
    decision.dedupedFee
  );
  if (feeNormalizationResult.isErr()) return err(feeNormalizationResult.error);

  for (const receiverTxId of decision.internalReceiverTxIds) {
    const receiverPreparedTransaction = preparedByTxId.get(receiverTxId);
    if (!receiverPreparedTransaction) continue;

    receiverPreparedTransaction.movements.inflows = receiverPreparedTransaction.movements.inflows.filter(
      (movement) => movement.assetId !== decision.assetId
    );
  }

  logger.debug(
    {
      senderTxId: decision.senderTxId,
      assetId: decision.assetId,
      internalInflowTotal: decision.internalInflowTotal.toFixed(),
      dedupedFee: decision.dedupedFee.toFixed(),
    },
    'Applied same-hash prepared internal scoping (with external amount)'
  );

  return ok(undefined);
}

function applyInternalFeeOnly(
  preparedByTxId: Map<number, PreparedAccountingTransaction>,
  internalTransferCarryoverDrafts: InternalTransferCarryoverDraft[],
  decision: InternalFeeOnly,
  logger: Logger
): Result<void, Error> {
  const senderPreparedTransaction = preparedByTxId.get(decision.senderTxId);
  if (!senderPreparedTransaction) {
    return err(new Error(`Sender prepared transaction ${decision.senderTxId} not found`));
  }

  addPreparedRebuildDependencies(
    senderPreparedTransaction,
    decision.receivers.map((receiver) => receiver.txId)
  );

  senderPreparedTransaction.movements.outflows = senderPreparedTransaction.movements.outflows.filter(
    (movement) => movement.assetId !== decision.assetId
  );

  const feeNormalizationResult = normalizeSameAssetOnChainFeeOwnership(
    preparedByTxId,
    decision.senderTxId,
    decision.receivers.map((receiver) => receiver.txId),
    decision.assetId,
    decision.dedupedFee
  );
  if (feeNormalizationResult.isErr()) return err(feeNormalizationResult.error);

  const senderFee = feeNormalizationResult.value;
  if (senderFee) {
    const retainedQuantity = decision.receivers.reduce((sum, receiver) => sum.plus(receiver.quantity), new Decimal(0));

    internalTransferCarryoverDrafts.push({
      assetId: decision.assetId,
      assetSymbol: decision.assetSymbol,
      fee: senderFee,
      retainedQuantity,
      sourceTransactionId: decision.senderTxId,
      sourceMovementFingerprint: decision.senderMovementFingerprint,
      targets: decision.receivers.map((receiver) => ({
        targetTransactionId: receiver.txId,
        targetMovementFingerprint: receiver.movementFingerprint,
        quantity: receiver.quantity,
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
    'Applied same-hash prepared internal scoping (fee-only carryover)'
  );

  return ok(undefined);
}

function getSinglePreparedOutflow(
  preparedTransaction: PreparedAccountingTransaction,
  assetId: string,
  txId: number
): Result<AssetMovement, Error> {
  const matchingOutflows = preparedTransaction.movements.outflows.filter((movement) => movement.assetId === assetId);
  if (matchingOutflows.length !== 1) {
    return err(
      new Error(
        `Expected exactly one prepared outflow for asset ${assetId} in transaction ${txId}, found ${matchingOutflows.length}`
      )
    );
  }

  return ok(matchingOutflows[0]!);
}

function normalizeSameAssetOnChainFeeOwnership(
  preparedByTxId: Map<number, PreparedAccountingTransaction>,
  senderTxId: number,
  receiverTxIds: number[],
  assetId: string,
  dedupedFeeAmount: Decimal
): Result<PreparedFeeMovement | undefined, Error> {
  const senderPreparedTransaction = preparedByTxId.get(senderTxId);
  if (!senderPreparedTransaction) {
    return err(new Error(`Sender prepared transaction ${senderTxId} not found`));
  }

  const relatedTransactions = [senderPreparedTransaction];
  for (const receiverTxId of receiverTxIds) {
    const receiverPreparedTransaction = preparedByTxId.get(receiverTxId);
    if (receiverPreparedTransaction) {
      relatedTransactions.push(receiverPreparedTransaction);
    }
  }

  let feeTemplate: PreparedFeeMovement | undefined;
  for (const preparedTransaction of relatedTransactions) {
    const matchingFee = preparedTransaction.fees.find((fee) => isSameAssetOnChainFee(fee, assetId));
    if (matchingFee) {
      feeTemplate = matchingFee;
      break;
    }
  }

  removeSameAssetOnChainFees(senderPreparedTransaction, assetId);
  for (const receiverTxId of receiverTxIds) {
    const receiverPreparedTransaction = preparedByTxId.get(receiverTxId);
    if (receiverPreparedTransaction) {
      removeSameAssetOnChainFees(receiverPreparedTransaction, assetId);
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

  const normalizedFee: PreparedFeeMovement = {
    ...feeTemplate,
    amount: new Decimal(dedupedFeeAmount.toString()),
  };
  senderPreparedTransaction.fees.push(normalizedFee);

  return ok(normalizedFee);
}

function detachSameAssetOnChainFee(
  preparedTransaction: PreparedAccountingTransaction,
  assetId: string
): PreparedFeeMovement | undefined {
  const matchingFee = preparedTransaction.fees.find((fee) => isSameAssetOnChainFee(fee, assetId));
  if (!matchingFee) {
    return undefined;
  }

  removeSameAssetOnChainFees(preparedTransaction, assetId);
  return matchingFee;
}

function summarizeMultiSourceFeeAccounting(feeAccounting: MultiSourceSameHashFeeAccounting): Record<string, string> {
  if (feeAccounting.kind === 'deduped_shared_fee') {
    return {
      kind: feeAccounting.kind,
      totalFee: feeAccounting.totalFee.toFixed(),
      feeOwnerTxId: String(feeAccounting.feeOwnerTxId),
    };
  }

  return {
    kind: feeAccounting.kind,
    totalFee: feeAccounting.totalFee.toFixed(),
  };
}

function removeSameAssetOnChainFees(preparedTransaction: PreparedAccountingTransaction, assetId: string): void {
  preparedTransaction.fees = preparedTransaction.fees.filter((fee) => !isSameAssetOnChainFee(fee, assetId));
}

function isSameAssetOnChainFee(fee: PreparedFeeMovement, assetId: string): boolean {
  return fee.assetId === assetId && fee.settlement === 'on-chain';
}
