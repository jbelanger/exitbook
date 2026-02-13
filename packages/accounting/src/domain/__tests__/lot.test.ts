import { parseDecimal } from '@exitbook/core';
import { describe, expect, test } from 'vitest';

import { createLot } from '../../../__tests__/test-utils.js';
import { createAcquisitionLot, disposeLot, updateLotStatus } from '../lot.js';

describe('createAcquisitionLot', () => {
  test('should create a new acquisition lot with correct properties', () => {
    const params = {
      acquisitionTransactionId: 1,
      assetId: 'test:btc',
      assetSymbol: 'BTC',
      calculationId: 'calc-123',
      costBasisPerUnit: parseDecimal('50000'),
      id: 'lot-123',
      method: 'fifo' as const,
      quantity: parseDecimal('2'),
      transactionDate: new Date('2024-01-01T00:00:00Z'),
    };

    const lot = createAcquisitionLot(params);

    expect(lot.id).toBe('lot-123');
    expect(lot.calculationId).toBe('calc-123');
    expect(lot.acquisitionTransactionId).toBe(1);
    expect(lot.assetSymbol).toBe('BTC');
    expect(lot.quantity.toString()).toBe('2');
    expect(lot.costBasisPerUnit.toString()).toBe('50000');
    expect(lot.totalCostBasis.toString()).toBe('100000');
    expect(lot.acquisitionDate).toEqual(new Date('2024-01-01T00:00:00Z'));
    expect(lot.method).toBe('fifo');
    expect(lot.remainingQuantity.toString()).toBe('2');
    expect(lot.status).toBe('open');
  });

  test('should calculate total cost basis correctly', () => {
    const lot = createAcquisitionLot({
      acquisitionTransactionId: 1,
      assetId: 'test:eth',
      assetSymbol: 'ETH',
      calculationId: 'calc-123',
      costBasisPerUnit: parseDecimal('3000.50'),
      id: 'lot-123',
      method: 'fifo',
      quantity: parseDecimal('10.5'),
      transactionDate: new Date('2024-01-01'),
    });

    expect(lot.totalCostBasis.toString()).toBe('31505.25');
  });
});

describe('updateLotStatus', () => {
  test('should return "open" when remaining quantity equals original quantity', () => {
    const lot = createLot('lot-123', 'BTC', '2', '50000', new Date('2024-01-01'), {
      calculationId: 'calc-123',
    });

    expect(updateLotStatus(lot)).toBe('open');
  });

  test('should return "partially_disposed" when remaining quantity is less than original but not zero', () => {
    const lot = createLot('lot-123', 'BTC', '2', '50000', new Date('2024-01-01'), {
      calculationId: 'calc-123',
      remainingQuantity: '0.5',
    });

    expect(updateLotStatus(lot)).toBe('partially_disposed');
  });

  test('should return "fully_disposed" when remaining quantity is zero', () => {
    const lot = createLot('lot-123', 'BTC', '2', '50000', new Date('2024-01-01'), {
      calculationId: 'calc-123',
      remainingQuantity: '0',
      status: 'fully_disposed',
    });

    expect(updateLotStatus(lot)).toBe('fully_disposed');
  });
});

describe('disposeLot', () => {
  test('should reduce remaining quantity and update status to partially_disposed', () => {
    const lot = createLot('lot-123', 'BTC', '2', '50000', new Date('2024-01-01'), {
      calculationId: 'calc-123',
    });

    const result = disposeLot(lot, parseDecimal('1'));

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposedLot = result.value;
      expect(disposedLot.remainingQuantity.toString()).toBe('1');
      expect(disposedLot.status).toBe('partially_disposed');
      expect(disposedLot.updatedAt).toBeInstanceOf(Date);
    }
  });

  test('should update status to fully_disposed when all quantity is disposed', () => {
    const lot = createLot('lot-123', 'BTC', '2', '50000', new Date('2024-01-01'), {
      calculationId: 'calc-123',
    });

    const result = disposeLot(lot, parseDecimal('2'));

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const disposedLot = result.value;
      expect(disposedLot.remainingQuantity.toString()).toBe('0');
      expect(disposedLot.status).toBe('fully_disposed');
    }
  });

  test('should return error when trying to dispose more than remaining quantity', () => {
    const lot = createLot('lot-123', 'BTC', '2', '50000', new Date('2024-01-01'), {
      calculationId: 'calc-123',
      remainingQuantity: '1',
      status: 'partially_disposed',
    });

    const result = disposeLot(lot, parseDecimal('1.5'));

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Cannot dispose 1.5 from lot lot-123');
      expect(result.error.message).toContain('with only 1 remaining');
    }
  });

  test('should handle decimal precision correctly', () => {
    const lot = createLot('lot-123', 'BTC', '0.123456789', '50000', new Date('2024-01-01'), {
      calculationId: 'calc-123',
    });

    const result = disposeLot(lot, parseDecimal('0.023456789'));

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.remainingQuantity.toString()).toBe('0.1');
    }
  });
});
