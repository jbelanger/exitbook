import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { AcquisitionLot } from '../../domain/schemas.js';

import type { DisposalRequest } from './base-strategy.js';
import { calculateHoldingPeriodDays, matchDisposalToSortedLots, sortLotsFifo, sortLotsLifo } from './matching-utils.js';

describe('calculateHoldingPeriodDays', () => {
  it('should calculate days between same date as 0', () => {
    const date = new Date('2024-01-01');
    expect(calculateHoldingPeriodDays(date, date)).toBe(0);
  });

  it('should calculate days for 1 day difference', () => {
    const acquisition = new Date('2024-01-01');
    const disposal = new Date('2024-01-02');
    expect(calculateHoldingPeriodDays(acquisition, disposal)).toBe(1);
  });

  it('should calculate days for 31 days (one month)', () => {
    const acquisition = new Date('2024-01-01');
    const disposal = new Date('2024-02-01');
    expect(calculateHoldingPeriodDays(acquisition, disposal)).toBe(31);
  });

  it('should calculate days for 366 days (leap year)', () => {
    const acquisition = new Date('2024-01-01');
    const disposal = new Date('2025-01-01');
    expect(calculateHoldingPeriodDays(acquisition, disposal)).toBe(366); // 2024 is a leap year
  });

  it('should calculate days for 365 days (non-leap year)', () => {
    const acquisition = new Date('2023-01-01');
    const disposal = new Date('2024-01-01');
    expect(calculateHoldingPeriodDays(acquisition, disposal)).toBe(365);
  });

  it('should calculate days across different time zones', () => {
    const acquisition = new Date('2024-01-01T23:59:59Z');
    const disposal = new Date('2024-01-02T00:00:01Z');
    expect(calculateHoldingPeriodDays(acquisition, disposal)).toBe(0);
  });

  it('should calculate days with hours/minutes/seconds', () => {
    const acquisition = new Date('2024-01-01T10:30:45');
    const disposal = new Date('2024-01-05T15:45:30');
    expect(calculateHoldingPeriodDays(acquisition, disposal)).toBe(4);
  });

  it('should handle large time periods', () => {
    const acquisition = new Date('2020-01-01');
    const disposal = new Date('2024-01-01');
    // 4 years including 1 leap year (2020) = 1461 days
    expect(calculateHoldingPeriodDays(acquisition, disposal)).toBe(1461);
  });
});

