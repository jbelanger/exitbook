import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import type {
  CanadaAcbEngineResult,
  CanadaAcbPoolState,
  CanadaDispositionEvent,
  CanadaDispositionRecord,
  CanadaSuperficialLossAdjustment,
  CanadaSuperficialLossAdjustmentEvent,
  CanadaTaxInputContext,
  CanadaTaxValuation,
} from '../tax/canada-tax-types.js';

import { runCanadaAcbEngine } from './canada-acb-engine.js';
import type { CanadaSuperficialLossEngineResult } from './canada-superficial-loss-types.js';

const SUPERFICIAL_LOSS_WINDOW_DAYS = 30;

function normalizeDecimal(value: Decimal): Decimal {
  return value.abs().lt(parseDecimal('1e-18')) ? parseDecimal('0') : value;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function createAdjustmentValuation(deniedLossCad: Decimal, timestamp: Date): CanadaTaxValuation {
  return {
    taxCurrency: 'CAD',
    storagePriceAmount: deniedLossCad,
    storagePriceCurrency: 'CAD' as Currency,
    quotedPriceAmount: deniedLossCad,
    quotedPriceCurrency: 'CAD' as Currency,
    unitValueCad: deniedLossCad,
    totalValueCad: deniedLossCad,
    valuationSource: 'stored-price',
    fxTimestamp: timestamp,
  };
}

function buildContextUpTo(context: CanadaTaxInputContext, cutoff: Date): CanadaTaxInputContext {
  return {
    ...context,
    inputEvents: context.inputEvents.filter((event) => event.timestamp.getTime() <= cutoff.getTime()),
  };
}

function getDispositionEvents(context: CanadaTaxInputContext): Map<string, CanadaDispositionEvent> {
  return new Map(
    context.inputEvents
      .filter((event): event is CanadaDispositionEvent => event.kind === 'disposition')
      .map((event) => [event.eventId, event] as const)
  );
}

function findPoolByTaxPropertyKey(pools: CanadaAcbPoolState[], taxPropertyKey: string): CanadaAcbPoolState | undefined {
  return pools.find((pool) => pool.taxPropertyKey === taxPropertyKey);
}

function allocateAcrossEligibleLayers(params: {
  adjustedAt: Date;
  assetSymbol: CanadaDispositionRecord['assetSymbol'];
  deniedLossCad: Decimal;
  deniedQuantity: Decimal;
  eligibleLayers: CanadaAcbPoolState['acquisitionLayers'];
  relatedDispositionId: string;
  taxPropertyKey: string;
}): CanadaSuperficialLossAdjustment[] {
  const totalEligibleQuantity = params.eligibleLayers.reduce(
    (sum, layer) => sum.plus(layer.remainingQuantity),
    parseDecimal('0')
  );

  let allocatedQuantity = parseDecimal('0');
  let allocatedLossCad = parseDecimal('0');

  return params.eligibleLayers.map((layer, index) => {
    const isLastLayer = index === params.eligibleLayers.length - 1;
    const deniedQuantity = isLastLayer
      ? normalizeDecimal(params.deniedQuantity.minus(allocatedQuantity))
      : normalizeDecimal(params.deniedQuantity.times(layer.remainingQuantity).dividedBy(totalEligibleQuantity));
    const deniedLossCad = isLastLayer
      ? normalizeDecimal(params.deniedLossCad.minus(allocatedLossCad))
      : normalizeDecimal(params.deniedLossCad.times(layer.remainingQuantity).dividedBy(totalEligibleQuantity));

    allocatedQuantity = allocatedQuantity.plus(deniedQuantity);
    allocatedLossCad = allocatedLossCad.plus(deniedLossCad);

    return {
      id: `superficial-loss:${params.relatedDispositionId}:${layer.layerId}`,
      adjustedAt: params.adjustedAt,
      assetSymbol: params.assetSymbol,
      deniedLossCad,
      deniedQuantity,
      relatedDispositionId: params.relatedDispositionId,
      taxPropertyKey: params.taxPropertyKey,
      substitutedPropertyAcquisitionId: layer.layerId,
    };
  });
}

function buildSuperficialLossWindow(disposedAt: Date): { cutoff: Date; start: Date } {
  return {
    start: startOfUtcDay(addUtcDays(disposedAt, -SUPERFICIAL_LOSS_WINDOW_DAYS)),
    cutoff: endOfUtcDay(addUtcDays(disposedAt, SUPERFICIAL_LOSS_WINDOW_DAYS)),
  };
}

function getEligibleReacquisitionLayers(params: {
  cutoffPool: CanadaAcbPoolState | undefined;
  disposedAt: Date;
}): CanadaAcbPoolState['acquisitionLayers'] {
  if (!params.cutoffPool) {
    return [];
  }

  const { start, cutoff } = buildSuperficialLossWindow(params.disposedAt);

  return params.cutoffPool.acquisitionLayers
    .filter(
      (layer) =>
        layer.remainingQuantity.gt(0) &&
        layer.acquiredAt.getTime() >= start.getTime() &&
        layer.acquiredAt.getTime() <= cutoff.getTime()
    )
    .sort((left, right) => {
      const timeDiff = left.acquiredAt.getTime() - right.acquiredAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return left.layerId.localeCompare(right.layerId);
    });
}

function createAdjustmentEvent(params: {
  deniedLossCad: Decimal;
  deniedQuantity: Decimal;
  dispositionEvent: CanadaDispositionEvent;
  timestamp: Date;
}): CanadaSuperficialLossAdjustmentEvent {
  return {
    eventId: `superficial-loss-adjustment:${params.dispositionEvent.eventId}`,
    transactionId: params.dispositionEvent.transactionId,
    timestamp: params.timestamp,
    assetId: params.dispositionEvent.assetId,
    assetIdentityKey: params.dispositionEvent.assetIdentityKey,
    taxPropertyKey: params.dispositionEvent.taxPropertyKey,
    assetSymbol: params.dispositionEvent.assetSymbol,
    valuation: createAdjustmentValuation(params.deniedLossCad, params.timestamp),
    provenanceKind: 'superficial-loss-engine',
    priceAtTxTime: undefined,
    kind: 'superficial-loss-adjustment',
    deniedLossCad: params.deniedLossCad,
    deniedQuantity: params.deniedQuantity,
    relatedDispositionEventId: params.dispositionEvent.eventId,
  };
}

export function runCanadaSuperficialLossEngine(params: {
  acbEngineResult: CanadaAcbEngineResult;
  inputContext: CanadaTaxInputContext;
}): Result<CanadaSuperficialLossEngineResult, Error> {
  const dispositionEventsById = getDispositionEvents(params.inputContext);
  const adjustmentEvents: CanadaSuperficialLossAdjustmentEvent[] = [];
  const dispositionAdjustments: CanadaSuperficialLossEngineResult['dispositionAdjustments'] = [];
  const superficialLossAdjustments: CanadaSuperficialLossAdjustment[] = [];

  for (const disposition of params.acbEngineResult.dispositions) {
    if (disposition.gainLossCad.gte(0)) {
      continue;
    }

    const dispositionEvent = dispositionEventsById.get(disposition.dispositionEventId);
    if (!dispositionEvent) {
      return err(
        new Error(`Missing Canada disposition event ${disposition.dispositionEventId} for superficial-loss evaluation`)
      );
    }

    const { cutoff } = buildSuperficialLossWindow(disposition.disposedAt);
    const cutoffContext = buildContextUpTo(params.inputContext, cutoff);
    const cutoffEngineResult = runCanadaAcbEngine(cutoffContext);
    if (cutoffEngineResult.isErr()) {
      return err(
        new Error(
          `Failed to evaluate superficial loss window for ${disposition.dispositionEventId}: ${cutoffEngineResult.error.message}`
        )
      );
    }

    const cutoffPool = findPoolByTaxPropertyKey(cutoffEngineResult.value.pools, disposition.taxPropertyKey);
    const eligibleLayers = getEligibleReacquisitionLayers({
      cutoffPool,
      disposedAt: disposition.disposedAt,
    });
    if (eligibleLayers.length === 0) {
      continue;
    }

    const substitutedQuantity = eligibleLayers.reduce(
      (sum, layer) => sum.plus(layer.remainingQuantity),
      parseDecimal('0')
    );
    const deniedQuantity = Decimal.min(disposition.quantityDisposed, substitutedQuantity);
    if (deniedQuantity.lte(0)) {
      continue;
    }

    const deniedLossCad = normalizeDecimal(
      disposition.gainLossCad.abs().times(deniedQuantity).dividedBy(disposition.quantityDisposed)
    );
    if (deniedLossCad.lte(0)) {
      continue;
    }

    dispositionAdjustments.push({
      dispositionEventId: disposition.dispositionEventId,
      deniedLossCad,
      deniedQuantity,
    });

    superficialLossAdjustments.push(
      ...allocateAcrossEligibleLayers({
        adjustedAt: cutoff,
        assetSymbol: disposition.assetSymbol,
        deniedLossCad,
        deniedQuantity,
        eligibleLayers,
        relatedDispositionId: disposition.dispositionEventId,
        taxPropertyKey: disposition.taxPropertyKey,
      })
    );

    adjustmentEvents.push(
      createAdjustmentEvent({
        deniedLossCad,
        deniedQuantity,
        dispositionEvent,
        timestamp: cutoff,
      })
    );
  }

  return ok({
    adjustmentEvents,
    dispositionAdjustments,
    superficialLossAdjustments,
  });
}
