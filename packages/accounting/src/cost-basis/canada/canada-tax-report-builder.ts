import type { Currency } from '@exitbook/core';
import { err, ok, parseDecimal, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { IFxRateProvider } from '../../price-enrichment/shared/types.js';

import type { CanadaSuperficialLossEngineResult } from './canada-superficial-loss-types.js';
import { compareCanadaEvents } from './canada-tax-event-ordering.js';
import type {
  CanadaAcbEngineResult,
  CanadaCostBasisCalculation,
  CanadaDisplayCostBasisReport,
  CanadaDisplayFxConversion,
  CanadaDisplayReportAcquisition,
  CanadaDisplayReportDisposition,
  CanadaDisplayReportTransfer,
  CanadaFeeAdjustmentEvent,
  CanadaTaxInputContext,
  CanadaTaxReport,
  CanadaTaxReportAcquisition,
  CanadaTaxReportDisposition,
  CanadaTaxReportTransfer,
  CanadaTransferInEvent,
  CanadaTransferOutEvent,
} from './canada-tax-types.js';

const CANADA_CAPITAL_GAINS_INCLUSION_RATE = parseDecimal('0.5');

function calculateTaxableGainLoss(gainLossCad: Decimal): Decimal {
  // Superficial-loss denied amounts must be reflected in gainLossCad before the
  // Canada inclusion rate is applied here.
  return gainLossCad.times(CANADA_CAPITAL_GAINS_INCLUSION_RATE);
}

function getDateKey(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}

function isWithinCalculationWindow(timestamp: Date, calculation: CanadaCostBasisCalculation): boolean {
  return timestamp.getTime() >= calculation.startDate.getTime() && timestamp.getTime() <= calculation.endDate.getTime();
}

function getSingleTransferDirection(
  kind: CanadaTransferInEvent['kind'] | CanadaTransferOutEvent['kind']
): 'in' | 'out' {
  return kind === 'transfer-in' ? 'in' : 'out';
}

export function buildCanadaTaxReport(params: {
  acbEngineResult: CanadaAcbEngineResult;
  calculation: CanadaCostBasisCalculation;
  inputContext: CanadaTaxInputContext;
  poolSnapshot: CanadaAcbEngineResult;
  superficialLossEngineResult?: CanadaSuperficialLossEngineResult | undefined;
}): Result<CanadaTaxReport, Error> {
  const acquisitionEvents = new Map(
    params.inputContext.inputEvents
      .filter((event) => event.kind === 'acquisition')
      .map((event) => [event.eventId, event] as const)
  );
  const deniedLossByDispositionEventId = new Map(
    params.superficialLossEngineResult?.dispositionAdjustments.map((adjustment) => [
      adjustment.dispositionEventId,
      adjustment,
    ]) ?? []
  );

  const acquisitions: CanadaTaxReportAcquisition[] = [];
  for (const pool of params.poolSnapshot.pools) {
    for (const layer of pool.acquisitionLayers) {
      const acquisitionEvent = acquisitionEvents.get(layer.acquisitionEventId);
      if (!acquisitionEvent) {
        return err(
          new Error(`Missing Canada acquisition event ${layer.acquisitionEventId} for report layer ${layer.layerId}`)
        );
      }

      acquisitions.push({
        id: layer.layerId,
        acquisitionEventId: layer.acquisitionEventId,
        transactionId: layer.acquisitionTransactionId,
        taxPropertyKey: layer.taxPropertyKey,
        assetSymbol: layer.assetSymbol,
        acquiredAt: layer.acquiredAt,
        quantityAcquired: layer.quantityAcquired,
        remainingQuantity: layer.remainingQuantity,
        totalCostCad: layer.totalCostCad,
        remainingAllocatedAcbCad: layer.remainingAllocatedAcbCad,
        costBasisPerUnitCad: layer.quantityAcquired.isZero()
          ? parseDecimal('0')
          : layer.totalCostCad.dividedBy(layer.quantityAcquired),
      });
    }
  }

  const dispositions: CanadaTaxReportDisposition[] = params.acbEngineResult.dispositions
    .filter((disposition) => isWithinCalculationWindow(disposition.disposedAt, params.calculation))
    .map((disposition) => {
      const deniedLossCad =
        deniedLossByDispositionEventId.get(disposition.dispositionEventId)?.deniedLossCad ?? parseDecimal('0');
      const allowableGainLossCad = disposition.gainLossCad.plus(deniedLossCad);

      return {
        id: disposition.dispositionEventId,
        dispositionEventId: disposition.dispositionEventId,
        transactionId: disposition.transactionId,
        taxPropertyKey: disposition.taxPropertyKey,
        assetSymbol: disposition.assetSymbol,
        disposedAt: disposition.disposedAt,
        quantityDisposed: disposition.quantityDisposed,
        proceedsCad: disposition.proceedsCad,
        costBasisCad: disposition.costBasisCad,
        gainLossCad: disposition.gainLossCad,
        deniedLossCad,
        taxableGainLossCad: calculateTaxableGainLoss(allowableGainLossCad),
        acbPerUnitCad: disposition.acbPerUnitCad,
      };
    });
  const reportedDispositionIds = new Set(dispositions.map((disposition) => disposition.id));
  const eventPoolSnapshotsByEventId = new Map(
    params.acbEngineResult.eventPoolSnapshots.map((snapshot) => [snapshot.eventId, snapshot] as const)
  );
  const feeAdjustmentsByLinkId = new Map<number, CanadaFeeAdjustmentEvent[]>();
  const feeAdjustmentsByRelatedEventId = new Map<string, CanadaFeeAdjustmentEvent[]>();
  for (const event of params.inputContext.inputEvents) {
    if (event.kind !== 'fee-adjustment') {
      continue;
    }

    if (event.linkId !== undefined) {
      const group = feeAdjustmentsByLinkId.get(event.linkId);
      if (group) {
        group.push(event);
      } else {
        feeAdjustmentsByLinkId.set(event.linkId, [event]);
      }
    }

    if (event.relatedEventId) {
      const group = feeAdjustmentsByRelatedEventId.get(event.relatedEventId);
      if (group) {
        group.push(event);
      } else {
        feeAdjustmentsByRelatedEventId.set(event.relatedEventId, [event]);
      }
    }
  }

  const transferEvents = params.inputContext.inputEvents
    .filter(
      (event): event is CanadaTransferInEvent | CanadaTransferOutEvent =>
        (event.kind === 'transfer-in' || event.kind === 'transfer-out') &&
        isWithinCalculationWindow(event.timestamp, params.calculation)
    )
    .sort(compareCanadaEvents);

  const collectTransferSettlementFeeAdjustments = (
    baseEvents: (CanadaTransferInEvent | CanadaTransferOutEvent)[],
    linkId?: number
  ): CanadaFeeAdjustmentEvent[] => {
    const settlementEventsById = new Map<string, CanadaFeeAdjustmentEvent>();

    if (linkId !== undefined) {
      for (const feeAdjustment of feeAdjustmentsByLinkId.get(linkId) ?? []) {
        settlementEventsById.set(feeAdjustment.eventId, feeAdjustment);
      }
    }

    for (const baseEvent of baseEvents) {
      for (const feeAdjustment of feeAdjustmentsByRelatedEventId.get(baseEvent.eventId) ?? []) {
        settlementEventsById.set(feeAdjustment.eventId, feeAdjustment);
      }
    }

    return [...settlementEventsById.values()];
  };

  const resolveTransferSettlement = (
    baseEvents: (CanadaTransferInEvent | CanadaTransferOutEvent)[],
    linkId?: number
  ): Result<
    {
      feeAdjustments: CanadaFeeAdjustmentEvent[];
      settledSnapshot: CanadaAcbEngineResult['eventPoolSnapshots'][number];
    },
    Error
  > => {
    const feeAdjustments = collectTransferSettlementFeeAdjustments(baseEvents, linkId);
    const baseEventForSnapshot = [...baseEvents].sort(compareCanadaEvents).at(-1);
    const snapshotEvent =
      [...feeAdjustments].sort(compareCanadaEvents).at(-1) ?? (baseEventForSnapshot ? baseEventForSnapshot : undefined);

    if (!snapshotEvent) {
      return err(new Error('Canada transfer row is missing a base event for snapshot resolution'));
    }

    // Transfer events do not mutate the pooled ACB state. We still snapshot
    // them so standalone transfers without settlement fee adjustments have a
    // stable point-in-time pool state to render against.
    const snapshot = eventPoolSnapshotsByEventId.get(snapshotEvent.eventId);
    if (!snapshot) {
      return err(new Error(`Missing Canada pool snapshot for transfer settlement event ${snapshotEvent.eventId}`));
    }

    return ok({ feeAdjustments, settledSnapshot: snapshot });
  };

  const buildTransferRow = (params: {
    assetSymbol: Currency;
    baseEvents: (CanadaTransferInEvent | CanadaTransferOutEvent)[];
    direction: CanadaTaxReportTransfer['direction'];
    id: string;
    linkId?: number | undefined;
    quantity: Decimal;
    sourceTransactionId?: number | undefined;
    sourceTransferEventId?: string | undefined;
    targetTransactionId?: number | undefined;
    targetTransferEventId?: string | undefined;
    taxPropertyKey: string;
    transactionId: number;
    transferredAt: Date;
  }): Result<CanadaTaxReportTransfer, Error> => {
    const transferSettlementResult = resolveTransferSettlement(params.baseEvents, params.linkId);
    if (transferSettlementResult.isErr()) {
      return err(transferSettlementResult.error);
    }

    const feeAdjustmentCad = transferSettlementResult.value.feeAdjustments.reduce(
      (sum, feeAdjustment) => sum.plus(feeAdjustment.valuation.totalValueCad),
      parseDecimal('0')
    );
    const { settledSnapshot } = transferSettlementResult.value;

    return ok({
      id: params.id,
      direction: params.direction,
      sourceTransferEventId: params.sourceTransferEventId,
      targetTransferEventId: params.targetTransferEventId,
      sourceTransactionId: params.sourceTransactionId,
      targetTransactionId: params.targetTransactionId,
      linkId: params.linkId,
      transactionId: params.transactionId,
      taxPropertyKey: params.taxPropertyKey,
      assetSymbol: params.assetSymbol,
      transferredAt: params.transferredAt,
      quantity: params.quantity,
      // A transfer row carries the pooled ACB assigned to the transferred
      // quantity, not the pool's full ACB balance and not a disposition cost.
      carriedAcbCad: settledSnapshot.acbPerUnitCad.times(params.quantity),
      carriedAcbPerUnitCad: settledSnapshot.acbPerUnitCad,
      feeAdjustmentCad,
    });
  };

  const transferGroupsByLinkId = new Map<
    number,
    { source?: CanadaTransferOutEvent | undefined; target?: CanadaTransferInEvent | undefined }
  >();
  const unlinkedTransferEvents: (CanadaTransferInEvent | CanadaTransferOutEvent)[] = [];
  for (const transferEvent of transferEvents) {
    if (transferEvent.linkId === undefined) {
      unlinkedTransferEvents.push(transferEvent);
      continue;
    }

    const group = transferGroupsByLinkId.get(transferEvent.linkId) ?? {};
    if (transferEvent.kind === 'transfer-out') {
      group.source = transferEvent;
    } else {
      group.target = transferEvent;
    }
    transferGroupsByLinkId.set(transferEvent.linkId, group);
  }

  const transfers: CanadaTaxReportTransfer[] = [];
  const transferMarketValueCadByTransferId = new Map<string, Decimal>();
  for (const [linkId, group] of [...transferGroupsByLinkId.entries()].sort((left, right) => {
    const leftEvent = left[1].source ?? left[1].target;
    const rightEvent = right[1].source ?? right[1].target;
    if (!leftEvent || !rightEvent) return left[0] - right[0];
    return compareCanadaEvents(leftEvent, rightEvent);
  })) {
    const sourceEvent = group.source;
    const targetEvent = group.target;
    if (sourceEvent && targetEvent) {
      const transferRowResult = buildTransferRow({
        id: `link:${linkId}:transfer`,
        direction: 'internal',
        baseEvents: [sourceEvent, targetEvent],
        linkId,
        quantity: targetEvent.quantity,
        sourceTransactionId: sourceEvent.transactionId,
        sourceTransferEventId: sourceEvent.eventId,
        targetTransactionId: targetEvent.transactionId,
        targetTransferEventId: targetEvent.eventId,
        transactionId: targetEvent.transactionId,
        taxPropertyKey: targetEvent.taxPropertyKey,
        assetSymbol: targetEvent.assetSymbol,
        transferredAt: sourceEvent.timestamp,
      });
      if (transferRowResult.isErr()) {
        return err(transferRowResult.error);
      }

      transfers.push(transferRowResult.value);
      transferMarketValueCadByTransferId.set(transferRowResult.value.id, targetEvent.valuation.totalValueCad);
      continue;
    }

    const singleEvent = sourceEvent ?? targetEvent;
    if (!singleEvent) {
      continue;
    }

    const transferRowResult = buildTransferRow({
      id: singleEvent.eventId,
      direction: getSingleTransferDirection(singleEvent.kind),
      baseEvents: [singleEvent],
      linkId,
      quantity: singleEvent.quantity,
      sourceTransactionId:
        singleEvent.kind === 'transfer-out' ? singleEvent.transactionId : singleEvent.sourceTransactionId,
      sourceTransferEventId: singleEvent.kind === 'transfer-out' ? singleEvent.eventId : undefined,
      targetTransactionId: singleEvent.kind === 'transfer-in' ? singleEvent.transactionId : undefined,
      targetTransferEventId: singleEvent.kind === 'transfer-in' ? singleEvent.eventId : undefined,
      transactionId: singleEvent.transactionId,
      taxPropertyKey: singleEvent.taxPropertyKey,
      assetSymbol: singleEvent.assetSymbol,
      transferredAt: singleEvent.timestamp,
    });
    if (transferRowResult.isErr()) {
      return err(transferRowResult.error);
    }

    transfers.push(transferRowResult.value);
    transferMarketValueCadByTransferId.set(transferRowResult.value.id, singleEvent.valuation.totalValueCad);
  }

  for (const transferEvent of unlinkedTransferEvents) {
    const transferRowResult = buildTransferRow({
      id: transferEvent.eventId,
      direction: getSingleTransferDirection(transferEvent.kind),
      baseEvents: [transferEvent],
      quantity: transferEvent.quantity,
      sourceTransactionId:
        transferEvent.kind === 'transfer-out' ? transferEvent.transactionId : transferEvent.sourceTransactionId,
      sourceTransferEventId: transferEvent.kind === 'transfer-out' ? transferEvent.eventId : undefined,
      targetTransactionId: transferEvent.kind === 'transfer-in' ? transferEvent.transactionId : undefined,
      targetTransferEventId: transferEvent.kind === 'transfer-in' ? transferEvent.eventId : undefined,
      transactionId: transferEvent.transactionId,
      taxPropertyKey: transferEvent.taxPropertyKey,
      assetSymbol: transferEvent.assetSymbol,
      transferredAt: transferEvent.timestamp,
    });
    if (transferRowResult.isErr()) {
      return err(transferRowResult.error);
    }

    transfers.push(transferRowResult.value);
    transferMarketValueCadByTransferId.set(transferRowResult.value.id, transferEvent.valuation.totalValueCad);
  }
  transfers.sort((left, right) => {
    const timestampDiff = left.transferredAt.getTime() - right.transferredAt.getTime();
    if (timestampDiff !== 0) return timestampDiff;
    return left.id.localeCompare(right.id);
  });

  return ok({
    calculationId: params.calculation.id,
    taxCurrency: 'CAD',
    acquisitions,
    dispositions,
    transfers,
    superficialLossAdjustments:
      params.superficialLossEngineResult?.superficialLossAdjustments.filter((adjustment) =>
        reportedDispositionIds.has(adjustment.relatedDispositionId)
      ) ?? [],
    summary: {
      totalProceedsCad: dispositions.reduce((sum, disposition) => sum.plus(disposition.proceedsCad), parseDecimal('0')),
      totalCostBasisCad: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.costBasisCad),
        parseDecimal('0')
      ),
      totalGainLossCad: dispositions.reduce((sum, disposition) => sum.plus(disposition.gainLossCad), parseDecimal('0')),
      totalTaxableGainLossCad: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.taxableGainLossCad),
        parseDecimal('0')
      ),
      totalDeniedLossCad: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.deniedLossCad),
        parseDecimal('0')
      ),
    },
    displayContext: {
      transferMarketValueCadByTransferId,
    },
  });
}

