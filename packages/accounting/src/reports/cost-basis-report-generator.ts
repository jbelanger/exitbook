/**
 * Cost Basis Report Generator
 *
 * Generates reports with display currency conversion for tax reporting.
 * Uses historical FX rates at transaction time (not current rates) for accuracy.
 */

import { Currency, parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { CostBasisCalculation, LotDisposal } from '../domain/schemas.js';
import type { IJurisdictionRules } from '../jurisdictions/base-rules.js';
import { CanadaRules } from '../jurisdictions/canada-rules.js';
import { USRules } from '../jurisdictions/us-rules.js';
import type { IFxRateProvider } from '../price-enrichment/fx-rate-provider.interface.js';

import type { CostBasisReport, ConvertedLotDisposal, FxConversionMetadata } from './types.js';

/**
 * Report generator configuration
 */
export interface ReportGeneratorConfig {
  /** Display currency for the report */
  displayCurrency: string;
  /** Calculation record */
  calculation: CostBasisCalculation;
  /** Disposals to convert */
  disposals: LotDisposal[];
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
  async generateReport(config: ReportGeneratorConfig): Promise<Result<CostBasisReport, Error>> {
    const { calculation, disposals, displayCurrency } = config;

    try {
      this.logger.info(
        { calculationId: calculation.id, disposalCount: disposals.length, displayCurrency },
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

      // Get jurisdiction rules for calculating taxable amounts
      const jurisdictionRules = this.getJurisdictionRules(calculation.config.jurisdiction);

      // Calculate summary totals in display currency
      const summary = this.calculateSummary(convertedDisposals, jurisdictionRules);

      const report: CostBasisReport = {
        calculationId: calculation.id,
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
          calculationId: calculation.id,
          disposalsConverted: convertedDisposals.length,
          totalGainLossUsd: calculation.totalGainLoss.toFixed(),
          totalGainLossDisplay: summary.totalGainLoss.toFixed(),
        },
        'Report generation complete'
      );

      return ok(report);
    } catch (error) {
      this.logger.error({ error, calculationId: calculation.id }, 'Failed to generate report');
      return err(error instanceof Error ? error : new Error(String(error)));
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
      // Add other jurisdictions as they're implemented
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
