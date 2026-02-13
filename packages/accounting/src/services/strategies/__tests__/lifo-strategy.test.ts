import { parseDecimal } from '@exitbook/core';
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
        method: 'lifo',
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
      expect(disposals[0]!.gainLoss.toString()).toBe('20000'); // 50000 - 30000
    }
  });

  it('should match disposal to newest lot first (multiple lots)', () => {
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
        method: 'lifo',
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
        method: 'lifo',
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
      expect(disposals[0]!.lotId).toBe('lot2'); // Newest lot used first (LIFO)
      expect(disposals[0]!.quantityDisposed.toString()).toBe('0.5');
      expect(disposals[0]!.totalProceeds.toString()).toBe('30000'); // 0.5 * 60000
      expect(disposals[0]!.totalCostBasis.toString()).toBe('17500'); // 0.5 * 35000
      expect(disposals[0]!.gainLoss.toString()).toBe('12500');
    }
  });

  it('should match disposal across multiple lots (LIFO order)', () => {
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
        method: 'lifo',
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
        method: 'lifo',
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
        method: 'lifo',
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

      // First disposal: 1 BTC from lot3 (newest)
      expect(disposals[0]!.lotId).toBe('lot3');
      expect(disposals[0]!.quantityDisposed.toString()).toBe('1');
      expect(disposals[0]!.totalProceeds.toString()).toBe('60000');
      expect(disposals[0]!.totalCostBasis.toString()).toBe('40000');
      expect(disposals[0]!.gainLoss.toString()).toBe('20000');

      // Second disposal: 0.5 BTC from lot2 (second newest)
      expect(disposals[1]!.lotId).toBe('lot2');
      expect(disposals[1]!.quantityDisposed.toString()).toBe('0.5');
      expect(disposals[1]!.totalProceeds.toString()).toBe('30000');
      expect(disposals[1]!.totalCostBasis.toString()).toBe('17500');
      expect(disposals[1]!.gainLoss.toString()).toBe('12500');
    }
  });

  it('should demonstrate LIFO vs FIFO difference (higher cost basis with LIFO in rising market)', () => {
    const disposal = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: parseDecimal('1'),
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
        method: 'lifo',
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
        costBasisPerUnit: parseDecimal('50000'),
        totalCostBasis: parseDecimal('50000'),
        acquisitionDate: new Date('2024-02-01'),
        method: 'lifo',
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
      // LIFO uses newest lot with higher cost basis
      expect(disposals[0]!.lotId).toBe('lot2');
      expect(disposals[0]!.totalCostBasis.toString()).toBe('50000');
      expect(disposals[0]!.gainLoss.toString()).toBe('10000'); // Lower gain than FIFO (which would be 30000)
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

    // Lots provided in chronological order (oldest first)
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
        method: 'lifo',
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
        method: 'lifo',
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
        method: 'lifo',
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
      // Should still use newest first
      expect(disposals[0]!.lotId).toBe('lot3'); // Feb 1 (newest)
      expect(disposals[1]!.lotId).toBe('lot2'); // Jan 15 (second newest)
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
        method: 'lifo',
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
        method: 'lifo',
        remainingQuantity: parseDecimal('0'), // Fully disposed
        status: 'fully_disposed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = strategy.matchDisposal(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.lotId).toBe('lot1'); // Skipped lot2, used lot1
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
        method: 'lifo',
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
});
