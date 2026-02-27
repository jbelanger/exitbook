/**
 * Cost Basis Report Generator
 *
 * Generates reports with display currency conversion for tax reporting.
 * Uses historical FX rates at transaction time (not current rates) for accuracy.
 */

import type { Currency } from '@exitbook/core';
import { parseDecimal, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { IFxRateProvider } from '../price-enrichment/types.js';

import type { IJurisdictionRules } from './jurisdictions/base-rules.js';
import { CanadaRules } from './jurisdictions/canada-rules.js';
import { USRules } from './jurisdictions/us-rules.js';
import type {
  CostBasisReport,
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
  FxConversionMetadata,
} from './report-types.js';
import type { AcquisitionLot, CostBasisCalculation, LotDisposal, LotTransfer } from './schemas.js';

/**
 * Report generator configuration
 */
export interface CostBasisReportInput {
  /** Display currency for the report */
  displayCurrency: Currency;
  /** Calculation record */
  calculation: CostBasisCalculation;
  /** Disposals to convert */
  disposals: LotDisposal[];
  /** Acquisition lots to convert */
  lots: AcquisitionLot[];
  /** Lot transfers to convert */
  lotTransfers: LotTransfer[];
}

/**
 * Generates cost basis reports with display currency conversion
 *
 * Key features:
 * - Uses historical FX rates at disposal date (not current rates)
 * - Caches same-day rates to minimize API calls
 * - Full audit trail with FX metadata
 * - Accurate per-transaction conversion
 */
export class CostBasisReportGenerator {
  private readonly logger = getLogger('CostBasisReportGenerator');

  constructor(private readonly fxProvider: IFxRateProvider) {}

  /**
   * Generate cost basis report with display currency conversion
   *
   * @param config - Report configuration
   * @returns Report with converted amounts or error
   */
  async generateReport(config: CostBasisReportInput): Promise<Result<CostBasisReport, Error>> {
    const { calculation, disposals, lots, lotTransfers, displayCurrency } = config;

    try {
      this.logger.info(
        {
          calculationId: calculation.id,
          disposalCount: disposals.length,
          lotCount: lots.length,
          transferCount: lotTransfers.length,
          displayCurrency,
        },
        'Generating cost basis report with currency conversion'
      );

      // If display currency is USD, no conversion needed
      if (displayCurrency === 'USD') {
        return this.generateUsdReport(calculation, disposals, lots, lotTransfers);
      }

      // Shared FX rate cache across all conversions
      const fxRateCache = new Map<string, FxConversionMetadata>();

      // Convert disposals first (hard-fail, populates cache with disposal dates)
      const convertedDisposalsResult = await this.convertDisposals(disposals, displayCurrency, fxRateCache);
      if (convertedDisposalsResult.isErr()) {
        return err(convertedDisposalsResult.error);
      }

      const convertedDisposals = convertedDisposalsResult.value;

      // Convert lots (soft-fail, reuses cache)
      const convertedLots = await this.convertLots(lots, displayCurrency, fxRateCache);

      // Convert transfers (soft-fail, reuses cache)
      const convertedTransfers = await this.convertTransfers(lotTransfers, displayCurrency, fxRateCache);

      // Get jurisdiction rules for calculating taxable amounts
      const jurisdictionRules = this.getJurisdictionRules(calculation.config.jurisdiction);

      // Calculate summary totals in display currency
      const summary = this.calculateSummary(convertedDisposals, jurisdictionRules);

      const report: CostBasisReport = {
        calculationId: calculation.id,
        displayCurrency,
        originalCurrency: 'USD',
        disposals: convertedDisposals,
        lots: convertedLots,
        lotTransfers: convertedTransfers,
        summary,
        originalSummary: {
          totalProceeds: calculation.totalProceeds,
          totalCostBasis: calculation.totalCostBasis,
          totalGainLoss: calculation.totalGainLoss,
          totalTaxableGainLoss: calculation.totalTaxableGainLoss,
        },
      };

      this.logger.info(
        {
          calculationId: calculation.id,
          disposalsConverted: convertedDisposals.length,
          lotsConverted: convertedLots.length,
          transfersConverted: convertedTransfers.length,
          uniqueFxDates: fxRateCache.size,
          totalGainLossUsd: calculation.totalGainLoss.toFixed(),
          totalGainLossDisplay: summary.totalGainLoss.toFixed(),
        },
        'Report generation complete'
      );

      return ok(report);
    } catch (error) {
      this.logger.error({ error, calculationId: calculation.id }, 'Failed to generate report');
      return wrapError(error, 'Failed to generate report');
    }
  }

  /**
   * Get jurisdiction rules based on jurisdiction code
   */
  private getJurisdictionRules(jurisdiction: string): IJurisdictionRules {
    switch (jurisdiction) {
      case 'CA':
        return new CanadaRules();
      case 'US':
        return new USRules();
      default:
        this.logger.warn({ jurisdiction }, 'Unknown jurisdiction, defaulting to US rules');
        return new USRules();
    }
  }

  /**
   * Generate report without conversion (USD display currency)
   */
  private generateUsdReport(
    calculation: CostBasisCalculation,
    disposals: LotDisposal[],
    lots: AcquisitionLot[],
    lotTransfers: LotTransfer[]
  ): Result<CostBasisReport, Error> {
    const identityFxMetadata: FxConversionMetadata = {
      originalCurrency: 'USD',
      displayCurrency: 'USD',
      fxRate: new Decimal(1),
      fxSource: 'identity',
      fxFetchedAt: new Date(),
    };

    // For USD, no conversion needed - just add identity FX metadata
    const convertedDisposals: ConvertedLotDisposal[] = disposals.map((disposal) => ({
      ...disposal,
      displayProceedsPerUnit: disposal.proceedsPerUnit,
      displayTotalProceeds: disposal.totalProceeds,
      displayCostBasisPerUnit: disposal.costBasisPerUnit,
      displayTotalCostBasis: disposal.totalCostBasis,
      displayGainLoss: disposal.gainLoss,
      fxConversion: identityFxMetadata,
    }));

    const convertedLots: ConvertedAcquisitionLot[] = lots.map((lot) => ({
      ...lot,
      displayCostBasisPerUnit: lot.costBasisPerUnit,
      displayTotalCostBasis: lot.totalCostBasis,
      fxConversion: identityFxMetadata,
    }));

    const convertedTransfers: ConvertedLotTransfer[] = lotTransfers.map((transfer) => ({
      ...transfer,
      displayCostBasisPerUnit: transfer.costBasisPerUnit,
      displayTotalCostBasis: transfer.quantityTransferred.times(transfer.costBasisPerUnit),
      fxConversion: identityFxMetadata,
    }));

    const report: CostBasisReport = {
      calculationId: calculation.id,
      displayCurrency: 'USD',
      originalCurrency: 'USD',
      disposals: convertedDisposals,
      lots: convertedLots,
      lotTransfers: convertedTransfers,
      summary: {
        totalProceeds: calculation.totalProceeds,
        totalCostBasis: calculation.totalCostBasis,
        totalGainLoss: calculation.totalGainLoss,
        totalTaxableGainLoss: calculation.totalTaxableGainLoss,
      },
      originalSummary: {
        totalProceeds: calculation.totalProceeds,
        totalCostBasis: calculation.totalCostBasis,
        totalGainLoss: calculation.totalGainLoss,
        totalTaxableGainLoss: calculation.totalTaxableGainLoss,
      },
    };

    return ok(report);
  }

  /**
   * Get or fetch FX rate from cache, with caching by date
   */
  private async getOrFetchFxRate(
    date: Date,
    displayCurrency: Currency,
    cache: Map<string, FxConversionMetadata>
  ): Promise<Result<FxConversionMetadata, Error>> {
    // Get date key for caching (YYYY-MM-DD)
    const dateKey = date.toISOString().split('T')[0] ?? '';

    // Check cache first
    let fxMetadata = cache.get(dateKey);

    if (!fxMetadata) {
      // Fetch FX rate for this date
      this.logger.debug({ date: dateKey, displayCurrency }, 'Fetching FX rate');

      const fxRateResult = await this.fxProvider.getRateFromUSD(displayCurrency, date);

      if (fxRateResult.isErr()) {
        return err(
          new Error(`Failed to fetch FX rate for ${displayCurrency} on ${dateKey}: ${fxRateResult.error.message}`)
        );
      }

      const fxData = fxRateResult.value;

      fxMetadata = {
        originalCurrency: 'USD',
        displayCurrency,
        fxRate: fxData.rate,
        fxSource: fxData.source,
        fxFetchedAt: fxData.fetchedAt,
      };

      // Cache for reuse
      cache.set(dateKey, fxMetadata);

      this.logger.debug({ date: dateKey, rate: fxData.rate.toFixed(), source: fxData.source }, 'Cached FX rate');
    }

    return ok(fxMetadata);
  }

  /**
   * Convert all disposals to display currency using historical rates
   *
   * Key feature: Caches FX rates by date to minimize API calls
   */
  private async convertDisposals(
    disposals: LotDisposal[],
    displayCurrency: Currency,
    cache: Map<string, FxConversionMetadata>
  ): Promise<Result<ConvertedLotDisposal[], Error>> {
    const converted: ConvertedLotDisposal[] = [];

    for (const disposal of disposals) {
      const disposalDate = new Date(disposal.disposalDate);

      // Get FX rate (hard-fail for disposals - tax-critical)
      const fxMetadataResult = await this.getOrFetchFxRate(disposalDate, displayCurrency, cache);
      if (fxMetadataResult.isErr()) {
        return err(fxMetadataResult.error);
      }

      const fxMetadata = fxMetadataResult.value;

      // Convert all USD amounts to display currency
      const convertedDisposal: ConvertedLotDisposal = {
        ...disposal,
        displayProceedsPerUnit: disposal.proceedsPerUnit.times(fxMetadata.fxRate),
        displayTotalProceeds: disposal.totalProceeds.times(fxMetadata.fxRate),
        displayCostBasisPerUnit: disposal.costBasisPerUnit.times(fxMetadata.fxRate),
        displayTotalCostBasis: disposal.totalCostBasis.times(fxMetadata.fxRate),
        displayGainLoss: disposal.gainLoss.times(fxMetadata.fxRate),
        fxConversion: fxMetadata,
      };

      converted.push(convertedDisposal);
    }

    this.logger.info(
      { totalDisposals: disposals.length, uniqueDates: cache.size },
      'Converted all disposals (FX rates cached by date)'
    );

    return ok(converted);
  }

  /**
   * Convert all acquisition lots to display currency using historical rates
   *
   * Soft-fail: On FX error, logs warning and uses identity rate (1.0) with USD fallback
   */
  private async convertLots(
    lots: AcquisitionLot[],
    displayCurrency: Currency,
    cache: Map<string, FxConversionMetadata>
  ): Promise<ConvertedAcquisitionLot[]> {
    const converted: ConvertedAcquisitionLot[] = [];

    for (const lot of lots) {
      const acquisitionDate = new Date(lot.acquisitionDate);

      // Try to get FX rate (soft-fail for lots)
      const fxMetadataResult = await this.getOrFetchFxRate(acquisitionDate, displayCurrency, cache);

      if (fxMetadataResult.isErr()) {
        // FX failure: log warning and use USD fallback with identity rate
        this.logger.warn(
          {
            assetSymbol: lot.assetSymbol,
            lotId: lot.id,
            acquisitionDate: acquisitionDate.toISOString().split('T')[0],
            displayCurrency,
            error: fxMetadataResult.error.message,
          },
          'FX rate unavailable for lot acquisition date, using USD fallback'
        );

        const convertedLot: ConvertedAcquisitionLot = {
          ...lot,
          displayCostBasisPerUnit: lot.costBasisPerUnit,
          displayTotalCostBasis: lot.totalCostBasis,
          fxConversion: {
            originalCurrency: 'USD',
            displayCurrency: 'USD',
            fxRate: new Decimal(1),
            fxSource: 'fallback',
            fxFetchedAt: new Date(),
          },
          fxUnavailable: true,
          originalCurrency: 'USD',
        };

        converted.push(convertedLot);
        continue;
      }

      const fxMetadata = fxMetadataResult.value;

      // Convert USD amounts to display currency
      const convertedLot: ConvertedAcquisitionLot = {
        ...lot,
        displayCostBasisPerUnit: lot.costBasisPerUnit.times(fxMetadata.fxRate),
        displayTotalCostBasis: lot.totalCostBasis.times(fxMetadata.fxRate),
        fxConversion: fxMetadata,
      };

      converted.push(convertedLot);
    }

    this.logger.info({ totalLots: lots.length, uniqueDates: cache.size }, 'Converted all acquisition lots');

    return converted;
  }

  /**
   * Convert all lot transfers to display currency using historical rates
   *
   * Soft-fail: On FX error, logs warning and uses identity rate (1.0) with USD fallback
   */
  private async convertTransfers(
    transfers: LotTransfer[],
    displayCurrency: Currency,
    cache: Map<string, FxConversionMetadata>
  ): Promise<ConvertedLotTransfer[]> {
    const converted: ConvertedLotTransfer[] = [];

    for (const transfer of transfers) {
      const transferDate = new Date(transfer.transferDate);

      // Try to get FX rate (soft-fail for transfers)
      const fxMetadataResult = await this.getOrFetchFxRate(transferDate, displayCurrency, cache);

      if (fxMetadataResult.isErr()) {
        // FX failure: log warning and use USD fallback with identity rate
        this.logger.warn(
          {
            transferId: transfer.id,
            transferDate: transferDate.toISOString().split('T')[0],
            displayCurrency,
            error: fxMetadataResult.error.message,
          },
          'FX rate unavailable for transfer date, using USD fallback'
        );

        const convertedTransfer: ConvertedLotTransfer = {
          ...transfer,
          displayCostBasisPerUnit: transfer.costBasisPerUnit,
          displayTotalCostBasis: transfer.quantityTransferred.times(transfer.costBasisPerUnit),
          fxConversion: {
            originalCurrency: 'USD',
            displayCurrency: 'USD',
            fxRate: new Decimal(1),
            fxSource: 'fallback',
            fxFetchedAt: new Date(),
          },
          fxUnavailable: true,
          originalCurrency: 'USD',
        };

        converted.push(convertedTransfer);
        continue;
      }

      const fxMetadata = fxMetadataResult.value;

      // Convert USD amounts to display currency
      const convertedTransfer: ConvertedLotTransfer = {
        ...transfer,
        displayCostBasisPerUnit: transfer.costBasisPerUnit.times(fxMetadata.fxRate),
        displayTotalCostBasis: transfer.quantityTransferred.times(transfer.costBasisPerUnit).times(fxMetadata.fxRate),
        fxConversion: fxMetadata,
      };

      converted.push(convertedTransfer);
    }

    this.logger.info({ totalTransfers: transfers.length, uniqueDates: cache.size }, 'Converted all lot transfers');

    return converted;
  }

  /**
   * Calculate summary totals from converted disposals
   */
  private calculateSummary(
    disposals: ConvertedLotDisposal[],
    jurisdictionRules: IJurisdictionRules
  ): CostBasisReport['summary'] {
    let totalProceeds = parseDecimal('0');
    let totalCostBasis = parseDecimal('0');
    let totalGainLoss = parseDecimal('0');
    let totalTaxableGainLoss = parseDecimal('0');

    for (const disposal of disposals) {
      totalProceeds = totalProceeds.plus(disposal.displayTotalProceeds);
      totalCostBasis = totalCostBasis.plus(disposal.displayTotalCostBasis);
      totalGainLoss = totalGainLoss.plus(disposal.displayGainLoss);

      // Apply jurisdiction rules to calculate taxable gain/loss from converted capital gain/loss
      const taxableGain = jurisdictionRules.calculateTaxableGain(disposal.displayGainLoss, disposal.holdingPeriodDays);
      totalTaxableGainLoss = totalTaxableGainLoss.plus(taxableGain);
    }

    return {
      totalProceeds,
      totalCostBasis,
      totalGainLoss,
      totalTaxableGainLoss,
    };
  }
}
