import { ok, type Result } from '@exitbook/core';
import type { UniversalTransactionData } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { createMovement, createTransaction, createTransactionFromMovements } from '../../__tests__/test-utils.js';
import type { IPriceCoverageData } from '../../ports/transaction-price-coverage.js';
import { checkTransactionPriceCoverage } from '../transaction-price-coverage-utils.js';

function stubData(transactions: UniversalTransactionData[]): IPriceCoverageData {
  return {
    loadTransactions: () => Promise.resolve(ok(transactions) as Result<UniversalTransactionData[], Error>),
  };
}

const dateRange = {
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-12-31'),
};

describe('checkTransactionPriceCoverage', () => {
  it('returns complete when no transactions exist', async () => {
    const result = assertOk(await checkTransactionPriceCoverage(stubData([]), dateRange));

    expect(result.complete).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns complete when no transactions fall in date range', async () => {
    const tx = createTransaction(1, '2024-06-15T00:00:00.000Z', [
      { assetSymbol: 'BTC', amount: '1.0', price: '50000' },
    ]);

    const result = assertOk(await checkTransactionPriceCoverage(stubData([tx]), dateRange));

    expect(result.complete).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns complete when all transactions have prices', async () => {
    const tx = createTransaction(1, '2025-06-15T00:00:00.000Z', [
      { assetSymbol: 'BTC', amount: '1.0', price: '50000' },
    ]);

    const result = assertOk(await checkTransactionPriceCoverage(stubData([tx]), dateRange));

    expect(result.complete).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns incomplete when a transaction is missing prices', async () => {
    const tx = createTransactionFromMovements(1, '2025-06-15T00:00:00.000Z', {
      inflows: [createMovement('BTC', '1.0')],
    });

    const result = assertOk(await checkTransactionPriceCoverage(stubData([tx]), dateRange));

    expect(result.complete).toBe(false);
    expect(result.reason).toBe('1 of 1 transactions missing prices');
  });

  it('counts multiple transactions missing prices', async () => {
    const tx1 = createTransactionFromMovements(1, '2025-03-01T00:00:00.000Z', {
      inflows: [createMovement('BTC', '1.0')],
    });
    const tx2 = createTransactionFromMovements(2, '2025-06-01T00:00:00.000Z', {
      outflows: [createMovement('ETH', '10.0')],
    });
    const tx3 = createTransaction(3, '2025-09-01T00:00:00.000Z', [
      { assetSymbol: 'BTC', amount: '0.5', price: '60000' },
    ]);

    const result = assertOk(await checkTransactionPriceCoverage(stubData([tx1, tx2, tx3]), dateRange));

    expect(result.complete).toBe(false);
    expect(result.reason).toBe('2 of 3 transactions missing prices');
  });

  it('only considers transactions within the date range', async () => {
    const outsideRange = createTransactionFromMovements(1, '2024-06-15T00:00:00.000Z', {
      inflows: [createMovement('BTC', '1.0')],
    });
    const insideRange = createTransaction(2, '2025-06-15T00:00:00.000Z', [
      { assetSymbol: 'ETH', amount: '5.0', price: '3000' },
    ]);

    const result = assertOk(await checkTransactionPriceCoverage(stubData([outsideRange, insideRange]), dateRange));

    expect(result.complete).toBe(true);
  });
});