async function getCadToDisplayConversion(
  displayCurrency: Currency,
  timestamp: Date,
  fxProvider: IFxRateProvider,
  cache: Map<string, CanadaDisplayFxConversion>
): Promise<Result<CanadaDisplayFxConversion, Error>> {
  // The current fiat providers resolve FX at calendar-date granularity, so one
  // cached CAD->display conversion per date is sufficient here.
  const cacheKey = `${displayCurrency}:${getDateKey(timestamp)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return ok(cached);
  }

  if (displayCurrency === 'CAD') {
    const identityConversion: CanadaDisplayFxConversion = {
      sourceTaxCurrency: 'CAD',
      displayCurrency,
      fxRate: parseDecimal('1'),
      fxSource: 'identity',
      fxFetchedAt: timestamp,
    };
    cache.set(cacheKey, identityConversion);
    return ok(identityConversion);
  }

  let rate: Decimal;
  let fxSource: string;
  let fxFetchedAt: Date;

  if (displayCurrency === 'USD') {
    const cadToUsdResult = await fxProvider.getRateToUSD('CAD' as Currency, timestamp);
    if (cadToUsdResult.isErr()) {
      return err(cadToUsdResult.error);
    }

    rate = cadToUsdResult.value.rate;
    fxSource = cadToUsdResult.value.source;
    fxFetchedAt = cadToUsdResult.value.fetchedAt;
  } else {
    const cadToUsdResult = await fxProvider.getRateToUSD('CAD' as Currency, timestamp);
    if (cadToUsdResult.isErr()) {
      return err(cadToUsdResult.error);
    }

    const usdToDisplayResult = await fxProvider.getRateFromUSD(displayCurrency, timestamp);
    if (usdToDisplayResult.isErr()) {
      return err(usdToDisplayResult.error);
    }

    rate = cadToUsdResult.value.rate.times(usdToDisplayResult.value.rate);
    fxSource = `${cadToUsdResult.value.source}+${usdToDisplayResult.value.source}`;
    fxFetchedAt =
      cadToUsdResult.value.fetchedAt.getTime() >= usdToDisplayResult.value.fetchedAt.getTime()
        ? cadToUsdResult.value.fetchedAt
        : usdToDisplayResult.value.fetchedAt;
  }

  const conversion: CanadaDisplayFxConversion = {
    sourceTaxCurrency: 'CAD',
    displayCurrency,
    fxRate: rate,
    fxSource,
    fxFetchedAt,
  };
  cache.set(cacheKey, conversion);
  return ok(conversion);
}

export async function buildCanadaDisplayCostBasisReport(params: {
  displayCurrency: Currency;
  fxProvider: IFxRateProvider;
  taxReport: CanadaTaxReport;
}): Promise<Result<CanadaDisplayCostBasisReport, Error>> {
  const conversionCache = new Map<string, CanadaDisplayFxConversion>();

  const acquisitions: CanadaDisplayReportAcquisition[] = [];
  for (const acquisition of params.taxReport.acquisitions) {
    const conversionResult = await getCadToDisplayConversion(
      params.displayCurrency,
      acquisition.acquiredAt,
      params.fxProvider,
      conversionCache
    );
    if (conversionResult.isErr()) {
      return err(
        new Error(
          `Failed to convert Canada acquisition ${acquisition.id} to ${params.displayCurrency}: ${conversionResult.error.message}`
        )
      );
    }

    const conversion = conversionResult.value;
    acquisitions.push({
      ...acquisition,
      displayCostBasisPerUnit: acquisition.costBasisPerUnitCad.times(conversion.fxRate),
      displayTotalCost: acquisition.totalCostCad.times(conversion.fxRate),
      displayRemainingAllocatedCost: acquisition.remainingAllocatedAcbCad.times(conversion.fxRate),
      fxConversion: conversion,
    });
  }

  const dispositions: CanadaDisplayReportDisposition[] = [];
  for (const disposition of params.taxReport.dispositions) {
    const conversionResult = await getCadToDisplayConversion(
      params.displayCurrency,
      disposition.disposedAt,
      params.fxProvider,
      conversionCache
    );
    if (conversionResult.isErr()) {
      return err(
        new Error(
          `Failed to convert Canada disposition ${disposition.id} to ${params.displayCurrency}: ${conversionResult.error.message}`
        )
      );
    }

    const conversion = conversionResult.value;
    dispositions.push({
      ...disposition,
      displayProceeds: disposition.proceedsCad.times(conversion.fxRate),
      displayCostBasis: disposition.costBasisCad.times(conversion.fxRate),
      displayGainLoss: disposition.gainLossCad.times(conversion.fxRate),
      displayDeniedLoss: disposition.deniedLossCad.times(conversion.fxRate),
      displayTaxableGainLoss: disposition.taxableGainLossCad.times(conversion.fxRate),
      displayAcbPerUnit: disposition.acbPerUnitCad.times(conversion.fxRate),
      fxConversion: conversion,
    });
  }

  const transfers: CanadaDisplayReportTransfer[] = [];
  for (const transfer of params.taxReport.transfers) {
    const marketValueCad = params.taxReport.displayContext.transferMarketValueCadByTransferId.get(transfer.id);
    if (marketValueCad === undefined) {
      return err(new Error(`Canada transfer ${transfer.id} is missing display market value context`));
    }

    const conversionResult = await getCadToDisplayConversion(
      params.displayCurrency,
      transfer.transferredAt,
      params.fxProvider,
      conversionCache
    );
    if (conversionResult.isErr()) {
      return err(
        new Error(
          `Failed to convert Canada transfer ${transfer.id} to ${params.displayCurrency}: ${conversionResult.error.message}`
        )
      );
    }

    const conversion = conversionResult.value;
    transfers.push({
      ...transfer,
      marketValueCad,
      displayCarriedAcb: transfer.carriedAcbCad.times(conversion.fxRate),
      displayCarriedAcbPerUnit: transfer.carriedAcbPerUnitCad.times(conversion.fxRate),
      displayMarketValue: marketValueCad.times(conversion.fxRate),
      displayFeeAdjustment: transfer.feeAdjustmentCad.times(conversion.fxRate),
      fxConversion: conversion,
    });
  }

  return ok({
    calculationId: params.taxReport.calculationId,
    sourceTaxCurrency: 'CAD',
    displayCurrency: params.displayCurrency,
    acquisitions,
    dispositions,
    transfers,
    summary: {
      totalProceeds: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.displayProceeds),
        parseDecimal('0')
      ),
      totalCostBasis: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.displayCostBasis),
        parseDecimal('0')
      ),
      totalGainLoss: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.displayGainLoss),
        parseDecimal('0')
      ),
      totalDeniedLoss: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.displayDeniedLoss),
        parseDecimal('0')
      ),
      totalTaxableGainLoss: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.displayTaxableGainLoss),
        parseDecimal('0')
      ),
    },
  });
}
