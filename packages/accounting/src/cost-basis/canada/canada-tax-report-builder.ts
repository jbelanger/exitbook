import type { Currency } from '@exitbook/core';
import { err, ok, parseDecimal, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { IFxRateProvider } from '../../price-enrichment/shared/types.js';

import type {
  CanadaAcbEngineResult,
  CanadaCostBasisCalculation,
  CanadaDisplayCostBasisReport,
  CanadaDisplayFxConversion,
  CanadaDisplayReportAcquisition,
  CanadaDisplayReportDisposition,
  CanadaDisplayReportTransfer,
  CanadaTaxInputContext,
  CanadaTaxReport,
  CanadaTaxReportAcquisition,
  CanadaTaxReportDisposition,
  CanadaTaxReportTransfer,
  CanadaTaxInputEvent,
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

function getTransferDirection(kind: CanadaTaxInputEvent['kind']): 'in' | 'out' {
  return kind === 'transfer-in' ? 'in' : 'out';
}

export function buildCanadaTaxReport(params: {
  acbEngineResult: CanadaAcbEngineResult;
  calculation: CanadaCostBasisCalculation;
  inputContext: CanadaTaxInputContext;
}): Result<CanadaTaxReport, Error> {
  const acquisitionEvents = new Map(
    params.inputContext.inputEvents
      .filter((event) => event.kind === 'acquisition')
      .map((event) => [event.eventId, event] as const)
  );

  const acquisitions: CanadaTaxReportAcquisition[] = [];
  for (const pool of params.acbEngineResult.pools) {
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

  const dispositions: CanadaTaxReportDisposition[] = params.acbEngineResult.dispositions.map((disposition) => ({
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
    taxableGainLossCad: calculateTaxableGainLoss(disposition.gainLossCad),
    acbPerUnitCad: disposition.acbPerUnitCad,
  }));

  const transfers: CanadaTaxReportTransfer[] = params.inputContext.inputEvents
    .filter((event) => event.kind === 'transfer-in' || event.kind === 'transfer-out')
    .map((event) => ({
      id: event.eventId,
      transactionId: event.transactionId,
      taxPropertyKey: event.taxPropertyKey,
      assetSymbol: event.assetSymbol,
      transferredAt: event.timestamp,
      direction: getTransferDirection(event.kind),
      quantity: event.quantity,
    }));

  return ok({
    calculationId: params.calculation.id,
    taxCurrency: 'CAD',
    acquisitions,
    dispositions,
    transfers,
    superficialLossAdjustments: [],
    summary: {
      totalProceedsCad: params.acbEngineResult.totalProceedsCad,
      totalCostBasisCad: params.acbEngineResult.totalCostBasisCad,
      totalGainLossCad: params.acbEngineResult.totalGainLossCad,
      totalTaxableGainLossCad: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.taxableGainLossCad),
        parseDecimal('0')
      ),
      totalDeniedLossCad: parseDecimal('0'),
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
      displayTaxableGainLoss: disposition.taxableGainLossCad.times(conversion.fxRate),
      displayAcbPerUnit: disposition.acbPerUnitCad.times(conversion.fxRate),
      fxConversion: conversion,
    });
  }

  const transfers: CanadaDisplayReportTransfer[] = [];
  for (const transfer of params.taxReport.transfers) {
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
      totalTaxableGainLoss: dispositions.reduce(
        (sum, disposition) => sum.plus(disposition.displayTaxableGainLoss),
        parseDecimal('0')
      ),
      totalDeniedLoss: parseDecimal('0'),
    },
  });
}
