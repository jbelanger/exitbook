import { err, ok, type Result } from '@exitbook/core';
import { Decimal } from 'decimal.js';

export interface SameHashUtxoSourceInput {
  feeAmount: Decimal;
  grossAmount: Decimal;
  txId: number;
}

export interface SameHashUtxoSourceCapacity {
  capacityAmount: Decimal;
  feeDeducted: Decimal;
  grossAmount: Decimal;
  txId: number;
}

export interface SameHashUtxoSourceAllocation extends SameHashUtxoSourceCapacity {
  allocatedAmount: Decimal;
  unallocatedAmount: Decimal;
}

export interface SameHashUtxoCapacityPlan {
  capacities: SameHashUtxoSourceCapacity[];
  dedupedFee: Decimal;
  feeOwnerTxId: number;
  totalCapacity: Decimal;
}

export function planSameHashUtxoSourceCapacities(
  sources: SameHashUtxoSourceInput[],
  options?: { dedupedFeeAmount?: Decimal | undefined }
): Result<SameHashUtxoCapacityPlan, Error> {
  if (sources.length === 0) {
    return err(new Error('Same-hash UTXO allocation requires at least one source'));
  }

  let dedupedFee = options?.dedupedFeeAmount ?? new Decimal(0);
  if (!options?.dedupedFeeAmount) {
    for (const source of sources) {
      if (source.feeAmount.gt(dedupedFee)) {
        dedupedFee = source.feeAmount;
      }
    }
  }

  const feeOwner = [...sources].sort(compareFeeOwnerPriority)[0];
  if (!feeOwner) {
    return err(new Error('Same-hash UTXO allocation could not determine a fee owner'));
  }

  const capacities: SameHashUtxoSourceCapacity[] = [];
  let totalCapacity = new Decimal(0);

  for (const source of [...sources].sort(compareByTxId)) {
    const feeDeducted = source.txId === feeOwner.txId ? dedupedFee : new Decimal(0);
    const capacityAmount = source.grossAmount.minus(feeDeducted);
    if (capacityAmount.lt(0)) {
      return err(
        new Error(
          `Same-hash UTXO allocation produced negative source capacity for tx ${source.txId}: ` +
            `gross=${source.grossAmount.toFixed()}, fee=${feeDeducted.toFixed()}`
        )
      );
    }

    capacities.push({
      txId: source.txId,
      grossAmount: source.grossAmount,
      feeDeducted,
      capacityAmount,
    });
    totalCapacity = totalCapacity.plus(capacityAmount);
  }

  return ok({
    dedupedFee,
    feeOwnerTxId: feeOwner.txId,
    capacities,
    totalCapacity,
  });
}

export function allocateSameHashUtxoAmountInTxOrder(
  capacities: SameHashUtxoSourceCapacity[],
  targetAmount: Decimal
): SameHashUtxoSourceAllocation[] | undefined {
  if (targetAmount.lt(0)) {
    return undefined;
  }

  let remainingTargetAmount = targetAmount;
  const allocations: SameHashUtxoSourceAllocation[] = [];

  for (const capacity of [...capacities].sort(compareByTxId)) {
    const allocatedAmount = remainingTargetAmount.lte(0)
      ? new Decimal(0)
      : Decimal.min(capacity.capacityAmount, remainingTargetAmount);

    allocations.push({
      ...capacity,
      allocatedAmount,
      unallocatedAmount: capacity.capacityAmount.minus(allocatedAmount),
    });
    remainingTargetAmount = remainingTargetAmount.minus(allocatedAmount);
  }

  return remainingTargetAmount.eq(0) ? allocations : undefined;
}

function compareFeeOwnerPriority(left: SameHashUtxoSourceInput, right: SameHashUtxoSourceInput): number {
  const feeComparison = right.feeAmount.comparedTo(left.feeAmount);
  if (feeComparison !== 0) return feeComparison;

  const grossComparison = right.grossAmount.comparedTo(left.grossAmount);
  if (grossComparison !== 0) return grossComparison;

  return compareByTxId(left, right);
}

function compareByTxId(left: { txId: number }, right: { txId: number }): number {
  return left.txId - right.txId;
}
