import type { Result } from '@exitbook/core';
import { err, ok, parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type {
  CanadaAcquisitionEvent,
  CanadaAcbEngineResult,
  CanadaAcbPoolState,
  CanadaAcquisitionLayer,
  CanadaDispositionEvent,
  CanadaDispositionRecord,
  CanadaFeeAdjustmentEvent,
  CanadaLayerDepletion,
  CanadaTaxInputEvent,
  CanadaTaxInputContext,
} from './canada-tax-types.js';

function normalizeDecimal(value: Decimal): Decimal {
  return value.abs().lt(parseDecimal('1e-18')) ? parseDecimal('0') : value;
}

function getEventPriority(kind: CanadaTaxInputEvent['kind']): number {
  switch (kind) {
    case 'transfer-out':
      return 0;
    case 'disposition':
      return 1;
    case 'acquisition':
      return 2;
    case 'transfer-in':
      return 3;
    case 'fee-adjustment':
      return 4;
  }
}

function sortCanadaEvents(events: CanadaTaxInputEvent[]): CanadaTaxInputEvent[] {
  return [...events].sort((left, right) => {
    const timestampDiff = left.timestamp.getTime() - right.timestamp.getTime();
    if (timestampDiff !== 0) return timestampDiff;

    const transactionDiff = left.transactionId - right.transactionId;
    if (transactionDiff !== 0) return transactionDiff;

    const priorityDiff = getEventPriority(left.kind) - getEventPriority(right.kind);
    if (priorityDiff !== 0) return priorityDiff;

    return left.eventId.localeCompare(right.eventId);
  });
}

function getOrInitPool(
  event: Pick<CanadaTaxInputEvent, 'assetSymbol' | 'taxPropertyKey'>,
  poolsByKey: Map<string, CanadaAcbPoolState>
): Result<CanadaAcbPoolState, Error> {
  let pool = poolsByKey.get(event.taxPropertyKey);
  if (!pool) {
    pool = {
      taxPropertyKey: event.taxPropertyKey,
      assetSymbol: event.assetSymbol,
      quantityHeld: parseDecimal('0'),
      totalAcbCad: parseDecimal('0'),
      acbPerUnitCad: parseDecimal('0'),
      acquisitionLayers: [],
    };
    poolsByKey.set(event.taxPropertyKey, pool);
  }

  return ok(pool);
}

function addAcquisitionToPool(pool: CanadaAcbPoolState, event: CanadaAcquisitionEvent): void {
  const totalCostCad = event.valuation.totalValueCad.plus(event.costBasisAdjustmentCad ?? parseDecimal('0'));
  const layer: CanadaAcquisitionLayer = {
    layerId: `layer:${event.eventId}`,
    taxPropertyKey: pool.taxPropertyKey,
    assetSymbol: pool.assetSymbol,
    acquisitionEventId: event.eventId,
    acquisitionTransactionId: event.transactionId,
    acquiredAt: event.timestamp,
    quantityAcquired: event.quantity,
    remainingQuantity: event.quantity,
    totalCostCad,
  };

  pool.acquisitionLayers.push(layer);
  pool.quantityHeld = pool.quantityHeld.plus(event.quantity);
  pool.totalAcbCad = pool.totalAcbCad.plus(totalCostCad);
  pool.acbPerUnitCad = pool.quantityHeld.isZero() ? parseDecimal('0') : pool.totalAcbCad.dividedBy(pool.quantityHeld);
}

function depleteLayersProRata(
  pool: CanadaAcbPoolState,
  quantityToDispose: Decimal
): Result<CanadaLayerDepletion[], Error> {
  const openLayers = pool.acquisitionLayers
    .filter((layer) => layer.remainingQuantity.gt(0))
    .sort((left, right) => {
      const timeDiff = left.acquiredAt.getTime() - right.acquiredAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return left.layerId.localeCompare(right.layerId);
    });

  const totalRemaining = openLayers.reduce((sum, layer) => sum.plus(layer.remainingQuantity), parseDecimal('0'));
  if (quantityToDispose.gt(totalRemaining)) {
    return err(
      new Error(
        `Insufficient acquisition layers for ${pool.taxPropertyKey}. ` +
          `Tried to dispose ${quantityToDispose.toFixed()} with ${totalRemaining.toFixed()} remaining.`
      )
    );
  }

  const depletions: CanadaLayerDepletion[] = [];
  let totalAllocated = parseDecimal('0');

  for (const [index, layer] of openLayers.entries()) {
    const isLastLayer = index === openLayers.length - 1;
    const quantityDisposed = isLastLayer
      ? quantityToDispose.minus(totalAllocated)
      : quantityToDispose.times(layer.remainingQuantity.dividedBy(totalRemaining));

    layer.remainingQuantity = normalizeDecimal(layer.remainingQuantity.minus(quantityDisposed));
    totalAllocated = totalAllocated.plus(quantityDisposed);

    if (quantityDisposed.gt(0)) {
      depletions.push({
        layerId: layer.layerId,
        quantityDisposed,
      });
    }
  }

  const difference = totalAllocated.minus(quantityToDispose).abs();
  if (difference.gt(parseDecimal('1e-18'))) {
    return err(
      new Error(
        `Canada ACB layer depletion drifted by ${difference.toFixed()} for ${pool.taxPropertyKey} ` +
          `while disposing ${quantityToDispose.toFixed()}`
      )
    );
  }

  return ok(depletions);
}

function applyDispositionToPool(
  pool: CanadaAcbPoolState,
  event: CanadaDispositionEvent
): Result<CanadaDispositionRecord, Error> {
  if (event.quantity.gt(pool.quantityHeld)) {
    return err(
      new Error(
        `Insufficient holdings for ${pool.taxPropertyKey}. ` +
          `Tried to dispose ${event.quantity.toFixed()} with ${pool.quantityHeld.toFixed()} available.`
      )
    );
  }

  const acbPerUnitCad = pool.acbPerUnitCad;
  const costBasisCad = acbPerUnitCad.times(event.quantity);
  const proceedsReductionCad = event.proceedsReductionCad ?? parseDecimal('0');
  const proceedsCad = event.valuation.totalValueCad.minus(proceedsReductionCad);
  const gainLossCad = proceedsCad.minus(costBasisCad);

  const depletionResult = depleteLayersProRata(pool, event.quantity);
  if (depletionResult.isErr()) {
    return err(depletionResult.error);
  }

  pool.quantityHeld = normalizeDecimal(pool.quantityHeld.minus(event.quantity));
  pool.totalAcbCad = normalizeDecimal(Decimal.max(parseDecimal('0'), pool.totalAcbCad.minus(costBasisCad)));
  pool.acbPerUnitCad = pool.quantityHeld.isZero() ? parseDecimal('0') : pool.totalAcbCad.dividedBy(pool.quantityHeld);

  return ok({
    dispositionEventId: event.eventId,
    transactionId: event.transactionId,
    taxPropertyKey: pool.taxPropertyKey,
    assetSymbol: pool.assetSymbol,
    disposedAt: event.timestamp,
    quantityDisposed: event.quantity,
    proceedsCad,
    costBasisCad,
    gainLossCad,
    acbPerUnitCad,
    layerDepletions: depletionResult.value,
  });
}

function applyAddToPoolCostAdjustment(pool: CanadaAcbPoolState, event: CanadaFeeAdjustmentEvent): Result<void, Error> {
  if (pool.quantityHeld.lte(0)) {
    return err(
      new Error(
        `Cannot apply add-to-pool cost adjustment ${event.eventId} to ${pool.taxPropertyKey} without existing holdings`
      )
    );
  }

  pool.totalAcbCad = pool.totalAcbCad.plus(event.valuation.totalValueCad);
  pool.acbPerUnitCad = pool.totalAcbCad.dividedBy(pool.quantityHeld);
  return ok(undefined);
}

function applySameAssetTransferFeeAdjustment(
  pool: CanadaAcbPoolState,
  event: CanadaFeeAdjustmentEvent
): Result<void, Error> {
  const quantityReduced = event.quantityReduced;
  if (!quantityReduced || quantityReduced.lte(0)) {
    return err(
      new Error(
        `Same-asset transfer fee adjustment ${event.eventId} requires a positive quantityReduced for ${pool.taxPropertyKey}`
      )
    );
  }

  if (quantityReduced.gt(pool.quantityHeld)) {
    return err(
      new Error(
        `Insufficient holdings for same-asset transfer fee adjustment ${event.eventId} on ${pool.taxPropertyKey}. ` +
          `Tried to reduce ${quantityReduced.toFixed()} with ${pool.quantityHeld.toFixed()} available.`
      )
    );
  }

  const depletionResult = depleteLayersProRata(pool, quantityReduced);
  if (depletionResult.isErr()) {
    return err(depletionResult.error);
  }

  const removedCostCad = pool.acbPerUnitCad.times(quantityReduced);
  const nextQuantityHeld = normalizeDecimal(pool.quantityHeld.minus(quantityReduced));
  const nextTotalAcbCad = normalizeDecimal(
    Decimal.max(parseDecimal('0'), pool.totalAcbCad.minus(removedCostCad).plus(event.valuation.totalValueCad))
  );

  if (nextQuantityHeld.isZero() && nextTotalAcbCad.gt(0)) {
    return err(
      new Error(
        `Same-asset transfer fee adjustment ${event.eventId} leaves positive ACB ${nextTotalAcbCad.toFixed()} ` +
          `with zero holdings for ${pool.taxPropertyKey}`
      )
    );
  }

  pool.quantityHeld = nextQuantityHeld;
  pool.totalAcbCad = nextTotalAcbCad;
  pool.acbPerUnitCad = pool.quantityHeld.isZero() ? parseDecimal('0') : pool.totalAcbCad.dividedBy(pool.quantityHeld);

  return ok(undefined);
}

function applyFeeAdjustmentToPool(pool: CanadaAcbPoolState, event: CanadaFeeAdjustmentEvent): Result<void, Error> {
  switch (event.adjustmentType) {
    case 'add-to-pool-cost':
      return applyAddToPoolCostAdjustment(pool, event);
    case 'same-asset-transfer-fee-add-to-basis':
      return applySameAssetTransferFeeAdjustment(pool, event);
    default:
      return err(
        new Error(
          `Unsupported Canada fee adjustment type ${(event as { adjustmentType?: string }).adjustmentType ?? 'unknown'} ` +
            `for event ${event.eventId}`
        )
      );
  }
}

export function runCanadaAcbEngine(context: CanadaTaxInputContext): Result<CanadaAcbEngineResult, Error> {
  const poolsByKey = new Map<string, CanadaAcbPoolState>();
  const dispositions: CanadaDispositionRecord[] = [];
  let totalProceedsCad = parseDecimal('0');
  let totalCostBasisCad = parseDecimal('0');
  let totalGainLossCad = parseDecimal('0');

  for (const event of sortCanadaEvents(context.inputEvents)) {
    switch (event.kind) {
      case 'transfer-in':
      case 'transfer-out':
        continue;
      case 'acquisition':
      case 'fee-adjustment':
      case 'disposition':
        break;
    }

    const poolResult = getOrInitPool(event, poolsByKey);
    if (poolResult.isErr()) {
      return err(poolResult.error);
    }
    const pool = poolResult.value;

    switch (event.kind) {
      case 'acquisition':
        addAcquisitionToPool(pool, event);
        continue;
      case 'fee-adjustment': {
        const feeAdjustmentResult = applyFeeAdjustmentToPool(pool, event);
        if (feeAdjustmentResult.isErr()) {
          return err(feeAdjustmentResult.error);
        }
        continue;
      }
      case 'disposition':
        break;
    }

    const dispositionResult = applyDispositionToPool(pool, event);
    if (dispositionResult.isErr()) {
      return err(dispositionResult.error);
    }

    dispositions.push(dispositionResult.value);
    totalProceedsCad = totalProceedsCad.plus(dispositionResult.value.proceedsCad);
    totalCostBasisCad = totalCostBasisCad.plus(dispositionResult.value.costBasisCad);
    totalGainLossCad = totalGainLossCad.plus(dispositionResult.value.gainLossCad);
  }

  return ok({
    pools: [...poolsByKey.values()],
    dispositions,
    totalProceedsCad,
    totalCostBasisCad,
    totalGainLossCad,
  });
}
