import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type {
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
  FeeOnlyInternalCarryoverTarget,
} from '../matching/build-cost-basis-scoped-transactions.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../shared/schemas.js';
import type { ICostBasisStrategy } from '../strategies/base-strategy.js';

import { collectFiatFees } from './lot-fee-utils.js';
import {
  buildTransferMetadata,
  calculateInheritedCostBasis,
  calculateTargetCostBasis,
  validateTransferVariance,
} from './lot-transfer-utils.js';
import { applyLotQuantityUpdates, buildLotQuantityUpdateMap } from './lot-update-utils.js';
import { createAcquisitionLot } from './lot.js';

export interface CarryoverTargetBinding {
  bindingKey: string;
  target: FeeOnlyInternalCarryoverTarget;
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

export function processFeeOnlyInternalCarryoverSource(
  sourceTransaction: AccountingScopedTransaction,
  carryover: FeeOnlyInternalCarryover,
  targetBindings: CarryoverTargetBinding[],
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
      new Error(`Fee-only internal carryover for tx ${carryover.sourceTransactionId} has no resolved target bindings`)
    );
  }

  const warnings: CarryoverSourceWarning[] = [];
  const feePolicy = jurisdiction.sameAssetTransferFeePolicy;
  const transferDisposalQuantity =
    feePolicy === 'add-to-basis' ? carryover.retainedQuantity.plus(carryover.fee.amount) : carryover.retainedQuantity;

  const openLots = lots.filter((lot) => lot.assetId === carryover.assetId && lot.remainingQuantity.gt(0));
  const disposal = {
    transactionId: sourceTransaction.tx.id,
    assetSymbol: carryover.assetSymbol,
    quantity: transferDisposalQuantity,
    date: new Date(sourceTransaction.tx.datetime),
    proceedsPerUnit: parseDecimal('0'),
  };

  const lotDisposalsResult = strategy.matchDisposal(disposal, openLots);
  if (lotDisposalsResult.isErr()) {
    return err(lotDisposalsResult.error);
  }
  const lotDisposals = lotDisposalsResult.value;

  let sameAssetFeeUsdValue: Decimal | undefined = undefined;
  if (carryover.fee.amount.gt(0) && feePolicy === 'add-to-basis') {
    if (!carryover.fee.priceAtTxTime) {
      warnings.push({
        type: 'missing-price',
        data: {
          feeAmount: carryover.fee.amount,
        },
      });
    } else {
      sameAssetFeeUsdValue = carryover.fee.amount.times(carryover.fee.priceAtTxTime.price.amount);
    }
  }

  const transfers: LotTransfer[] = [];
  const quantityToSubtractByLotId = new Map<string, Decimal>();

  for (const lotDisposal of lotDisposals) {
    buildLotQuantityUpdateMap(lotDisposal.lotId, lotDisposal.quantityDisposed, quantityToSubtractByLotId);

    for (const binding of targetBindings) {
      const linkTransferFraction = binding.target.quantity.dividedBy(carryover.retainedQuantity);
      const allocatedDisposalQuantity = lotDisposal.quantityDisposed.times(linkTransferFraction);
      const quantityTransferred =
        feePolicy === 'disposal'
          ? allocatedDisposalQuantity
          : lotDisposal.quantityDisposed.times(binding.target.quantity).dividedBy(transferDisposalQuantity);

      const metadata = sameAssetFeeUsdValue
        ? buildTransferMetadata(
            {
              amount: carryover.fee.amount,
              priceAtTxTime: carryover.fee.priceAtTxTime,
            },
            feePolicy,
            allocatedDisposalQuantity,
            transferDisposalQuantity
          )
        : undefined;

      transfers.push({
        id: globalThis.crypto.randomUUID(),
        calculationId,
        sourceLotId: lotDisposal.lotId,
        provenance: {
          kind: 'fee-only-carryover',
          sourceMovementFingerprint: carryover.sourceMovementFingerprint,
          targetMovementFingerprint: binding.target.targetMovementFingerprint,
        },
        quantityTransferred,
        costBasisPerUnit: lotDisposal.costBasisPerUnit,
        sourceTransactionId: sourceTransaction.tx.id,
        targetTransactionId: binding.target.targetTransactionId,
        transferDate: new Date(sourceTransaction.tx.datetime),
        metadata,
        createdAt: new Date(),
      });
    }
  }

  const disposals: LotDisposal[] = [];
  if (carryover.fee.amount.gt(0) && feePolicy === 'disposal') {
    const lotsAfterTransferResult = applyLotQuantityUpdates(lots, quantityToSubtractByLotId);
    if (lotsAfterTransferResult.isErr()) {
      return err(lotsAfterTransferResult.error);
    }

    const remainingLotsAfterTransfer = lotsAfterTransferResult.value.filter(
      (lot) => lot.assetId === carryover.assetId && lot.remainingQuantity.gt(0)
    );
    const feeDisposal = {
      transactionId: sourceTransaction.tx.id,
      assetSymbol: carryover.assetSymbol,
      quantity: carryover.fee.amount,
      date: new Date(sourceTransaction.tx.datetime),
      proceedsPerUnit: carryover.fee.priceAtTxTime?.price.amount ?? parseDecimal('0'),
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

  return ok({ disposals, transfers, updatedLots: updatedLotsResult.value, warnings });
}

export function processFeeOnlyInternalCarryoverTarget(
  sourceTransaction: AccountingScopedTransaction,
  targetTransaction: AccountingScopedTransaction,
  carryover: FeeOnlyInternalCarryover,
  target: FeeOnlyInternalCarryoverTarget,
  bindingKey: string,
  transfersForTarget: LotTransfer[],
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id' | 'average-cost'
): Result<
  {
    lot: AcquisitionLot;
    warnings: CarryoverTargetWarning[];
  },
  Error
> {
  const warnings: CarryoverTargetWarning[] = [];

  if (transfersForTarget.length === 0) {
    warnings.push({
      type: 'no-transfers',
      data: {
        targetTxId: targetTransaction.tx.id,
        targetMovementFingerprint: target.targetMovementFingerprint,
        sourceTxId: sourceTransaction.tx.id,
      },
    });
    return err(
      new Error(
        `No carryover lot transfers found for tx ${sourceTransaction.tx.id} -> ${targetTransaction.tx.id} ` +
          `(binding ${bindingKey})`
      )
    );
  }

  const targetInflow = targetTransaction.movements.inflows.find(
    (movement) => movement.movementFingerprint === target.targetMovementFingerprint
  );
  if (!targetInflow) {
    return err(
      new Error(
        `Carryover target movement ${target.targetMovementFingerprint} not found in transaction ${targetTransaction.tx.id}`
      )
    );
  }

  const { totalCostBasis: inheritedCostBasis, transferredQuantity } = calculateInheritedCostBasis(transfersForTarget);
  const receivedQuantity = target.quantity;

  const varianceResult = validateTransferVariance(
    transferredQuantity,
    receivedQuantity,
    targetTransaction.tx.source,
    targetTransaction.tx.id,
    targetInflow.assetSymbol
  );
  if (varianceResult.isErr()) {
    return err(varianceResult.error);
  }

  const { tolerance, variancePct } = varianceResult.value;
  if (variancePct.gt(tolerance.warn)) {
    warnings.push({
      type: 'variance',
      data: {
        targetTxId: targetTransaction.tx.id,
        targetMovementFingerprint: target.targetMovementFingerprint,
        variancePct,
        transferred: transferredQuantity,
        received: receivedQuantity,
      },
    });
  }

  const sourceFraction = target.quantity.dividedBy(carryover.retainedQuantity);
  const targetFraction = target.quantity.dividedBy(targetInflow.grossAmount);
  const fiatFeesResult = collectFiatFees(sourceTransaction, targetTransaction, {
    sourceFraction,
    targetFraction,
  });
  if (fiatFeesResult.isErr()) {
    return err(fiatFeesResult.error);
  }

  const fiatFees = fiatFeesResult.value;
  for (const fee of fiatFees) {
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

  const costBasisPerUnit = calculateTargetCostBasis(inheritedCostBasis, fiatFees, receivedQuantity);
  const lot = createAcquisitionLot({
    id: globalThis.crypto.randomUUID(),
    calculationId,
    acquisitionTransactionId: targetTransaction.tx.id,
    assetId: targetInflow.assetId,
    assetSymbol: targetInflow.assetSymbol,
    quantity: receivedQuantity,
    costBasisPerUnit,
    method: strategyName,
    transactionDate: new Date(targetTransaction.tx.datetime),
  });

  return ok({ lot, warnings });
}
