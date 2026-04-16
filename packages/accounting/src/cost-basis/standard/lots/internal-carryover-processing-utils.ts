import { err, ok, parseDecimal, randomUUID, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type {
  ResolvedInternalTransferCarryover,
  ResolvedInternalTransferCarryoverTarget,
} from '../../../accounting-model/accounting-model-resolution.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../../model/schemas.js';
import type { ICostBasisStrategy } from '../strategies/base-strategy.js';

import { collectFiatFees } from './lot-fee-utils.js';
import { type CostBasisTransactionLike } from './lot-transaction-shapes.js';
import {
  buildTransferMetadata,
  calculateInheritedCostBasis,
  calculateSameAssetFeeUsdShare,
  calculateTargetCostBasis,
  validateTransferVariance,
} from './lot-transfer-utils.js';
import { applyLotQuantityUpdates, buildLotQuantityUpdateMap } from './lot-update-utils.js';
import { createAcquisitionLot } from './lot.js';

export interface InternalTransferCarryoverTargetBinding {
  bindingKey: string;
  target: ResolvedInternalTransferCarryoverTarget;
}

interface CarryoverWarningData {
  date?: string;
  feeAmount?: Decimal;
  feeAssetSymbol?: string;
  received?: Decimal;
  sourceTxId?: number;
  targetMovementFingerprint?: string;
  targetTxId?: number;
  transferred?: Decimal;
  txId?: number;
  variancePct?: Decimal;
}

interface CarryoverSourceWarning {
  data: CarryoverWarningData;
  type: 'missing-price';
}

interface CarryoverTargetWarning {
  data: CarryoverWarningData;
  type: 'missing-price' | 'no-transfers' | 'variance';
}

export function processInternalTransferCarryoverSource(
  resolvedCarryover: ResolvedInternalTransferCarryover,
  targetBindings: InternalTransferCarryoverTargetBinding[],
  lots: AcquisitionLot[],
  strategy: ICostBasisStrategy,
  calculationId: string,
  jurisdiction: { sameAssetTransferFeePolicy: 'disposal' | 'add-to-basis' }
): Result<
  {
    disposals: LotDisposal[];
    transfers: LotTransfer[];
    updatedLots: AcquisitionLot[];
    warnings: CarryoverSourceWarning[];
  },
  Error
> {
  if (targetBindings.length === 0) {
    return err(
      new Error(
        `Internal transfer carryover for tx ${resolvedCarryover.source.processedTransaction.id} has no resolved target bindings`
      )
    );
  }

  const warnings: CarryoverSourceWarning[] = [];
  const feePolicy = jurisdiction.sameAssetTransferFeePolicy;
  const sourceEntry = resolvedCarryover.source.entry;
  const sourceTransaction = resolvedCarryover.source.processedTransaction;
  const sourceMovement = resolvedCarryover.source.movement;
  const retainedQuantity = sourceEntry.quantity;
  const carryoverFeeAmount = resolvedCarryover.fee?.entry.quantity ?? parseDecimal('0');
  const carryoverFeePrice = resolvedCarryover.fee?.fee.priceAtTxTime;
  const transferDisposalQuantity =
    feePolicy === 'add-to-basis' ? retainedQuantity.plus(carryoverFeeAmount) : retainedQuantity;

  const openLots = lots.filter((lot) => lot.assetId === sourceEntry.assetId && lot.remainingQuantity.gt(0));
  const disposal = {
    transactionId: sourceTransaction.id,
    assetSymbol: sourceEntry.assetSymbol,
    quantity: transferDisposalQuantity,
    date: new Date(sourceTransaction.datetime),
    proceedsPerUnit: parseDecimal('0'),
  };

  const lotDisposalsResult = strategy.matchDisposal(disposal, openLots);
  if (lotDisposalsResult.isErr()) {
    return err(lotDisposalsResult.error);
  }

  let sameAssetFeeUsdValue: Decimal | undefined;
  if (carryoverFeeAmount.gt(0) && feePolicy === 'add-to-basis') {
    if (!carryoverFeePrice) {
      warnings.push({
        type: 'missing-price',
        data: {
          feeAmount: carryoverFeeAmount,
        },
      });
    } else {
      sameAssetFeeUsdValue = carryoverFeeAmount.times(carryoverFeePrice.price.amount);
    }
  }

  const transfers: LotTransfer[] = [];
  const quantityToSubtractByLotId = new Map<string, Decimal>();
  const totalFeeAllocations = sameAssetFeeUsdValue ? lotDisposalsResult.value.length * targetBindings.length : 0;
  let feeAllocationsCreated = 0;
  let allocatedFeeUsdSoFar = parseDecimal('0');

  for (const lotDisposal of lotDisposalsResult.value) {
    buildLotQuantityUpdateMap(lotDisposal.lotId, lotDisposal.quantityDisposed, quantityToSubtractByLotId);

    for (const binding of targetBindings) {
      const linkTransferFraction = binding.target.binding.quantity.dividedBy(retainedQuantity);
      const allocatedDisposalQuantity = lotDisposal.quantityDisposed.times(linkTransferFraction);
      const quantityTransferred =
        feePolicy === 'disposal'
          ? allocatedDisposalQuantity
          : lotDisposal.quantityDisposed.times(binding.target.binding.quantity).dividedBy(transferDisposalQuantity);

      let metadata: LotTransfer['metadata'] | undefined;
      if (sameAssetFeeUsdValue) {
        feeAllocationsCreated += 1;
        const feeShareResult = calculateSameAssetFeeUsdShare(
          sameAssetFeeUsdValue,
          allocatedDisposalQuantity,
          transferDisposalQuantity,
          allocatedFeeUsdSoFar,
          feeAllocationsCreated === totalFeeAllocations
        );
        if (feeShareResult.isErr()) {
          return err(feeShareResult.error);
        }

        allocatedFeeUsdSoFar = allocatedFeeUsdSoFar.plus(feeShareResult.value);
        metadata = buildTransferMetadata(feeShareResult.value);
      }

      transfers.push({
        id: randomUUID(),
        calculationId,
        sourceLotId: lotDisposal.lotId,
        provenance: {
          kind: 'internal-transfer-carryover',
          sourceMovementFingerprint: sourceMovement.movementFingerprint,
          targetMovementFingerprint: binding.target.target.movement.movementFingerprint,
        },
        quantityTransferred,
        costBasisPerUnit: lotDisposal.costBasisPerUnit,
        sourceTransactionId: sourceTransaction.id,
        targetTransactionId: binding.target.target.processedTransaction.id,
        transferDate: new Date(sourceTransaction.datetime),
        metadata,
        createdAt: new Date(),
      });
    }
  }

  const disposals: LotDisposal[] = [];
  if (carryoverFeeAmount.gt(0) && feePolicy === 'disposal') {
    const lotsAfterTransferResult = applyLotQuantityUpdates(lots, quantityToSubtractByLotId);
    if (lotsAfterTransferResult.isErr()) {
      return err(lotsAfterTransferResult.error);
    }

    const remainingLotsAfterTransfer = lotsAfterTransferResult.value.filter(
      (lot) => lot.assetId === sourceEntry.assetId && lot.remainingQuantity.gt(0)
    );
    const feeDisposal = {
      transactionId: sourceTransaction.id,
      assetSymbol: sourceEntry.assetSymbol,
      quantity: carryoverFeeAmount,
      date: new Date(sourceTransaction.datetime),
      proceedsPerUnit: carryoverFeePrice?.price.amount ?? parseDecimal('0'),
    };

    const feeDisposalsResult = strategy.matchDisposal(feeDisposal, remainingLotsAfterTransfer);
    if (feeDisposalsResult.isErr()) {
      return err(feeDisposalsResult.error);
    }

    for (const lotDisposal of feeDisposalsResult.value) {
      buildLotQuantityUpdateMap(lotDisposal.lotId, lotDisposal.quantityDisposed, quantityToSubtractByLotId);
      disposals.push(lotDisposal);
    }
  }

  const updatedLotsResult = applyLotQuantityUpdates(lots, quantityToSubtractByLotId);
  if (updatedLotsResult.isErr()) {
    return err(updatedLotsResult.error);
  }

  return ok({
    disposals,
    transfers,
    updatedLots: updatedLotsResult.value,
    warnings,
  });
}

export function processInternalTransferCarryoverTarget(
  resolvedCarryover: ResolvedInternalTransferCarryover,
  targetBinding: InternalTransferCarryoverTargetBinding,
  transfersForTarget: LotTransfer[],
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id'
): Result<
  {
    lot: AcquisitionLot;
    warnings: CarryoverTargetWarning[];
  },
  Error
> {
  const warnings: CarryoverTargetWarning[] = [];
  const sourceTransaction = resolvedCarryover.source.processedTransaction;
  const targetResolution = targetBinding.target.target;
  const targetTransaction = targetResolution.processedTransaction;
  const targetMovement = targetResolution.movement;

  if (transfersForTarget.length === 0) {
    warnings.push({
      type: 'no-transfers',
      data: {
        targetTxId: targetTransaction.id,
        targetMovementFingerprint: targetMovement.movementFingerprint,
        sourceTxId: sourceTransaction.id,
      },
    });
    return err(
      new Error(
        `No carryover lot transfers found for tx ${sourceTransaction.id} -> ${targetTransaction.id} ` +
          `(binding ${targetBinding.bindingKey})`
      )
    );
  }

  const { totalCostBasis: inheritedCostBasis, transferredQuantity } = calculateInheritedCostBasis(transfersForTarget);
  const receivedQuantity = targetBinding.target.binding.quantity;

  const varianceResult = validateTransferVariance(
    transferredQuantity,
    receivedQuantity,
    targetTransaction.platformKey,
    targetTransaction.id,
    targetMovement.assetSymbol
  );
  if (varianceResult.isErr()) {
    return err(varianceResult.error);
  }

  const { tolerance, variancePct } = varianceResult.value;
  if (variancePct.gt(tolerance.warn)) {
    warnings.push({
      type: 'variance',
      data: {
        targetTxId: targetTransaction.id,
        targetMovementFingerprint: targetMovement.movementFingerprint,
        variancePct,
        transferred: transferredQuantity,
        received: receivedQuantity,
      },
    });
  }

  const sourceFraction = receivedQuantity.dividedBy(resolvedCarryover.source.entry.quantity);
  const targetFraction = receivedQuantity.dividedBy(targetMovement.grossQuantity);
  const sourceTransactionLike = getTransactionLike(resolvedCarryover.source.transactionView, sourceTransaction);
  const targetTransactionLike = getTransactionLike(targetResolution.transactionView, targetTransaction);
  const fiatFeesResult = collectFiatFees(sourceTransactionLike, targetTransactionLike, {
    sourceFraction,
    targetFraction,
  });
  if (fiatFeesResult.isErr()) {
    return err(fiatFeesResult.error);
  }

  for (const fee of fiatFeesResult.value) {
    if (fee.priceAtTxTime) continue;
    warnings.push({
      type: 'missing-price',
      data: {
        txId: fee.txId,
        feeAssetSymbol: fee.assetSymbol,
        feeAmount: fee.amount,
        date: fee.date,
      },
    });
  }

  const costBasisPerUnit = calculateTargetCostBasis(inheritedCostBasis, fiatFeesResult.value, receivedQuantity);
  const lot = createAcquisitionLot({
    id: randomUUID(),
    calculationId,
    acquisitionTransactionId: targetTransaction.id,
    assetId: targetResolution.entry.assetId,
    assetSymbol: targetMovement.assetSymbol,
    quantity: receivedQuantity,
    costBasisPerUnit,
    method: strategyName,
    transactionDate: new Date(targetTransaction.datetime),
  });

  return ok({ lot, warnings });
}

function getTransactionLike(
  transactionView: CostBasisTransactionLike | undefined,
  processedTransaction: CostBasisTransactionLike
): CostBasisTransactionLike {
  return transactionView ?? processedTransaction;
}
