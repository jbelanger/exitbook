/**
 * Cost Basis Report Generator
 *
 * Generates reports with display currency conversion for tax reporting.
 * Uses historical FX rates at transaction time (not current rates) for accuracy.
 */

import { Currency } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { CostBasisCalculation, LotDisposal } from '../domain/schemas.js';
import type { CostBasisRepository } from '../persistence/cost-basis-repository.js';
import type { IFxRateProvider } from '../price-enrichment/fx-rate-provider.interface.js';

import type { CostBasisReport, ConvertedLotDisposal, FxConversionMetadata } from './types.js';

/**
 * Report generator configuration
 */
export interface ReportGeneratorConfig {
  /** Display currency for the report */
  displayCurrency: string;
  /** Calculation ID to generate report for */
  calculationId: string;
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

  constructor(
    private readonly repository: CostBasisRepository,
    private readonly fxProvider: IFxRateProvider
  ) {}

  /**
   * Generate cost basis report with display currency conversion
   *
   * @param config - Report configuration
   * @returns Report with converted amounts or error
   */
  async generateReport(config: ReportGeneratorConfig): Promise<Result<CostBasisReport, Error>> {
    const { calculationId, displayCurrency } = config;

    try {
      // Load calculation
      const calculationResult = await this.repository.findCalculationById(calculationId);
      if (calculationResult.isErr()) {
        return err(calculationResult.error);
      }

      const calculation = calculationResult.value;
      if (!calculation) {
        return err(new Error(`Calculation ${calculationId} not found`));
      }

      // Load all disposals for this calculation
      const disposalsResult = await this.repository.findDisposalsByCalculationId(calculationId);
      if (disposalsResult.isErr()) {
        return err(disposalsResult.error);
      }

      const disposals = disposalsResult.value;

      this.logger.info(
        { calculationId, disposalCount: disposals.length, displayCurrency },
        'Generating cost basis report with currency conversion'
      );

      // If display currency is USD, no conversion needed
      if (displayCurrency === 'USD') {
        return this.generateUsdReport(calculation, disposals);
      }

      // Convert each disposal to display currency
      const convertedDisposalsResult = await this.convertDisposals(disposals, displayCurrency);
      if (convertedDisposalsResult.isErr()) {
        return err(convertedDisposalsResult.error);
      }

      const convertedDisposals = convertedDisposalsResult.value;

      // Calculate summary totals in display currency
      const summary = this.calculateSummary(convertedDisposals);

      const report: CostBasisReport = {
        calculationId,
        displayCurrency,
        originalCurrency: 'USD',
        disposals: convertedDisposals,
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
          calculationId,
          disposalsConverted: convertedDisposals.length,
          totalGainLossUsd: calculation.totalGainLoss.toFixed(),
          totalGainLossDisplay: summary.totalGainLoss.toFixed(),
        },
        'Report generation complete'
      );

      return ok(report);
    } catch (error) {
      this.logger.error({ error, calculationId }, 'Failed to generate report');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Generate report without conversion (USD display currency)
   */
  private generateUsdReport(
    calculation: CostBasisCalculation,
    disposals: LotDisposal[]
  ): Result<CostBasisReport, Error> {
    // For USD, no conversion needed - just add identity FX metadata
    const convertedDisposals: ConvertedLotDisposal[] = disposals.map((disposal) => ({
      ...disposal,
      displayProceedsPerUnit: disposal.proceedsPerUnit,
      displayTotalProceeds: disposal.totalProceeds,
      displayCostBasisPerUnit: disposal.costBasisPerUnit,
      displayTotalCostBasis: disposal.totalCostBasis,
      displayGainLoss: disposal.gainLoss,
      fxConversion: {
        originalCurrency: 'USD',
        displayCurrency: 'USD',
        fxRate: new Decimal(1),
        fxSource: 'identity',
        fxFetchedAt: new Date(),
      },
    }));

    const report: CostBasisReport = {
      calculationId: calculation.id,
      displayCurrency: 'USD',
      originalCurrency: 'USD',
      disposals: convertedDisposals,
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
   * Convert all disposals to display currency using historical rates
   *
   * Key feature: Caches FX rates by date to minimize API calls
   */
  private async convertDisposals(
    disposals: LotDisposal[],
    displayCurrency: string
  ): Promise<Result<ConvertedLotDisposal[], Error>> {
    const converted: ConvertedLotDisposal[] = [];
    const fxRateCache = new Map<string, FxConversionMetadata>(); // date -> FX metadata

    for (const disposal of disposals) {
      // Get date key for caching (YYYY-MM-DD)
      const disposalDate = new Date(disposal.disposalDate);
      const dateKey = disposalDate.toISOString().split('T')[0] ?? '';

      // Check cache first
      let fxMetadata = fxRateCache.get(dateKey);

      if (!fxMetadata) {
        // Fetch FX rate for this disposal date
        this.logger.debug({ date: dateKey, displayCurrency }, 'Fetching FX rate for disposal date');

        const fxRateResult = await this.fxProvider.getRateFromUSD(Currency.create(displayCurrency), disposalDate);

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
        fxRateCache.set(dateKey, fxMetadata);

        this.logger.debug({ date: dateKey, rate: fxData.rate.toFixed(), source: fxData.source }, 'Cached FX rate');
      }

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
      { totalDisposals: disposals.length, uniqueDates: fxRateCache.size },
      'Converted all disposals (FX rates cached by date)'
    );

    return ok(converted);
  }

  /**
   * Calculate summary totals from converted disposals
   */
  private calculateSummary(disposals: ConvertedLotDisposal[]): CostBasisReport['summary'] {
    let totalProceeds = new Decimal(0);
    let totalCostBasis = new Decimal(0);
    let totalGainLoss = new Decimal(0);

    for (const disposal of disposals) {
      totalProceeds = totalProceeds.plus(disposal.displayTotalProceeds);
      totalCostBasis = totalCostBasis.plus(disposal.displayTotalCostBasis);
      totalGainLoss = totalGainLoss.plus(disposal.displayGainLoss);
    }

    // For now, totalTaxableGainLoss = totalGainLoss (jurisdiction rules applied during calculation)
    // In the future, we might need to recalculate tax treatment after conversion
    const totalTaxableGainLoss = totalGainLoss;

    return {
      totalProceeds,
      totalCostBasis,
      totalGainLoss,
      totalTaxableGainLoss,
    };
  }
}
