/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
/**
 * Tests for CostBasisReportGenerator
 */

import { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { CostBasisCalculation, LotDisposal } from '../../domain/schemas.js';
import type { CostBasisRepository } from '../../persistence/cost-basis-repository.js';
import type { FxRateData, IFxRateProvider } from '../../price-enrichment/fx-rate-provider.interface.js';
import { CostBasisReportGenerator } from '../cost-basis-report-generator.js';

describe('CostBasisReportGenerator', () => {
  // Test data
  const mockCalculationId = 'calc-123';
  const mockCalculation: CostBasisCalculation = {
    id: mockCalculationId,
    calculationDate: new Date('2024-01-15'),
    config: {
      method: 'fifo',
      currency: 'USD',
      jurisdiction: 'CA',
      taxYear: 2024,
    },
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    totalProceeds: new Decimal(100000),
    totalCostBasis: new Decimal(80000),
    totalGainLoss: new Decimal(20000),
    totalTaxableGainLoss: new Decimal(10000),
    assetsProcessed: ['BTC', 'ETH'],
    transactionsProcessed: 10,
    lotsCreated: 5,
    disposalsProcessed: 3,
    status: 'completed',
    createdAt: new Date('2024-01-15'),
    completedAt: new Date('2024-01-15'),
  };

  const mockDisposals: LotDisposal[] = [
    {
      id: 'disposal-1',
      lotId: 'lot-1',
      disposalTransactionId: 101,
      quantityDisposed: new Decimal(0.5),
      proceedsPerUnit: new Decimal(50000),
      totalProceeds: new Decimal(25000),
      costBasisPerUnit: new Decimal(40000),
      totalCostBasis: new Decimal(20000),
      gainLoss: new Decimal(5000),
      disposalDate: new Date('2024-03-15'),
      holdingPeriodDays: 90,
      createdAt: new Date('2024-03-15'),
    },
    {
      id: 'disposal-2',
      lotId: 'lot-2',
      disposalTransactionId: 102,
      quantityDisposed: new Decimal(1.0),
      proceedsPerUnit: new Decimal(60000),
      totalProceeds: new Decimal(60000),
      costBasisPerUnit: new Decimal(50000),
      totalCostBasis: new Decimal(50000),
      gainLoss: new Decimal(10000),
      disposalDate: new Date('2024-03-15'), // Same date as disposal-1
      holdingPeriodDays: 120,
      createdAt: new Date('2024-03-15'),
    },
    {
      id: 'disposal-3',
      lotId: 'lot-3',
      disposalTransactionId: 103,
      quantityDisposed: new Decimal(2.0),
      proceedsPerUnit: new Decimal(55000),
      totalProceeds: new Decimal(110000),
      costBasisPerUnit: new Decimal(45000),
      totalCostBasis: new Decimal(90000),
      gainLoss: new Decimal(20000),
      disposalDate: new Date('2024-06-20'), // Different date
      holdingPeriodDays: 180,
      createdAt: new Date('2024-06-20'),
    },
  ];

  function createMockRepository(): CostBasisRepository {
    return {
      findCalculationById: vi.fn().mockResolvedValue(ok(mockCalculation)),
      findDisposalsByCalculationId: vi.fn().mockResolvedValue(ok(mockDisposals)),
    } as unknown as CostBasisRepository;
  }

  function createMockFxProvider(rates: Record<string, Decimal>): IFxRateProvider {
    let callCount = 0;

    return {
      getRateFromUSD: vi.fn().mockImplementation(async (currency: Currency, timestamp: Date) => {
        callCount++;
        const dateKey = timestamp.toISOString().split('T')[0] ?? '';
        const rate = rates[dateKey];

        if (!rate) {
          return err(new Error(`No rate for ${dateKey}`));
        }

        const fxData: FxRateData = {
          rate,
          source: 'test-provider',
          fetchedAt: new Date(),
        };

        return okAsync(fxData);
      }),
      getRateToUSD: vi.fn(),
      getCallCount: () => callCount,
    } as unknown as IFxRateProvider & { getCallCount: () => number };
  }

  describe('generateReport', () => {
    it('should generate USD report without conversion', async () => {
      const repository = createMockRepository();
      const fxProvider = createMockFxProvider({});
      const generator = new CostBasisReportGenerator(repository, fxProvider);

      const result = await generator.generateReport({
        calculationId: mockCalculationId,
        displayCurrency: 'USD',
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const report = result.value;

        // Verify report structure
        expect(report.calculationId).toBe(mockCalculationId);
        expect(report.displayCurrency).toBe('USD');
        expect(report.originalCurrency).toBe('USD');
        expect(report.disposals).toHaveLength(3);

        // Verify no conversion (amounts same as original)
        expect(report.summary.totalProceeds.toFixed()).toBe(mockCalculation.totalProceeds.toFixed());
        expect(report.summary.totalGainLoss.toFixed()).toBe(mockCalculation.totalGainLoss.toFixed());

        // Verify FX metadata shows identity conversion
        expect(report.disposals[0]?.fxConversion.fxRate.toFixed()).toBe('1');
        expect(report.disposals[0]?.fxConversion.fxSource).toBe('identity');

        // Verify FX provider was NOT called
        expect(fxProvider.getRateFromUSD).not.toHaveBeenCalled();
      }
    });

    it('should convert disposals to CAD using historical rates', async () => {
      const repository = createMockRepository();

      // Mock FX rates for specific dates
      const fxProvider = createMockFxProvider({
        '2024-03-15': new Decimal(1.35), // CAD/USD rate on Mar 15
        '2024-06-20': new Decimal(1.37), // CAD/USD rate on Jun 20
      });

      const generator = new CostBasisReportGenerator(repository, fxProvider);

      const result = await generator.generateReport({
        calculationId: mockCalculationId,
        displayCurrency: 'CAD',
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const report = result.value;

        // Verify report structure
        expect(report.calculationId).toBe(mockCalculationId);
        expect(report.displayCurrency).toBe('CAD');
        expect(report.originalCurrency).toBe('USD');
        expect(report.disposals).toHaveLength(3);

        // Verify disposal-1 (Mar 15, rate 1.35)
        const disposal1 = report.disposals[0];
        expect(disposal1?.displayTotalProceeds.toFixed()).toBe(new Decimal(25000).times(1.35).toFixed()); // 25000 * 1.35 = 33750
        expect(disposal1?.displayTotalCostBasis.toFixed()).toBe(new Decimal(20000).times(1.35).toFixed()); // 20000 * 1.35 = 27000
        expect(disposal1?.displayGainLoss.toFixed()).toBe(new Decimal(5000).times(1.35).toFixed()); // 5000 * 1.35 = 6750
        expect(disposal1?.fxConversion.fxRate.toFixed()).toBe('1.35');
        expect(disposal1?.fxConversion.fxSource).toBe('test-provider');

        // Verify disposal-2 (Mar 15, rate 1.35 - same date, should use cached rate)
        const disposal2 = report.disposals[1];
        expect(disposal2?.displayTotalProceeds.toFixed()).toBe(new Decimal(60000).times(1.35).toFixed()); // 60000 * 1.35 = 81000
        expect(disposal2?.displayGainLoss.toFixed()).toBe(new Decimal(10000).times(1.35).toFixed()); // 10000 * 1.35 = 13500
        expect(disposal2?.fxConversion.fxRate.toFixed()).toBe('1.35');

        // Verify disposal-3 (Jun 20, rate 1.37 - different date)
        const disposal3 = report.disposals[2];
        expect(disposal3?.displayTotalProceeds.toFixed()).toBe(new Decimal(110000).times(1.37).toFixed()); // 110000 * 1.37 = 150700
        expect(disposal3?.displayGainLoss.toFixed()).toBe(new Decimal(20000).times(1.37).toFixed()); // 20000 * 1.37 = 27400
        expect(disposal3?.fxConversion.fxRate.toFixed()).toBe('1.37');

        // Verify summary totals are correct
        const expectedTotalProceeds = new Decimal(25000)
          .times(1.35)
          .plus(new Decimal(60000).times(1.35))
          .plus(new Decimal(110000).times(1.37));
        expect(report.summary.totalProceeds.toFixed()).toBe(expectedTotalProceeds.toFixed());

        const expectedTotalGainLoss = new Decimal(5000)
          .times(1.35)
          .plus(new Decimal(10000).times(1.35))
          .plus(new Decimal(20000).times(1.37));
        expect(report.summary.totalGainLoss.toFixed()).toBe(expectedTotalGainLoss.toFixed());

        // Verify taxable gain/loss is correctly calculated with CA jurisdiction (50% inclusion rate)
        // Each disposal's gain is converted to CAD, then 50% is applied for Canadian tax
        const expectedTotalTaxableGainLoss = new Decimal(5000)
          .times(1.35)
          .times(0.5) // 50% inclusion rate for CA
          .plus(new Decimal(10000).times(1.35).times(0.5))
          .plus(new Decimal(20000).times(1.37).times(0.5));
        expect(report.summary.totalTaxableGainLoss.toFixed()).toBe(expectedTotalTaxableGainLoss.toFixed());

        // Verify original summary is preserved
        expect(report.originalSummary.totalProceeds.toFixed()).toBe(mockCalculation.totalProceeds.toFixed());
        expect(report.originalSummary.totalGainLoss.toFixed()).toBe(mockCalculation.totalGainLoss.toFixed());
      }
    });

    it('should cache FX rates by date to minimize API calls', async () => {
      const repository = createMockRepository();

      // Mock FX provider that tracks call count
      const fxProvider = createMockFxProvider({
        '2024-03-15': new Decimal(1.35),
        '2024-06-20': new Decimal(1.37),
      });

      const generator = new CostBasisReportGenerator(repository, fxProvider);

      await generator.generateReport({
        calculationId: mockCalculationId,
        displayCurrency: 'CAD',
      });

      // Verify FX provider was called only twice (once per unique date)
      // Even though we have 3 disposals, 2 are on the same date (2024-03-15)
      expect(fxProvider.getRateFromUSD).toHaveBeenCalledTimes(2);

      // Verify it was called with correct dates
      expect(fxProvider.getRateFromUSD).toHaveBeenCalledWith(expect.any(Currency), new Date('2024-03-15'));
      expect(fxProvider.getRateFromUSD).toHaveBeenCalledWith(expect.any(Currency), new Date('2024-06-20'));
    });

    it('should return error if FX rate is unavailable', async () => {
      const repository = createMockRepository();

      // Mock FX provider that only has rate for one date
      const fxProvider = createMockFxProvider({
        '2024-03-15': new Decimal(1.35),
        // Missing rate for 2024-06-20
      });

      const generator = new CostBasisReportGenerator(repository, fxProvider);

      const result = await generator.generateReport({
        calculationId: mockCalculationId,
        displayCurrency: 'CAD',
      });

      expect(result.isErr()).toBe(true);

      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to fetch FX rate');
        expect(result.error.message).toContain('2024-06-20');
      }
    });

    it('should return error if calculation not found', async () => {
      const repository = {
        findCalculationById: vi.fn().mockResolvedValue(ok(undefined)),
        findDisposalsByCalculationId: vi.fn(),
      } as unknown as CostBasisRepository;

      const fxProvider = createMockFxProvider({});
      const generator = new CostBasisReportGenerator(repository, fxProvider);

      const result = await generator.generateReport({
        calculationId: 'nonexistent',
        displayCurrency: 'CAD',
      });

      expect(result.isErr()).toBe(true);

      if (result.isErr()) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('should handle empty disposals list', async () => {
      const repository = {
        findCalculationById: vi.fn().mockResolvedValue(ok(mockCalculation)),
        findDisposalsByCalculationId: vi.fn().mockResolvedValue(ok([])),
      } as unknown as CostBasisRepository;

      const fxProvider = createMockFxProvider({});
      const generator = new CostBasisReportGenerator(repository, fxProvider);

      const result = await generator.generateReport({
        calculationId: mockCalculationId,
        displayCurrency: 'CAD',
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const report = result.value;
        expect(report.disposals).toHaveLength(0);
        expect(report.summary.totalProceeds.toFixed()).toBe('0');
        expect(report.summary.totalGainLoss.toFixed()).toBe('0');
      }
    });
  });
});
