import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { AcquisitionLot } from '../../../domain/schemas.js';
import { FifoStrategy } from '../fifo-strategy.js';

describe('FifoStrategy', () => {
  const strategy = new FifoStrategy();

  it('should return strategy name', () => {
    expect(strategy.getName()).toBe('fifo');
  });

  it('should match disposal to oldest lot (single lot, full disposal)', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: new Decimal('1'),
      date: new Date('2024-02-01'),
      proceedsPerUnit: new Decimal('50000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
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
    expect(result[0]!.proceedsPerUnit.toString()).toBe('50000');
    expect(result[0]!.totalProceeds.toString()).toBe('50000');
    expect(result[0]!.costBasisPerUnit.toString()).toBe('30000');
    expect(result[0]!.totalCostBasis.toString()).toBe('30000');
    expect(result[0]!.gainLoss.toString()).toBe('20000'); // 50000 - 30000
    expect(result[0]!.holdingPeriodDays).toBe(31); // Jan 1 to Feb 1
  });

  it('should match disposal to oldest lot first (multiple lots, full disposal from one lot)', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: new Decimal('0.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('35000'),
        totalCostBasis: new Decimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result).toHaveLength(1);
    expect(result[0]!.lotId).toBe('lot1'); // Oldest lot used first
    expect(result[0]!.quantityDisposed.toString()).toBe('0.5');
    expect(result[0]!.totalProceeds.toString()).toBe('30000'); // 0.5 * 60000
    expect(result[0]!.totalCostBasis.toString()).toBe('15000'); // 0.5 * 30000
    expect(result[0]!.gainLoss.toString()).toBe('15000');
  });

  it('should match disposal across multiple lots (FIFO order)', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: new Decimal('1.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('35000'),
        totalCostBasis: new Decimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot3',
        calculationId: 'calc1',
        acquisitionTransactionId: 3,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('40000'),
        totalCostBasis: new Decimal('40000'),
        acquisitionDate: new Date('2024-02-01'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result).toHaveLength(2);

    // First disposal: 1 BTC from lot1 (oldest)
    expect(result[0]!.lotId).toBe('lot1');
    expect(result[0]!.quantityDisposed.toString()).toBe('1');
    expect(result[0]!.totalProceeds.toString()).toBe('60000');
    expect(result[0]!.totalCostBasis.toString()).toBe('30000');
    expect(result[0]!.gainLoss.toString()).toBe('30000');

    // Second disposal: 0.5 BTC from lot2 (second oldest)
    expect(result[1]!.lotId).toBe('lot2');
    expect(result[1]!.quantityDisposed.toString()).toBe('0.5');
    expect(result[1]!.totalProceeds.toString()).toBe('30000');
    expect(result[1]!.totalCostBasis.toString()).toBe('17500');
    expect(result[1]!.gainLoss.toString()).toBe('12500');
  });

  it('should skip fully disposed lots', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: new Decimal('0.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: new Decimal('0'), // Fully disposed
        status: 'fully_disposed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('35000'),
        totalCostBasis: new Decimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result).toHaveLength(1);
    expect(result[0]!.lotId).toBe('lot2'); // Skipped lot1, used lot2
  });

  it('should throw error if insufficient lots', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: new Decimal('2'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    expect(() => strategy.matchDisposal(disposal, lots)).toThrow(/Insufficient acquisition lots/);
  });

  it('should sort lots by acquisition date even if provided out of order', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: new Decimal('1.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: new Decimal('60000'),
    };

    // Lots provided in reverse chronological order
    const lots: AcquisitionLot[] = [
      {
        id: 'lot3',
        calculationId: 'calc1',
        acquisitionTransactionId: 3,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('40000'),
        totalCostBasis: new Decimal('40000'),
        acquisitionDate: new Date('2024-02-01'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('35000'),
        totalCostBasis: new Decimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetSymbol: 'BTC',
        quantity: new Decimal('1'),
        costBasisPerUnit: new Decimal('30000'),
        totalCostBasis: new Decimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: new Decimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    // Should still use oldest first
    expect(result[0]!.lotId).toBe('lot1'); // Jan 1
    expect(result[1]!.lotId).toBe('lot2'); // Jan 15
  });
});
