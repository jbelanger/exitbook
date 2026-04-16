import { err, ok, type Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import {
  allocateSameHashUtxoAmountInTxOrder,
  planSameHashUtxoSourceCapacities,
} from '../../linking/same-hash-utxo-allocation.js';

import type {
  MultiSourceInternalFeeOnly,
  MultiSourceSameHashFeeAccounting,
  SameHashPreparedAssetGroup,
  SameHashPreparedDecision,
  SameHashPreparedParticipant,
  SameHashSourceAllocation,
} from './same-hash-preparation-types.js';

export function reduceSameHashGroupForPreparation(
  group: SameHashPreparedAssetGroup,
  logger: Logger
): Result<SameHashPreparedDecision | undefined, Error> {
  const pureOutflows: SameHashPreparedParticipant[] = [];
  const pureInflows: SameHashPreparedParticipant[] = [];
  const mixed: SameHashPreparedParticipant[] = [];

  for (const participant of group.participants) {
    const hasInflow = participant.inflowGrossAmount.gt(0);
    const hasOutflow = participant.outflowGrossAmount.gt(0);

    if (hasInflow && hasOutflow) {
      mixed.push(participant);
    } else if (hasOutflow) {
      pureOutflows.push(participant);
    } else if (hasInflow) {
      pureInflows.push(participant);
    }
  }

  if (mixed.length > 0) {
    logger.warn(
      {
        hash: group.normalizedHash,
        blockchain: group.blockchain,
        assetId: group.assetId,
        asset: group.assetSymbol,
        mixedTxIds: mixed.map((participant) => participant.txId),
      },
      'Ambiguous same-hash group: participant has both inflows and outflows for same asset; skipping accounting preparation'
    );
    return ok(undefined);
  }

  if (pureOutflows.length === 0) {
    return ok(undefined);
  }

  for (const sender of pureOutflows) {
    if (sender.outflowMovementCount !== 1) {
      logger.warn(
        {
          hash: group.normalizedHash,
          blockchain: group.blockchain,
          assetId: group.assetId,
          asset: group.assetSymbol,
          senderTxId: sender.txId,
          senderOutflowMovementCount: sender.outflowMovementCount,
        },
        'Ambiguous same-hash group: sender has multiple outflow movements for same asset; skipping accounting preparation'
      );
      return ok(undefined);
    }
  }

  const planResult = planSameHashSourceAllocations(group, pureOutflows, pureInflows);
  if (planResult.isErr()) {
    return err(planResult.error);
  }

  const { feeAccounting, externalAmount, sourceAllocations, totalInflows } = planResult.value;

  if (pureInflows.length === 0) {
    return ok({
      type: 'multi_source_prepared_external_amount',
      assetId: group.assetId,
      feeAccounting,
      internalReceiverTxIds: [],
      sourceAllocations,
    });
  }

  for (const receiver of pureInflows) {
    if (receiver.inflowMovementCount !== 1) {
      logger.warn(
        {
          hash: group.normalizedHash,
          blockchain: group.blockchain,
          assetId: group.assetId,
          asset: group.assetSymbol,
          receiverTxId: receiver.txId,
          receiverInflowMovementCount: receiver.inflowMovementCount,
        },
        'Ambiguous same-hash group: receiver has multiple inflow movements for same asset; skipping accounting preparation'
      );
      return ok(undefined);
    }
  }

  if (pureOutflows.length === 1) {
    const sender = pureOutflows[0]!;
    const dedupedFee = group.participants.reduce(
      (currentMax, participant) =>
        participant.onChainFeeAmount.gt(currentMax) ? participant.onChainFeeAmount : currentMax,
      new Decimal(0)
    );

    if (externalAmount.gt(0)) {
      return ok({
        type: 'internal_with_external',
        senderTxId: sender.txId,
        assetId: group.assetId,
        internalInflowTotal: totalInflows,
        dedupedFee,
        internalReceiverTxIds: pureInflows.map((receiver) => receiver.txId),
      });
    }

    return ok({
      type: 'internal_fee_only',
      senderTxId: sender.txId,
      senderMovementFingerprint: sender.outflowMovementFingerprint!,
      assetId: group.assetId,
      assetSymbol: group.assetSymbol,
      dedupedFee,
      receivers: pureInflows.map((receiver) => ({
        txId: receiver.txId,
        movementFingerprint: receiver.inflowMovementFingerprint!,
        quantity: receiver.inflowGrossAmount,
      })),
    });
  }

  if (externalAmount.gt(0)) {
    return ok({
      type: 'multi_source_prepared_external_amount',
      assetId: group.assetId,
      feeAccounting,
      internalReceiverTxIds: pureInflows.map((receiver) => receiver.txId),
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
    feeAccounting,
    sourceCarryovers: carryoverAllocationsResult.value,
  });
}

function planSameHashSourceAllocations(
  group: SameHashPreparedAssetGroup,
  pureOutflows: SameHashPreparedParticipant[],
  pureInflows: SameHashPreparedParticipant[]
): Result<
  {
    externalAmount: Decimal;
    feeAccounting: MultiSourceSameHashFeeAccounting;
    sourceAllocations: SameHashSourceAllocation[];
    totalInflows: Decimal;
  },
  Error
> {
  const capacityPlanResult = resolveMultiSourceCapacityPlan(group, pureOutflows);
  if (capacityPlanResult.isErr()) {
    return err(capacityPlanResult.error);
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
          `totalFee=${capacityPlan.feeAccounting.totalFee.toFixed()}, externalAmount=${externalAmount.toFixed()}`
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
    externalAmount,
    feeAccounting: capacityPlan.feeAccounting,
    sourceAllocations: mappedSourceAllocations,
    totalInflows,
  });
}

function resolveMultiSourceCapacityPlan(
  group: SameHashPreparedAssetGroup,
  pureOutflows: SameHashPreparedParticipant[]
): Result<
  {
    capacities: {
      capacityAmount: Decimal;
      feeDeducted: Decimal;
      grossAmount: Decimal;
      txId: number;
    }[];
    feeAccounting: MultiSourceSameHashFeeAccounting;
    totalCapacity: Decimal;
  },
  Error
> {
  const positiveFees = group.participants
    .filter((participant) => participant.onChainFeeAmount.gt(0))
    .map((participant) => participant.onChainFeeAmount);
  const usesDuplicatedSharedFee =
    positiveFees.length > 0 && positiveFees.every((feeAmount) => feeAmount.eq(positiveFees[0]!));

  if (usesDuplicatedSharedFee) {
    const dedupedFee = positiveFees[0]!;
    const dedupedPlanResult = planSameHashUtxoSourceCapacities(
      pureOutflows.map((source) => ({
        txId: source.txId,
        grossAmount: source.outflowGrossAmount,
        feeAmount: source.onChainFeeAmount,
      })),
      { dedupedFeeAmount: dedupedFee }
    );
    if (dedupedPlanResult.isErr()) {
      return err(
        new Error(
          `Same-hash source allocation failed for ${group.assetSymbol} in hash ${group.normalizedHash} ` +
            `(${group.blockchain}): ${dedupedPlanResult.error.message}`
        )
      );
    }

    return ok({
      capacities: dedupedPlanResult.value.capacities,
      feeAccounting: {
        kind: 'deduped_shared_fee',
        totalFee: dedupedPlanResult.value.dedupedFee,
        feeOwnerTxId: dedupedPlanResult.value.feeOwnerTxId,
        otherParticipantTxIds: group.participants
          .map((participant) => participant.txId)
          .filter((txId) => txId !== dedupedPlanResult.value.feeOwnerTxId),
      },
      totalCapacity: dedupedPlanResult.value.totalCapacity,
    });
  }

  const capacities = pureOutflows
    .slice()
    .sort((left, right) => left.txId - right.txId)
    .map((source) => {
      const capacityAmount = source.outflowGrossAmount.minus(source.onChainFeeAmount);
      if (capacityAmount.lt(0)) {
        return err(
          new Error(
            `Same-hash source allocation produced negative source capacity for tx ${source.txId}: ` +
              `gross=${source.outflowGrossAmount.toFixed()}, fee=${source.onChainFeeAmount.toFixed()}`
          )
        );
      }

      return ok({
        txId: source.txId,
        grossAmount: source.outflowGrossAmount,
        feeDeducted: source.onChainFeeAmount,
        capacityAmount,
      });
    });

  const materializedCapacities: {
    capacityAmount: Decimal;
    feeDeducted: Decimal;
    grossAmount: Decimal;
    txId: number;
  }[] = [];
  for (const capacityResult of capacities) {
    if (capacityResult.isErr()) {
      return err(
        new Error(
          `Same-hash source allocation failed for ${group.assetSymbol} in hash ${group.normalizedHash} ` +
            `(${group.blockchain}): ${capacityResult.error.message}`
        )
      );
    }

    materializedCapacities.push(capacityResult.value);
  }

  const totalCapacity = materializedCapacities.reduce(
    (sum, capacity) => sum.plus(capacity.capacityAmount),
    new Decimal(0)
  );
  const totalFee = materializedCapacities.reduce((sum, capacity) => sum.plus(capacity.feeDeducted), new Decimal(0));

  return ok({
    capacities: materializedCapacities,
    feeAccounting: {
      kind: 'per_source_allocated_fee',
      totalFee,
    },
    totalCapacity,
  });
}

function allocateSameHashReceiversAcrossSources(
  sourceAllocations: SameHashSourceAllocation[],
  pureInflows: SameHashPreparedParticipant[]
): Result<MultiSourceInternalFeeOnly['sourceCarryovers'], Error> {
  const orderedSources = sourceAllocations
    .filter((allocation) => allocation.internalAmount.gt(0))
    .sort((left, right) => left.txId - right.txId)
    .map((allocation) => ({
      ...allocation,
      remainingQuantity: allocation.internalAmount,
      targets: [] as MultiSourceInternalFeeOnly['sourceCarryovers'][number]['targets'],
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
