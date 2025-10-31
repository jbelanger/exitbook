import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { CanadaRules } from '../../jurisdictions/canada-rules.js';
import { USRules } from '../../jurisdictions/us-rules.js';
import { GainLossCalculator } from '../gain-loss-calculator.js';
import type { AssetLotMatchResult } from '../lot-matcher.js';

describe('GainLossCalculator', () => {
  const calculator = new GainLossCalculator();

  describe('calculate', () => {
    it('should calculate basic capital gains', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          asset: 'BTC',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              asset: 'BTC',
              quantity: new Decimal('1'),
              costBasisPerUnit: new Decimal('30000'),
              totalCostBasis: new Decimal('30000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: new Decimal('0.5'),
              status: 'partially_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: new Decimal('0.5'),
              proceedsPerUnit: new Decimal('40000'),
              totalProceeds: new Decimal('20000'),
              costBasisPerUnit: new Decimal('30000'),
              totalCostBasis: new Decimal('15000'),
              gainLoss: new Decimal('5000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculator.calculate(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        expect(gainLoss.totalCapitalGainLoss.toString()).toBe('5000');
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('5000'); // US: 100% taxable
        expect(gainLoss.totalDisposalsProcessed).toBe(1);
        expect(gainLoss.disallowedLossCount).toBe(0);

        const btcSummary = gainLoss.byAsset.get('BTC');
        expect(btcSummary).toBeDefined();
        expect(btcSummary?.totalCapitalGainLoss.toString()).toBe('5000');
      }
    });

    it('should apply Canada 50% inclusion rate', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          asset: 'ETH',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              asset: 'ETH',
              quantity: new Decimal('10'),
              costBasisPerUnit: new Decimal('2000'),
              totalCostBasis: new Decimal('20000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: new Decimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: new Decimal('10'),
              proceedsPerUnit: new Decimal('2500'),
              totalProceeds: new Decimal('25000'),
              costBasisPerUnit: new Decimal('2000'),
              totalCostBasis: new Decimal('20000'),
              gainLoss: new Decimal('5000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculator.calculate(assetResults, new CanadaRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        expect(gainLoss.totalCapitalGainLoss.toString()).toBe('5000');
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('2500'); // Canada: 50% inclusion
      }
    });

    it('should classify short-term vs long-term gains for US', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          asset: 'BTC',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              asset: 'BTC',
              quantity: new Decimal('1'),
              costBasisPerUnit: new Decimal('30000'),
              totalCostBasis: new Decimal('30000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: new Decimal('0.5'),
              status: 'partially_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'lot-2',
              calculationId: 'calc-1',
              acquisitionTransactionId: 3,
              asset: 'BTC',
              quantity: new Decimal('1'),
              costBasisPerUnit: new Decimal('35000'),
              totalCostBasis: new Decimal('35000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: new Decimal('0.5'),
              status: 'partially_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: new Decimal('0.5'),
              proceedsPerUnit: new Decimal('40000'),
              totalProceeds: new Decimal('20000'),
              costBasisPerUnit: new Decimal('30000'),
              totalCostBasis: new Decimal('15000'),
              gainLoss: new Decimal('5000'),
              disposalDate: new Date('2023-06-01'), // 151 days - short-term
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
            {
              id: 'disposal-2',
              lotId: 'lot-2',
              disposalTransactionId: 4,
              quantityDisposed: new Decimal('0.5'),
              proceedsPerUnit: new Decimal('42000'),
              totalProceeds: new Decimal('21000'),
              costBasisPerUnit: new Decimal('35000'),
              totalCostBasis: new Decimal('17500'),
              gainLoss: new Decimal('3500'),
              disposalDate: new Date('2024-02-01'), // 397 days - long-term
              holdingPeriodDays: 397,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculator.calculate(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        const btcSummary = gainLoss.byAsset.get('BTC');

        expect(btcSummary).toBeDefined();
        expect(btcSummary?.byCategory.size).toBe(2);

        const shortTerm = btcSummary?.byCategory.get('short_term');
        expect(shortTerm?.count).toBe(1);
        expect(shortTerm?.gainLoss.toString()).toBe('5000');

        const longTerm = btcSummary?.byCategory.get('long_term');
        expect(longTerm?.count).toBe(1);
        expect(longTerm?.gainLoss.toString()).toBe('3500');
      }
    });

    it('should handle capital losses', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          asset: 'BTC',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              asset: 'BTC',
              quantity: new Decimal('1'),
              costBasisPerUnit: new Decimal('50000'),
              totalCostBasis: new Decimal('50000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: new Decimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: new Decimal('1'),
              proceedsPerUnit: new Decimal('30000'),
              totalProceeds: new Decimal('30000'),
              costBasisPerUnit: new Decimal('50000'),
              totalCostBasis: new Decimal('50000'),
              gainLoss: new Decimal('-20000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculator.calculate(assetResults, new CanadaRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        expect(gainLoss.totalCapitalGainLoss.toString()).toBe('-20000');
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('-10000'); // Canada: 50% of loss
      }
    });

    it('should detect superficial loss (Canada)', () => {
      const acquisitionDate = new Date('2023-01-01');
      const disposalDate = new Date('2023-06-01');
      const reacquisitionDate = new Date('2023-06-15'); // 14 days after disposal

      const assetResults: AssetLotMatchResult[] = [
        {
          asset: 'BTC',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              asset: 'BTC',
              quantity: new Decimal('1'),
              costBasisPerUnit: new Decimal('50000'),
              totalCostBasis: new Decimal('50000'),
              acquisitionDate,
              method: 'fifo' as const,
              remainingQuantity: new Decimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'lot-2',
              calculationId: 'calc-1',
              acquisitionTransactionId: 3,
              asset: 'BTC',
              quantity: new Decimal('1'),
              costBasisPerUnit: new Decimal('32000'),
              totalCostBasis: new Decimal('32000'),
              acquisitionDate: reacquisitionDate,
              method: 'fifo' as const,
              remainingQuantity: new Decimal('1'),
              status: 'open' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: new Decimal('1'),
              proceedsPerUnit: new Decimal('30000'),
              totalProceeds: new Decimal('30000'),
              costBasisPerUnit: new Decimal('50000'),
              totalCostBasis: new Decimal('50000'),
              gainLoss: new Decimal('-20000'),
              disposalDate,
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculator.calculate(assetResults, new CanadaRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        // Loss is disallowed due to superficial loss rule
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('0');
        expect(gainLoss.disallowedLossCount).toBe(1);

        const btcSummary = gainLoss.byAsset.get('BTC');
        expect(btcSummary?.disposals[0]?.lossDisallowed).toBe(true);
      }
    });

    it('should handle multiple assets', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          asset: 'BTC',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              asset: 'BTC',
              quantity: new Decimal('1'),
              costBasisPerUnit: new Decimal('30000'),
              totalCostBasis: new Decimal('30000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: new Decimal('0.5'),
              status: 'partially_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: new Decimal('0.5'),
              proceedsPerUnit: new Decimal('40000'),
              totalProceeds: new Decimal('20000'),
              costBasisPerUnit: new Decimal('30000'),
              totalCostBasis: new Decimal('15000'),
              gainLoss: new Decimal('5000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
        {
          asset: 'ETH',
          lots: [
            {
              id: 'lot-2',
              calculationId: 'calc-1',
              acquisitionTransactionId: 3,
              asset: 'ETH',
              quantity: new Decimal('10'),
              costBasisPerUnit: new Decimal('2000'),
              totalCostBasis: new Decimal('20000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: new Decimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          disposals: [
            {
              id: 'disposal-2',
              lotId: 'lot-2',
              disposalTransactionId: 4,
              quantityDisposed: new Decimal('10'),
              proceedsPerUnit: new Decimal('2500'),
              totalProceeds: new Decimal('25000'),
              costBasisPerUnit: new Decimal('2000'),
              totalCostBasis: new Decimal('20000'),
              gainLoss: new Decimal('5000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculator.calculate(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        expect(gainLoss.byAsset.size).toBe(2);
        expect(gainLoss.totalCapitalGainLoss.toString()).toBe('10000');
        expect(gainLoss.totalDisposalsProcessed).toBe(2);

        const btcSummary = gainLoss.byAsset.get('BTC');
        expect(btcSummary?.totalCapitalGainLoss.toString()).toBe('5000');

        const ethSummary = gainLoss.byAsset.get('ETH');
        expect(ethSummary?.totalCapitalGainLoss.toString()).toBe('5000');
      }
    });

    it('should handle assets with only acquisitions (no disposals)', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          asset: 'BTC',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              asset: 'BTC',
              quantity: new Decimal('1'),
              costBasisPerUnit: new Decimal('30000'),
              totalCostBasis: new Decimal('30000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: new Decimal('1'),
              status: 'open' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          disposals: [], // No disposals - only bought, never sold
        },
      ];

      const result = calculator.calculate(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        expect(gainLoss.totalCapitalGainLoss.toString()).toBe('0');
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('0');
        expect(gainLoss.totalDisposalsProcessed).toBe(0);

        const btcSummary = gainLoss.byAsset.get('BTC');
        expect(btcSummary).toBeDefined();
        expect(btcSummary?.disposalCount).toBe(0);
        expect(btcSummary?.disposals).toEqual([]);
      }
    });

    it('should return error for empty asset results', () => {
      const result = calculator.calculate([], new USRules());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('zero assets');
      }
    });

    it('should calculate holding periods correctly', () => {
      const acquisitionDate = new Date('2023-01-01');
      const disposalDate = new Date('2023-12-31');
      const holdingPeriodDays = Math.floor(
        (disposalDate.getTime() - acquisitionDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const assetResults: AssetLotMatchResult[] = [
        {
          asset: 'BTC',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              asset: 'BTC',
              quantity: new Decimal('1'),
              costBasisPerUnit: new Decimal('30000'),
              totalCostBasis: new Decimal('30000'),
              acquisitionDate,
              method: 'fifo' as const,
              remainingQuantity: new Decimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: new Decimal('1'),
              proceedsPerUnit: new Decimal('40000'),
              totalProceeds: new Decimal('40000'),
              costBasisPerUnit: new Decimal('30000'),
              totalCostBasis: new Decimal('30000'),
              gainLoss: new Decimal('10000'),
              disposalDate,
              holdingPeriodDays,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculator.calculate(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        const btcSummary = gainLoss.byAsset.get('BTC');
        const disposal = btcSummary?.disposals[0];

        expect(disposal?.holdingPeriodDays).toBe(holdingPeriodDays);
        expect(disposal?.acquisitionDate).toEqual(acquisitionDate);
        expect(disposal?.disposalDate).toEqual(disposalDate);
      }
    });
  });
});
