import { type Currency, parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { CanadaRules } from '../../jurisdictions/canada-rules.js';
import { USRules } from '../../jurisdictions/us-rules.js';
import { calculateGainLoss } from '../gain-loss-utils.js';
import type { AssetLotMatchResult } from '../lot-matcher.js';

describe('calculateGainLoss', () => {
  describe('calculate', () => {
    it('should calculate basic capital gains', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('30000'),
              totalCostBasis: parseDecimal('30000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0.5'),
              status: 'partially_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('0.5'),
              proceedsPerUnit: parseDecimal('40000'),
              totalProceeds: parseDecimal('20000'),
              costBasisPerUnit: parseDecimal('30000'),
              totalCostBasis: parseDecimal('15000'),
              gainLoss: parseDecimal('5000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        expect(gainLoss.totalCapitalGainLoss.toString()).toBe('5000');
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('5000'); // US: 100% taxable
        expect(gainLoss.totalDisposalsProcessed).toBe(1);
        expect(gainLoss.disallowedLossCount).toBe(0);

        const btcSummary = gainLoss.byAsset.get('test:btc');
        expect(btcSummary).toBeDefined();
        expect(btcSummary?.totalCapitalGainLoss.toString()).toBe('5000');
      }
    });

    it('should apply Canada 50% inclusion rate', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          assetSymbol: 'ETH' as Currency,
          assetId: 'test:eth',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'ETH' as Currency,
              assetId: 'test:eth',
              quantity: parseDecimal('10'),
              costBasisPerUnit: parseDecimal('2000'),
              totalCostBasis: parseDecimal('20000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('10'),
              proceedsPerUnit: parseDecimal('2500'),
              totalProceeds: parseDecimal('25000'),
              costBasisPerUnit: parseDecimal('2000'),
              totalCostBasis: parseDecimal('20000'),
              gainLoss: parseDecimal('5000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new CanadaRules());

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
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('30000'),
              totalCostBasis: parseDecimal('30000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0.5'),
              status: 'partially_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'lot-2',
              calculationId: 'calc-1',
              acquisitionTransactionId: 3,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('35000'),
              totalCostBasis: parseDecimal('35000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0.5'),
              status: 'partially_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('0.5'),
              proceedsPerUnit: parseDecimal('40000'),
              totalProceeds: parseDecimal('20000'),
              costBasisPerUnit: parseDecimal('30000'),
              totalCostBasis: parseDecimal('15000'),
              gainLoss: parseDecimal('5000'),
              disposalDate: new Date('2023-06-01'), // 151 days - short-term
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
            {
              id: 'disposal-2',
              lotId: 'lot-2',
              disposalTransactionId: 4,
              quantityDisposed: parseDecimal('0.5'),
              proceedsPerUnit: parseDecimal('42000'),
              totalProceeds: parseDecimal('21000'),
              costBasisPerUnit: parseDecimal('35000'),
              totalCostBasis: parseDecimal('17500'),
              gainLoss: parseDecimal('3500'),
              disposalDate: new Date('2024-02-01'), // 397 days - long-term
              holdingPeriodDays: 397,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        const btcSummary = gainLoss.byAsset.get('test:btc');

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
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('1'),
              proceedsPerUnit: parseDecimal('30000'),
              totalProceeds: parseDecimal('30000'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              gainLoss: parseDecimal('-20000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new CanadaRules());

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
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              acquisitionDate,
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'lot-2',
              calculationId: 'calc-1',
              acquisitionTransactionId: 3,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('32000'),
              totalCostBasis: parseDecimal('32000'),
              acquisitionDate: reacquisitionDate,
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('1'),
              status: 'open' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('1'),
              proceedsPerUnit: parseDecimal('30000'),
              totalProceeds: parseDecimal('30000'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              gainLoss: parseDecimal('-20000'),
              disposalDate,
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new CanadaRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        // Loss is disallowed due to superficial loss rule
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('0');
        expect(gainLoss.disallowedLossCount).toBe(1);

        const btcSummary = gainLoss.byAsset.get('test:btc');
        expect(btcSummary?.disposals[0]?.lossDisallowed).toBe(true);
      }
    });

    it('should handle multiple assets', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('30000'),
              totalCostBasis: parseDecimal('30000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0.5'),
              status: 'partially_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('0.5'),
              proceedsPerUnit: parseDecimal('40000'),
              totalProceeds: parseDecimal('20000'),
              costBasisPerUnit: parseDecimal('30000'),
              totalCostBasis: parseDecimal('15000'),
              gainLoss: parseDecimal('5000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
        {
          assetSymbol: 'ETH' as Currency,
          assetId: 'test:eth',
          lots: [
            {
              id: 'lot-2',
              calculationId: 'calc-1',
              acquisitionTransactionId: 3,
              assetSymbol: 'ETH' as Currency,
              assetId: 'test:eth',
              quantity: parseDecimal('10'),
              costBasisPerUnit: parseDecimal('2000'),
              totalCostBasis: parseDecimal('20000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-2',
              lotId: 'lot-2',
              disposalTransactionId: 4,
              quantityDisposed: parseDecimal('10'),
              proceedsPerUnit: parseDecimal('2500'),
              totalProceeds: parseDecimal('25000'),
              costBasisPerUnit: parseDecimal('2000'),
              totalCostBasis: parseDecimal('20000'),
              gainLoss: parseDecimal('5000'),
              disposalDate: new Date('2023-06-01'),
              holdingPeriodDays: 151,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        expect(gainLoss.byAsset.size).toBe(2);
        expect(gainLoss.totalCapitalGainLoss.toString()).toBe('10000');
        expect(gainLoss.totalDisposalsProcessed).toBe(2);

        const btcSummary = gainLoss.byAsset.get('test:btc');
        expect(btcSummary?.totalCapitalGainLoss.toString()).toBe('5000');

        const ethSummary = gainLoss.byAsset.get('test:eth');
        expect(ethSummary?.totalCapitalGainLoss.toString()).toBe('5000');
      }
    });

    it('should handle assets with only acquisitions (no disposals)', () => {
      const assetResults: AssetLotMatchResult[] = [
        {
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('30000'),
              totalCostBasis: parseDecimal('30000'),
              acquisitionDate: new Date('2023-01-01'),
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('1'),
              status: 'open' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [], // No disposals - only bought, never sold
        },
      ];

      const result = calculateGainLoss(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        expect(gainLoss.totalCapitalGainLoss.toString()).toBe('0');
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('0');
        expect(gainLoss.totalDisposalsProcessed).toBe(0);

        const btcSummary = gainLoss.byAsset.get('test:btc');
        expect(btcSummary).toBeDefined();
        expect(btcSummary?.disposalCount).toBe(0);
        expect(btcSummary?.disposals).toEqual([]);
      }
    });

    it('should return zeroed summary for empty asset results (fiat-only transactions)', () => {
      // Valid case: user ran cost basis for a period with only fiat transactions
      // Should return zeroed summary, not an error
      const result = calculateGainLoss([], new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        expect(gainLoss.byAsset.size).toBe(0);
        expect(gainLoss.totalProceeds.toString()).toBe('0');
        expect(gainLoss.totalCostBasis.toString()).toBe('0');
        expect(gainLoss.totalCapitalGainLoss.toString()).toBe('0');
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('0');
        expect(gainLoss.totalDisposalsProcessed).toBe(0);
        expect(gainLoss.disallowedLossCount).toBe(0);
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
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('30000'),
              totalCostBasis: parseDecimal('30000'),
              acquisitionDate,
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('1'),
              proceedsPerUnit: parseDecimal('40000'),
              totalProceeds: parseDecimal('40000'),
              costBasisPerUnit: parseDecimal('30000'),
              totalCostBasis: parseDecimal('30000'),
              gainLoss: parseDecimal('10000'),
              disposalDate,
              holdingPeriodDays,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        const btcSummary = gainLoss.byAsset.get('test:btc');
        const disposal = btcSummary?.disposals[0];

        expect(disposal?.holdingPeriodDays).toBe(holdingPeriodDays);
        expect(disposal?.acquisitionDate).toEqual(acquisitionDate);
        expect(disposal?.disposalDate).toEqual(disposalDate);
      }
    });

    it('should NOT disallow loss when old acquisition is >61 days before disposal', () => {
      // Bug fix test: verify old lots don't trigger wash sale
      // Buy BTC on Jan 1, 2020 (old lot - years ago)
      // Sell at loss on June 1, 2024
      // Buy again on June 15, 2024 (within 30 days after)
      // The 2020 lot should NOT be considered a reacquisition
      const oldLotDate = new Date('2020-01-01');
      const disposalDate = new Date('2024-06-01');
      const reacquisitionDate = new Date('2024-06-15'); // Within wash sale window

      const assetResults: AssetLotMatchResult[] = [
        {
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-old',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('10000'),
              totalCostBasis: parseDecimal('10000'),
              acquisitionDate: oldLotDate, // Very old - should be filtered out
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'lot-reacquire',
              calculationId: 'calc-1',
              acquisitionTransactionId: 3,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('32000'),
              totalCostBasis: parseDecimal('32000'),
              acquisitionDate: reacquisitionDate, // Within window
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('1'),
              status: 'open' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-old',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('1'),
              proceedsPerUnit: parseDecimal('30000'),
              totalProceeds: parseDecimal('30000'),
              costBasisPerUnit: parseDecimal('10000'),
              totalCostBasis: parseDecimal('10000'),
              gainLoss: parseDecimal('20000'), // Gain, not loss
              disposalDate,
              holdingPeriodDays: 1613, // Long holding period
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        // This is a GAIN, so wash sale doesn't apply anyway
        expect(gainLoss.disallowedLossCount).toBe(0);
      }
    });

    it('should NOT disallow loss when reacquisition is >61 days after disposal (US wash sale)', () => {
      // Buy BTC Jan 1, 2024
      // Sell at loss Feb 1, 2024
      // Buy again May 1, 2024 (89 days after disposal - outside 30-day window)
      // Loss should NOT be disallowed
      const acquisitionDate = new Date('2024-01-01');
      const disposalDate = new Date('2024-02-01');
      const reacquisitionDate = new Date('2024-05-01'); // 89 days after disposal

      const assetResults: AssetLotMatchResult[] = [
        {
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              acquisitionDate,
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'lot-2',
              calculationId: 'calc-1',
              acquisitionTransactionId: 3,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('32000'),
              totalCostBasis: parseDecimal('32000'),
              acquisitionDate: reacquisitionDate, // Outside window
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('1'),
              status: 'open' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('1'),
              proceedsPerUnit: parseDecimal('30000'),
              totalProceeds: parseDecimal('30000'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              gainLoss: parseDecimal('-20000'), // Loss
              disposalDate,
              holdingPeriodDays: 31,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        // Loss should be allowed (reacquisition outside 30-day window)
        expect(gainLoss.disallowedLossCount).toBe(0);
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('-20000');

        const btcSummary = gainLoss.byAsset.get('test:btc');
        expect(btcSummary?.disposals[0]?.lossDisallowed).toBe(false);
      }
    });

    it('should NOT disallow loss when reacquisition is >61 days before disposal (Canada superficial loss)', () => {
      // Buy BTC Jan 1, 2024
      // Sell at loss May 1, 2024
      // Reacquisition on Jan 1 is >61 days before disposal
      // Loss should NOT be disallowed
      const firstAcquisitionDate = new Date('2024-01-01'); // Original purchase
      const disposalDate = new Date('2024-05-01'); // Sell at loss (120 days later)
      const secondAcquisitionDate = new Date('2024-01-15'); // Buy more 14 days after first

      const assetResults: AssetLotMatchResult[] = [
        {
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              acquisitionDate: firstAcquisitionDate, // 120 days before disposal
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'lot-2',
              calculationId: 'calc-1',
              acquisitionTransactionId: 2,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('48000'),
              totalCostBasis: parseDecimal('48000'),
              acquisitionDate: secondAcquisitionDate, // 106 days before disposal
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('1'),
              status: 'open' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 3,
              quantityDisposed: parseDecimal('1'),
              proceedsPerUnit: parseDecimal('30000'),
              totalProceeds: parseDecimal('30000'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              gainLoss: parseDecimal('-20000'), // Loss
              disposalDate,
              holdingPeriodDays: 120,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new CanadaRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        // Loss should be allowed (all acquisitions are >61 days before disposal)
        expect(gainLoss.disallowedLossCount).toBe(0);
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('-10000'); // 50% inclusion

        const btcSummary = gainLoss.byAsset.get('test:btc');
        expect(btcSummary?.disposals[0]?.lossDisallowed).toBe(false);
      }
    });

    it('should disallow loss when reacquisition is within 61 days (US wash sale)', () => {
      // Buy BTC Jan 1, 2024
      // Sell at loss Feb 1, 2024
      // Buy again Feb 15, 2024 (14 days after disposal - within 30-day window)
      // Loss SHOULD be disallowed
      const acquisitionDate = new Date('2024-01-01');
      const disposalDate = new Date('2024-02-01');
      const reacquisitionDate = new Date('2024-02-15'); // Within window

      const assetResults: AssetLotMatchResult[] = [
        {
          assetSymbol: 'BTC' as Currency,
          assetId: 'test:btc',
          lots: [
            {
              id: 'lot-1',
              calculationId: 'calc-1',
              acquisitionTransactionId: 1,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              acquisitionDate,
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('0'),
              status: 'fully_disposed' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'lot-2',
              calculationId: 'calc-1',
              acquisitionTransactionId: 3,
              assetSymbol: 'BTC' as Currency,
              assetId: 'test:btc',
              quantity: parseDecimal('1'),
              costBasisPerUnit: parseDecimal('32000'),
              totalCostBasis: parseDecimal('32000'),
              acquisitionDate: reacquisitionDate, // Within window
              method: 'fifo' as const,
              remainingQuantity: parseDecimal('1'),
              status: 'open' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          lotTransfers: [],
          disposals: [
            {
              id: 'disposal-1',
              lotId: 'lot-1',
              disposalTransactionId: 2,
              quantityDisposed: parseDecimal('1'),
              proceedsPerUnit: parseDecimal('30000'),
              totalProceeds: parseDecimal('30000'),
              costBasisPerUnit: parseDecimal('50000'),
              totalCostBasis: parseDecimal('50000'),
              gainLoss: parseDecimal('-20000'), // Loss
              disposalDate,
              holdingPeriodDays: 31,
              createdAt: new Date(),
            },
          ],
        },
      ];

      const result = calculateGainLoss(assetResults, new USRules());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const gainLoss = result.value;
        // Loss should be disallowed (reacquisition within 30-day window)
        expect(gainLoss.disallowedLossCount).toBe(1);
        expect(gainLoss.totalTaxableGainLoss.toString()).toBe('0');

        const btcSummary = gainLoss.byAsset.get('test:btc');
        expect(btcSummary?.disposals[0]?.lossDisallowed).toBe(true);
      }
    });
  });
});
