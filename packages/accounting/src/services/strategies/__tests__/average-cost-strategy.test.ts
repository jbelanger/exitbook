import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { AcquisitionLot } from '../../../domain/schemas.js';
import { AverageCostStrategy } from '../average-cost-strategy.js';

describe('AverageCostStrategy', () => {
  const strategy = new AverageCostStrategy();

  describe('getName', () => {
    it('should return strategy name', () => {
      expect(strategy.getName()).toBe('average-cost');
    });
  });

  describe('matchDisposal', () => {
    it('should calculate pooled ACB and distribute pro-rata (basic case)', () => {
      // Two lots at different costs
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('1.0'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      // Pooled ACB = (1.0 * 30000 + 1.0 * 40000) / 2.0 = 35000
      const expectedPooledCost = parseDecimal('35000');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        expect(disposals).toHaveLength(2);

        // First lot: dispose 0.5 BTC (50% of pool)
        expect(disposals[0]!.lotId).toBe('lot1');
        expect(disposals[0]!.quantityDisposed.toFixed()).toBe('0.5');
        expect(disposals[0]!.costBasisPerUnit.toFixed()).toBe(expectedPooledCost.toFixed());
        expect(disposals[0]!.totalCostBasis.toFixed()).toBe('17500'); // 0.5 * 35000

        // Second lot: dispose 0.5 BTC (50% of pool, absorbs rounding)
        expect(disposals[1]!.lotId).toBe('lot2');
        expect(disposals[1]!.quantityDisposed.toFixed()).toBe('0.5');
        expect(disposals[1]!.costBasisPerUnit.toFixed()).toBe(expectedPooledCost.toFixed());
        expect(disposals[1]!.totalCostBasis.toFixed()).toBe('17500');

        // Verify total disposed = disposal quantity
        const totalDisposed = disposals.reduce((sum, d) => sum.plus(d.quantityDisposed), parseDecimal('0'));
        expect(totalDisposed.toFixed()).toBe(disposal.quantity.toFixed());
      }
    });

    it('should handle single lot (behaves like FIFO/LIFO)', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('0.5'),
        date: new Date('2024-02-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [createLot('lot1', '1.0', '30000', new Date('2024-01-01'))];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        expect(disposals).toHaveLength(1);
        expect(disposals[0]!.lotId).toBe('lot1');
        expect(disposals[0]!.quantityDisposed.toFixed()).toBe('0.5');
        expect(disposals[0]!.costBasisPerUnit.toFixed()).toBe('30000'); // Same as lot cost
        expect(disposals[0]!.totalCostBasis.toFixed()).toBe('15000');
      }
    });

    it('should handle exact match disposal (all lots fully disposed)', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('2.0'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        expect(disposals).toHaveLength(2);

        // Verify total disposed = total available
        const totalDisposed = disposals.reduce((sum, d) => sum.plus(d.quantityDisposed), parseDecimal('0'));
        expect(totalDisposed.toFixed()).toBe('2');
      }
    });

    it('should distribute pro-rata across multiple lots with different quantities', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('1.5'),
        date: new Date('2024-04-01'),
        proceedsPerUnit: parseDecimal('60000'),
      };

      const lots: AcquisitionLot[] = [
        createLot('lot1', '2.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
        createLot('lot3', '0.5', '50000', new Date('2024-03-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      // Pooled ACB = (2.0*30000 + 1.0*40000 + 0.5*50000) / 3.5 = 125000 / 3.5 = 35714.285714...
      const expectedPooledCost = parseDecimal('125000').dividedBy(new Decimal('3.5'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        expect(disposals).toHaveLength(3);

        // All disposals use same pooled cost per unit
        disposals.forEach((d) => {
          expect(d.costBasisPerUnit.toFixed()).toBe(expectedPooledCost.toFixed());
        });

        // Verify total disposed matches exactly
        const totalDisposed = disposals.reduce((sum, d) => sum.plus(d.quantityDisposed), parseDecimal('0'));
        expect(totalDisposed.toFixed()).toBe(disposal.quantity.toFixed());

        // Verify pro-rata distribution (approximate, last lot absorbs rounding)
        // lot1: 2.0/3.5 * 1.5 = 0.857... lot2: 1.0/3.5 * 1.5 = 0.428...
        // lot3: remainder
        expect(disposals[0]!.lotId).toBe('lot1');
        expect(disposals[0]!.quantityDisposed.toNumber()).toBeCloseTo(0.857, 2);

        expect(disposals[1]!.lotId).toBe('lot2');
        expect(disposals[1]!.quantityDisposed.toNumber()).toBeCloseTo(0.429, 2);

        expect(disposals[2]!.lotId).toBe('lot3');
        // Last lot gets remainder (handles rounding)
      }
    });

    it('should preserve acquisition dates for holding period calculation', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('1.0'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        // Verify holding periods calculated from original acquisition dates
        expect(disposals[0]!.holdingPeriodDays).toBe(60); // Jan 1 to Mar 1
        expect(disposals[1]!.holdingPeriodDays).toBe(29); // Feb 1 to Mar 1
      }
    });

    it('should throw error if insufficient quantity', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('3.0'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toMatch(/Insufficient acquisition lots/);
        expect(result.error.message).toMatch(/Shortfall: 1/);
      }
    });

    it('should skip fully disposed lots', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('0.5'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        {
          ...createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
          remainingQuantity: parseDecimal('0'),
          status: 'fully_disposed',
        },
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        // Should only use lot2
        expect(disposals).toHaveLength(1);
        expect(disposals[0]!.lotId).toBe('lot2');
        expect(disposals[0]!.costBasisPerUnit.toFixed()).toBe('40000'); // Pooled from lot2 only
      }
    });

    it('should handle dust amounts (very small quantities)', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('0.00000001'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        createLot('lot1', '0.00000005', '30000', new Date('2024-01-01')),
        createLot('lot2', '0.00000005', '40000', new Date('2024-02-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        expect(disposals).toHaveLength(2);

        // Verify total disposed = disposal quantity (precision test)
        const totalDisposed = disposals.reduce((sum, d) => sum.plus(d.quantityDisposed), parseDecimal('0'));
        expect(totalDisposed.toFixed(18)).toBe(disposal.quantity.toFixed(18));
      }
    });

    it('should handle precision edge case with 100 lots', () => {
      // Test that remainder absorption handles rounding across many lots
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('10.0'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      // Create 100 lots with varying quantities
      const lots: AcquisitionLot[] = [];
      for (let i = 0; i < 100; i++) {
        lots.push(createLot(`lot${i}`, '0.1', '30000', new Date('2024-01-01')));
      }

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        expect(disposals).toHaveLength(100);

        // Verify exact total (critical precision test)
        const totalDisposed = disposals.reduce((sum, d) => sum.plus(d.quantityDisposed), parseDecimal('0'));
        expect(totalDisposed.toFixed()).toBe('10');
      }
    });

    it('should throw error if all lots are fully disposed', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('1.0'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        {
          ...createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
          remainingQuantity: parseDecimal('0'),
          status: 'fully_disposed',
        },
      ];

      // When all lots are fully disposed, totalQty is 0, so throws "Insufficient" error
      const result = strategy.matchDisposal(disposal, lots);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toMatch(/Insufficient acquisition lots/);
      }
    });

    it('should calculate gain/loss correctly with pooled ACB', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('1.0'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        // Pooled ACB = 35000, proceeds = 50000, gain = 15000
        const totalGainLoss = disposals.reduce((sum, d) => sum.plus(d.gainLoss), parseDecimal('0'));
        expect(totalGainLoss.toFixed()).toBe('15000');

        // Each disposal contributes half the gain
        expect(disposals[0]!.gainLoss.toFixed()).toBe('7500'); // (50000 - 35000) * 0.5
        expect(disposals[1]!.gainLoss.toFixed()).toBe('7500');
      }
    });

    it('should produce deterministic results regardless of input order', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('1.5'),
        date: new Date('2024-04-01'),
        proceedsPerUnit: parseDecimal('60000'),
      };

      // Create lots with different acquisition dates
      const lotsInOrder = [
        createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
        createLot('lot3', '1.0', '50000', new Date('2024-03-01')),
      ];

      // Shuffle the lots to different orders
      const lotsReversed = [lotsInOrder[2]!, lotsInOrder[1]!, lotsInOrder[0]!];
      const lotsScrambled = [lotsInOrder[1]!, lotsInOrder[2]!, lotsInOrder[0]!];

      // Run disposal with each ordering
      const result1 = strategy.matchDisposal(disposal, lotsInOrder);
      const result2 = strategy.matchDisposal(disposal, lotsReversed);
      const result3 = strategy.matchDisposal(disposal, lotsScrambled);

      // All should produce identical results (sorted by acquisitionDate, then id)
      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      expect(result3.isOk()).toBe(true);

      if (result1.isOk() && result2.isOk() && result3.isOk()) {
        const d1 = result1.value;
        const d2 = result2.value;
        const d3 = result3.value;

        expect(d1).toHaveLength(3);
        expect(d2).toHaveLength(3);
        expect(d3).toHaveLength(3);

        // Verify same lot order (oldest first)
        expect(d1[0]!.lotId).toBe('lot1');
        expect(d2[0]!.lotId).toBe('lot1');
        expect(d3[0]!.lotId).toBe('lot1');

        // Verify same quantities disposed from each lot
        for (let i = 0; i < 3; i++) {
          expect(d1[i]!.quantityDisposed.toFixed()).toBe(d2[i]!.quantityDisposed.toFixed());
          expect(d1[i]!.quantityDisposed.toFixed()).toBe(d3[i]!.quantityDisposed.toFixed());
          expect(d1[i]!.lotId).toBe(d2[i]!.lotId);
          expect(d1[i]!.lotId).toBe(d3[i]!.lotId);
        }
      }
    });

    it('should sort by id when acquisition dates are identical', () => {
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('1.0'),
        date: new Date('2024-02-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      // Same acquisition date, different IDs
      const sameDate = new Date('2024-01-01');
      const lots: AcquisitionLot[] = [
        createLot('lot-c', '1.0', '30000', sameDate),
        createLot('lot-a', '1.0', '40000', sameDate),
        createLot('lot-b', '1.0', '50000', sameDate),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        // Should be sorted by id: lot-a, lot-b, lot-c
        expect(disposals[0]!.lotId).toBe('lot-a');
        expect(disposals[1]!.lotId).toBe('lot-b');
        // lot-c gets remainder (last in sorted order)
      }
    });

    it('should ensure exact accounting: sum(disposed) = disposal quantity', () => {
      // Test with numbers that could cause rounding in naive implementations
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('1.0'),
        date: new Date('2024-04-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      // Three equal lots - pro-rata will create 0.333... repeating
      const lots: AcquisitionLot[] = [
        createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
        createLot('lot3', '1.0', '50000', new Date('2024-03-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        // Critical: sum must equal disposal quantity exactly (no precision drift)
        const totalDisposed = disposals.reduce((sum, d) => sum.plus(d.quantityDisposed), parseDecimal('0'));
        expect(totalDisposed.toFixed()).toBe(disposal.quantity.toFixed());
        expect(totalDisposed.equals(disposal.quantity)).toBe(true);
      }
    });

    it('should handle complex pro-rata with many lots', () => {
      // Test with 7 lots (prime number) and non-round disposal quantity
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('2.7183'), // e (Euler's number)
        date: new Date('2024-04-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [];
      for (let i = 0; i < 7; i++) {
        lots.push(createLot(`lot${i}`, '1.5', '30000', new Date('2024-01-01')));
      }

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        // Verify exact accounting despite complex division
        const totalDisposed = disposals.reduce((sum, d) => sum.plus(d.quantityDisposed), parseDecimal('0'));
        expect(totalDisposed.equals(disposal.quantity)).toBe(true);

        // Verify all disposals use pooled cost
        const pooledCost = disposals[0]!.costBasisPerUnit;
        disposals.forEach((d) => {
          expect(d.costBasisPerUnit.equals(pooledCost)).toBe(true);
        });
      }
    });

    it('should skip zero-quantity disposals', () => {
      // If disposal quantity is exactly zero, no disposal records should be created
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('0'),
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        createLot('lot1', '1.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '1.0', '40000', new Date('2024-02-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        // Should return empty array (no disposals)
        expect(disposals).toHaveLength(0);
      }
    });

    it('should never create disposal records with zero quantity', () => {
      // Test with very small disposal that might round to zero on some lots
      const disposal = {
        transactionId: 100,
        assetSymbol: 'BTC',
        quantity: parseDecimal('0.00000001'), // 1 satoshi
        date: new Date('2024-03-01'),
        proceedsPerUnit: parseDecimal('50000'),
      };

      const lots: AcquisitionLot[] = [
        createLot('lot1', '10.0', '30000', new Date('2024-01-01')),
        createLot('lot2', '10.0', '40000', new Date('2024-02-01')),
      ];

      const result = strategy.matchDisposal(disposal, lots);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const disposals = result.value;
        // All disposal records should have non-zero quantity
        disposals.forEach((d) => {
          expect(d.quantityDisposed.gt(0)).toBe(true);
        });

        // Total should still equal disposal quantity
        const totalDisposed = disposals.reduce((sum, d) => sum.plus(d.quantityDisposed), parseDecimal('0'));
        expect(totalDisposed.equals(disposal.quantity)).toBe(true);
      }
    });
  });
});

// Test helper
function createLot(id: string, quantity: string, costBasisPerUnit: string, acquisitionDate: Date): AcquisitionLot {
  const qty = new Decimal(quantity);
  const cost = new Decimal(costBasisPerUnit);
  return {
    id,
    calculationId: 'calc1',
    acquisitionTransactionId: 1,
    assetId: 'test:btc',
    assetSymbol: 'BTC',
    quantity: qty,
    costBasisPerUnit: cost,
    totalCostBasis: qty.times(cost),
    acquisitionDate,
    method: 'average-cost',
    remainingQuantity: qty,
    status: 'open',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
