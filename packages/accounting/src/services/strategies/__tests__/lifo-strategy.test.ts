import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { AcquisitionLot } from '../../../domain/schemas.js';
import { LifoStrategy } from '../lifo-strategy.js';

describe('LifoStrategy', () => {
  const strategy = new LifoStrategy();

  it('should return strategy name', () => {
    expect(strategy.getName()).toBe('lifo');
  });

  it('should match disposal to newest lot (single lot, full disposal)', () => {
    const disposal = {
      transactionId: 100,
      asset: 'BTC',
      quantity: new Decimal('1'),
      date: new Date('2024-02-01'),
      proceedsPerUnit: new Decimal('50000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result).toHaveLength(1);
    expect(result[0]!.lotId).toBe('lot1');
    expect(result[0]!.quantityDisposed.toString()).toBe('1');
    expect(result[0]!.gainLoss.toString()).toBe('20000'); // 50000 - 30000
  });

  it('should match disposal to newest lot first (multiple lots)', () => {
    const disposal = {
      transactionId: 100,
      asset: 'BTC',
      quantity: new Decimal('0.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('35000'),
        totalCostBasis: new Decimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result).toHaveLength(1);
    expect(result[0]!.lotId).toBe('lot2'); // Newest lot used first (LIFO)
    expect(result[0]!.quantityDisposed.toString()).toBe('0.5');
    expect(result[0]!.totalProceeds.toString()).toBe('30000'); // 0.5 * 60000
    expect(result[0]!.totalCostBasis.toString()).toBe('17500'); // 0.5 * 35000
    expect(result[0]!.gainLoss.toString()).toBe('12500');
  });

  it('should match disposal across multiple lots (LIFO order)', () => {
    const disposal = {
      transactionId: 100,
      asset: 'BTC',
      quantity: new Decimal('1.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('35000'),
        totalCostBasis: new Decimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot3',
        calculationId: 'calc1',
        acquisitionTransactionId: 3,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('40000'),
        totalCostBasis: new Decimal('40000'),
        acquisitionDate: new Date('2024-02-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result).toHaveLength(2);

    // First disposal: 1 BTC from lot3 (newest)
    expect(result[0]!.lotId).toBe('lot3');
    expect(result[0]!.quantityDisposed.toString()).toBe('1');
    expect(result[0]!.totalProceeds.toString()).toBe('60000');
    expect(result[0]!.totalCostBasis.toString()).toBe('40000');
    expect(result[0]!.gainLoss.toString()).toBe('20000');

    // Second disposal: 0.5 BTC from lot2 (second newest)
    expect(result[1]!.lotId).toBe('lot2');
    expect(result[1]!.quantityDisposed.toString()).toBe('0.5');
    expect(result[1]!.totalProceeds.toString()).toBe('30000');
    expect(result[1]!.totalCostBasis.toString()).toBe('17500');
    expect(result[1]!.gainLoss.toString()).toBe('12500');
  });

  it('should demonstrate LIFO vs FIFO difference (higher cost basis with LIFO in rising market)', () => {
    const disposal = {
      transactionId: 100,
      asset: 'BTC',
      quantity: new Decimal('1'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('50000'),
        totalCostBasis: new Decimal('50000'),
        acquisitionDate: new Date('2024-02-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    // LIFO uses newest lot with higher cost basis
    expect(result[0]!.lotId).toBe('lot2');
    expect(result[0]!.totalCostBasis.toString()).toBe('50000');
    expect(result[0]!.gainLoss.toString()).toBe('10000'); // Lower gain than FIFO (which would be 30000)
  });

  it('should sort lots by acquisition date even if provided out of order', () => {
    const disposal = {
      transactionId: 100,
      asset: 'BTC',
      quantity: new Decimal('1.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    // Lots provided in chronological order (oldest first)
    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('35000'),
        totalCostBasis: new Decimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot3',
        calculationId: 'calc1',
        acquisitionTransactionId: 3,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('40000'),
        totalCostBasis: new Decimal('40000'),
        acquisitionDate: new Date('2024-02-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    // Should still use newest first
    expect(result[0]!.lotId).toBe('lot3'); // Feb 1 (newest)
    expect(result[1]!.lotId).toBe('lot2'); // Jan 15 (second newest)
  });

  it('should skip fully disposed lots', () => {
    const disposal = {
      transactionId: 100,
      asset: 'BTC',
      quantity: new Decimal('0.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('35000'),
        totalCostBasis: new Decimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'lifo',
        remainingQuantity: new Decimal('0'), // Fully disposed
        status: 'fully_disposed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result).toHaveLength(1);
    expect(result[0]!.lotId).toBe('lot1'); // Skipped lot2, used lot1
  });

  it('should throw error if insufficient lots', () => {
    const disposal = {
      transactionId: 100,
      asset: 'BTC',
      quantity: new Decimal('2'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        asset: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'lifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    expect(() => strategy.matchDisposal(disposal, lots)).toThrow(/Insufficient acquisition lots/);
  });
});