describe('sortLotsFifo', () => {
  const createLot = (id: string, date: string): AcquisitionLot => ({
    id,
    calculationId: 'calc1',
    acquisitionTransactionId: 1,
    assetSymbol: 'BTC',
    quantity: parseDecimal('1'),
    costBasisPerUnit: parseDecimal('30000'),
    totalCostBasis: parseDecimal('30000'),
    acquisitionDate: new Date(date),
    method: 'fifo',
    remainingQuantity: parseDecimal('1'),
    status: 'open',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('should return empty array for empty input', () => {
    expect(sortLotsFifo([])).toEqual([]);
  });

  it('should return single lot unchanged', () => {
    const lot = createLot('lot1', '2024-01-01');
    const result = sortLotsFifo([lot]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('lot1');
  });

  it('should sort lots by acquisition date ascending (oldest first)', () => {
    const lots = [createLot('lot3', '2024-03-01'), createLot('lot1', '2024-01-01'), createLot('lot2', '2024-02-01')];

    const result = sortLotsFifo(lots);

    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe('lot1'); // Jan
    expect(result[1]!.id).toBe('lot2'); // Feb
    expect(result[2]!.id).toBe('lot3'); // Mar
  });

  it('should maintain stable sort for same dates', () => {
    const lots = [createLot('lot2', '2024-01-01'), createLot('lot1', '2024-01-01'), createLot('lot3', '2024-01-01')];

    const result = sortLotsFifo(lots);

    expect(result).toHaveLength(3);
    // Order should be preserved for same dates
    expect(result.map((l) => l.id)).toEqual(['lot2', 'lot1', 'lot3']);
  });

  it('should not mutate original array', () => {
    const lots = [createLot('lot2', '2024-02-01'), createLot('lot1', '2024-01-01')];

    const originalOrder = lots.map((l) => l.id);
    sortLotsFifo(lots);

    expect(lots.map((l) => l.id)).toEqual(originalOrder);
  });

  it('should handle lots with timestamps', () => {
    const lots = [
      createLot('lot2', '2024-01-01T12:00:00Z'),
      createLot('lot1', '2024-01-01T10:00:00Z'),
      createLot('lot3', '2024-01-01T14:00:00Z'),
    ];

    const result = sortLotsFifo(lots);

    expect(result[0]!.id).toBe('lot1'); // 10:00
    expect(result[1]!.id).toBe('lot2'); // 12:00
    expect(result[2]!.id).toBe('lot3'); // 14:00
  });
});

describe('sortLotsLifo', () => {
  const createLot = (id: string, date: string): AcquisitionLot => ({
    id,
    calculationId: 'calc1',
    acquisitionTransactionId: 1,
    assetSymbol: 'BTC',
    quantity: parseDecimal('1'),
    costBasisPerUnit: parseDecimal('30000'),
    totalCostBasis: parseDecimal('30000'),
    acquisitionDate: new Date(date),
    method: 'lifo',
    remainingQuantity: parseDecimal('1'),
    status: 'open',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('should return empty array for empty input', () => {
    expect(sortLotsLifo([])).toEqual([]);
  });

  it('should return single lot unchanged', () => {
    const lot = createLot('lot1', '2024-01-01');
    const result = sortLotsLifo([lot]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('lot1');
  });

  it('should sort lots by acquisition date descending (newest first)', () => {
    const lots = [createLot('lot1', '2024-01-01'), createLot('lot3', '2024-03-01'), createLot('lot2', '2024-02-01')];

    const result = sortLotsLifo(lots);

    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe('lot3'); // Mar
    expect(result[1]!.id).toBe('lot2'); // Feb
    expect(result[2]!.id).toBe('lot1'); // Jan
  });

  it('should maintain stable sort for same dates', () => {
    const lots = [createLot('lot2', '2024-01-01'), createLot('lot1', '2024-01-01'), createLot('lot3', '2024-01-01')];

    const result = sortLotsLifo(lots);

    expect(result).toHaveLength(3);
    // Order should be preserved for same dates
    expect(result.map((l) => l.id)).toEqual(['lot2', 'lot1', 'lot3']);
  });

  it('should not mutate original array', () => {
    const lots = [createLot('lot1', '2024-01-01'), createLot('lot2', '2024-02-01')];

    const originalOrder = lots.map((l) => l.id);
    sortLotsLifo(lots);

    expect(lots.map((l) => l.id)).toEqual(originalOrder);
  });

  it('should handle lots with timestamps', () => {
    const lots = [
      createLot('lot2', '2024-01-01T12:00:00Z'),
      createLot('lot1', '2024-01-01T10:00:00Z'),
      createLot('lot3', '2024-01-01T14:00:00Z'),
    ];

    const result = sortLotsLifo(lots);

    expect(result[0]!.id).toBe('lot3'); // 14:00 (newest)
    expect(result[1]!.id).toBe('lot2'); // 12:00
    expect(result[2]!.id).toBe('lot1'); // 10:00 (oldest)
  });
});

describe('matchDisposalToSortedLots', () => {
  const createLot = (id: string, date: string, quantity: string, remainingQuantity: string): AcquisitionLot => ({
    id,
    calculationId: 'calc1',
    acquisitionTransactionId: 1,
    assetSymbol: 'BTC',
    quantity: new Decimal(quantity),
    costBasisPerUnit: parseDecimal('30000'),
    totalCostBasis: parseDecimal('30000'),
    acquisitionDate: new Date(date),
    method: 'fifo',
    remainingQuantity: new Decimal(remainingQuantity),
    status: 'open',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const createDisposal = (quantity: string, date = '2024-02-01'): DisposalRequest => ({
    transactionId: 100,
    assetSymbol: 'BTC',
    quantity: new Decimal(quantity),
    date: new Date(date),
    proceedsPerUnit: parseDecimal('50000'),
  });

  it('should match full disposal to single lot', () => {
    const disposal = createDisposal('1');
    const lots = [createLot('lot1', '2024-01-01', '1', '1')];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.lotId).toBe('lot1');
      expect(disposals[0]!.disposalTransactionId).toBe(100);
      expect(disposals[0]!.quantityDisposed.toString()).toBe('1');
      expect(disposals[0]!.proceedsPerUnit.toString()).toBe('50000');
      expect(disposals[0]!.totalProceeds.toString()).toBe('50000');
      expect(disposals[0]!.costBasisPerUnit.toString()).toBe('30000');
      expect(disposals[0]!.totalCostBasis.toString()).toBe('30000');
      expect(disposals[0]!.gainLoss.toString()).toBe('20000');
      expect(disposals[0]!.holdingPeriodDays).toBe(31);
      expect(disposals[0]!.taxTreatmentCategory).toBeUndefined();
    }
  });

  it('should match partial disposal to single lot', () => {
    const disposal = createDisposal('0.5');
    const lots = [createLot('lot1', '2024-01-01', '1', '1')];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantityDisposed.toString()).toBe('0.5');
      expect(disposals[0]!.totalProceeds.toString()).toBe('25000'); // 0.5 * 50000
      expect(disposals[0]!.totalCostBasis.toString()).toBe('15000'); // 0.5 * 30000
      expect(disposals[0]!.gainLoss.toString()).toBe('10000');
    }
  });

  it('should match disposal across multiple lots', () => {
    const disposal = createDisposal('1.5');
    const lots = [createLot('lot1', '2024-01-01', '1', '1'), createLot('lot2', '2024-01-15', '1', '1')];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(2);

      // First lot: 1 BTC
      expect(disposals[0]!.lotId).toBe('lot1');
      expect(disposals[0]!.quantityDisposed.toString()).toBe('1');
      expect(disposals[0]!.totalProceeds.toString()).toBe('50000');

      // Second lot: 0.5 BTC
      expect(disposals[1]!.lotId).toBe('lot2');
      expect(disposals[1]!.quantityDisposed.toString()).toBe('0.5');
      expect(disposals[1]!.totalProceeds.toString()).toBe('25000');
    }
  });

  it('should skip fully disposed lots', () => {
    const disposal = createDisposal('0.5');
    const lots = [
      createLot('lot1', '2024-01-01', '1', '0'), // Fully disposed
      createLot('lot2', '2024-01-15', '1', '1'),
    ];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.lotId).toBe('lot2'); // Skipped lot1
    }
  });

  it('should match disposal to partially remaining lots', () => {
    const disposal = createDisposal('0.3');
    const lots = [createLot('lot1', '2024-01-01', '1', '0.5')]; // 0.5 remaining

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantityDisposed.toString()).toBe('0.3');
      expect(disposals[0]!.totalProceeds.toString()).toBe('15000');
    }
  });

  it('should throw error if insufficient lots', () => {
    const disposal = createDisposal('2');
    const lots = [createLot('lot1', '2024-01-01', '1', '1')];

    const result = matchDisposalToSortedLots(disposal, lots);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toMatch(/Insufficient acquisition lots/);
      expect(result.error.message).toMatch(/Asset: BTC/);
      expect(result.error.message).toMatch(/Disposal quantity: 2/);
      expect(result.error.message).toMatch(/Unmatched quantity: 1/);
    }
  });

  it('should throw error if all lots are fully disposed', () => {
    const disposal = createDisposal('0.5');
    const lots = [createLot('lot1', '2024-01-01', '1', '0'), createLot('lot2', '2024-01-15', '1', '0')];

    const result = matchDisposalToSortedLots(disposal, lots);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toMatch(/Insufficient acquisition lots/);
    }
  });

  it('should handle very small quantities', () => {
    const disposal = createDisposal('0.00000001');
    const lots = [createLot('lot1', '2024-01-01', '1', '1')];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantityDisposed.toFixed()).toBe('0.00000001');
    }
  });

  it('should handle very large quantities', () => {
    const disposal = createDisposal('1000000');
    const lots = [createLot('lot1', '2024-01-01', '1000000', '1000000')];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantityDisposed.toString()).toBe('1000000');
    }
  });

  it('should calculate correct holding periods for multiple lots', () => {
    const disposal = createDisposal('1.5', '2024-03-01');
    const lots = [
      createLot('lot1', '2024-01-01', '1', '1'), // 60 days
      createLot('lot2', '2024-02-15', '1', '1'), // 15 days
    ];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals[0]!.holdingPeriodDays).toBe(60); // Jan 1 to Mar 1
      expect(disposals[1]!.holdingPeriodDays).toBe(15); // Feb 15 to Mar 1
    }
  });

  it('should match exact remaining quantity', () => {
    const disposal = createDisposal('0.75');
    const lots = [createLot('lot1', '2024-01-01', '1', '0.75')]; // Exact match

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantityDisposed.toString()).toBe('0.75');
    }
  });

  it('should use minimum of remaining quantity and disposal quantity', () => {
    const disposal = createDisposal('0.3');
    const lots = [createLot('lot1', '2024-01-01', '1', '0.5')]; // More than disposal

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(1);
      expect(disposals[0]!.quantityDisposed.toString()).toBe('0.3'); // Used disposal quantity, not lot's full remaining
    }
  });

  it('should handle complex multi-lot scenario', () => {
    const disposal = createDisposal('2.7');
    const lots = [
      createLot('lot1', '2024-01-01', '1', '1'),
      createLot('lot2', '2024-01-15', '1', '0'), // Fully disposed
      createLot('lot3', '2024-02-01', '1', '0.5'), // Partially disposed
      createLot('lot4', '2024-02-15', '2', '2'),
    ];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals).toHaveLength(3);
      expect(disposals[0]!.lotId).toBe('lot1');
      expect(disposals[0]!.quantityDisposed.toString()).toBe('1');
      expect(disposals[1]!.lotId).toBe('lot3');
      expect(disposals[1]!.quantityDisposed.toString()).toBe('0.5');
      expect(disposals[2]!.lotId).toBe('lot4');
      expect(disposals[2]!.quantityDisposed.toString()).toBe('1.2');
    }
  });

  it('should include all required fields in lot disposal', () => {
    const disposal = createDisposal('0.5');
    const lots = [createLot('lot1', '2024-01-01', '1', '1')];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      const lotDisposal = disposals[0]!;
      expect(lotDisposal.id).toBeTruthy(); // UUID
      expect(lotDisposal.lotId).toBe('lot1');
      expect(lotDisposal.disposalTransactionId).toBe(100);
      expect(lotDisposal.quantityDisposed).toBeInstanceOf(Decimal);
      expect(lotDisposal.proceedsPerUnit).toBeInstanceOf(Decimal);
      expect(lotDisposal.totalProceeds).toBeInstanceOf(Decimal);
      expect(lotDisposal.costBasisPerUnit).toBeInstanceOf(Decimal);
      expect(lotDisposal.totalCostBasis).toBeInstanceOf(Decimal);
      expect(lotDisposal.gainLoss).toBeInstanceOf(Decimal);
      expect(lotDisposal.disposalDate).toBeInstanceOf(Date);
      expect(typeof lotDisposal.holdingPeriodDays).toBe('number');
      expect(lotDisposal.taxTreatmentCategory).toBeUndefined();
      expect(lotDisposal.createdAt).toBeInstanceOf(Date);
      expect(lotDisposal.metadata).toBeUndefined();
    }
  });

  it('should calculate negative gain/loss when disposal at a loss', () => {
    const disposal: DisposalRequest = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: parseDecimal('1'),
      date: new Date('2024-02-01'),
      proceedsPerUnit: parseDecimal('20000'), // Less than cost basis
    };
    const lots = [createLot('lot1', '2024-01-01', '1', '1')];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals[0]!.gainLoss.toString()).toBe('-10000'); // 20000 - 30000
    }
  });

  it('should handle zero proceeds', () => {
    const disposal: DisposalRequest = {
      transactionId: 100,
      assetSymbol: 'BTC',
      quantity: parseDecimal('1'),
      date: new Date('2024-02-01'),
      proceedsPerUnit: parseDecimal('0'),
    };
    const lots = [createLot('lot1', '2024-01-01', '1', '1')];

    const result = matchDisposalToSortedLots(disposal, lots);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposals = result.value;
      expect(disposals[0]!.totalProceeds.toString()).toBe('0');
      expect(disposals[0]!.gainLoss.toString()).toBe('-30000'); // 0 - 30000
    }
  });
});
