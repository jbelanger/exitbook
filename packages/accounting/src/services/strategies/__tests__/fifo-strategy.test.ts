import { parseDecimal } from '@exitbook/core';
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
      quantity: parseDecimal('1'),
      date: new Date('2024-02-01'),
      proceedsPerUnit: parseDecimal('50000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('30000'),
        totalCostBasis: parseDecimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.lotId).toBe('lot1');
      expect(disposals[0]!.quantityDisposed.toString()).toBe('1');
      expect(disposals[0]!.proceedsPerUnit.toString()).toBe('50000');
      expect(disposals[0]!.totalProceeds.toString()).toBe('50000');
      expect(disposals[0]!.costBasisPerUnit.toString()).toBe('30000');
      expect(disposals[0]!.totalCostBasis.toString()).toBe('30000');
      expect(disposals[0]!.gainLoss.toString()).toBe('20000'); // 50000 - 30000
      expect(disposals[0]!.holdingPeriodDays).toBe(31); // Jan 1 to Feb 1
    }
  });

  it('should match disposal to oldest lot first (multiple lots, full disposal from one lot)', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: parseDecimal('0.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: parseDecimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('30000'),
        totalCostBasis: parseDecimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('35000'),
        totalCostBasis: parseDecimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.lotId).toBe('lot1'); // Oldest lot used first
      expect(disposals[0]!.quantityDisposed.toString()).toBe('0.5');
      expect(disposals[0]!.totalProceeds.toString()).toBe('30000'); // 0.5 * 60000
      expect(disposals[0]!.totalCostBasis.toString()).toBe('15000'); // 0.5 * 30000
      expect(disposals[0]!.gainLoss.toString()).toBe('15000');
    }
  });

  it('should match disposal across multiple lots (FIFO order)', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: parseDecimal('1.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: parseDecimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('30000'),
        totalCostBasis: parseDecimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('35000'),
        totalCostBasis: parseDecimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot3',
        calculationId: 'calc1',
        acquisitionTransactionId: 3,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('40000'),
        totalCostBasis: parseDecimal('40000'),
        acquisitionDate: new Date('2024-02-01'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(2);

      // First disposal: 1 BTC from lot1 (oldest)
      expect(disposals[0]!.lotId).toBe('lot1');
      expect(disposals[0]!.quantityDisposed.toString()).toBe('1');
      expect(disposals[0]!.totalProceeds.toString()).toBe('60000');
      expect(disposals[0]!.totalCostBasis.toString()).toBe('30000');
      expect(disposals[0]!.gainLoss.toString()).toBe('30000');

      // Second disposal: 0.5 BTC from lot2 (second oldest)
      expect(disposals[1]!.lotId).toBe('lot2');
      expect(disposals[1]!.quantityDisposed.toString()).toBe('0.5');
      expect(disposals[1]!.totalProceeds.toString()).toBe('30000');
      expect(disposals[1]!.totalCostBasis.toString()).toBe('17500');
      expect(disposals[1]!.gainLoss.toString()).toBe('12500');
    }
  });

  it('should skip fully disposed lots', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: parseDecimal('0.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: parseDecimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('30000'),
        totalCostBasis: parseDecimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: parseDecimal('0'), // Fully disposed
        status: 'fully_disposed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('35000'),
        totalCostBasis: parseDecimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.lotId).toBe('lot2'); // Skipped lot1, used lot2
    }
  });

  it('should return error if insufficient lots', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: parseDecimal('2'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: parseDecimal('60000'),
    };

    const lots: AcquisitionLot[] = [
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('30000'),
        totalCostBasis: parseDecimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Insufficient acquisition lots');
    }
  });

  it('should sort lots by acquisition date even if provided out of order', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: parseDecimal('1.5'),
      date: new Date('2024-03-01'),
      proceedsPerUnit: parseDecimal('60000'),
    };

    // Lots provided in reverse chronological order
    const lots: AcquisitionLot[] = [
      {
        id: 'lot3',
        calculationId: 'calc1',
        acquisitionTransactionId: 3,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('40000'),
        totalCostBasis: parseDecimal('40000'),
        acquisitionDate: new Date('2024-02-01'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot2',
        calculationId: 'calc1',
        acquisitionTransactionId: 2,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('35000'),
        totalCostBasis: parseDecimal('35000'),
        acquisitionDate: new Date('2024-01-15'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'lot1',
        calculationId: 'calc1',
        acquisitionTransactionId: 1,
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('30000'),
        totalCostBasis: parseDecimal('30000'),
        acquisitionDate: new Date('2024-01-01'),
        method: 'fifo',
        remainingQuantity: parseDecimal('1'),
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      // Should still use oldest first
      expect(disposals[0]!.lotId).toBe('lot1'); // Jan 1
      expect(disposals[1]!.lotId).toBe('lot2'); // Jan 15
    }
  });
});
