import { type Currency, parseDecimal } from '@exitbook/foundation';
import { describe, expect, test } from 'vitest';

import { createAcquisitionLot } from '../lot.js';

describe('createAcquisitionLot', () => {
  test('should create a new acquisition lot with correct properties', () => {
    const params = {
      acquisitionTransactionId: 1,
      assetId: 'test:btc',
      assetSymbol: 'BTC' as Currency,
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
      assetSymbol: 'ETH' as Currency,
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
