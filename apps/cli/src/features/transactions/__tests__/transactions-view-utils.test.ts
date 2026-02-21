import { type Currency, parseDecimal, type UniversalTransactionData } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { applyTransactionFilters, type ViewTransactionsParams } from '../transactions-view-utils.js';

// Test data helper
function createTestTransaction(overrides: Partial<UniversalTransactionData> = {}): UniversalTransactionData {
  return {
    id: 1,
    accountId: 1,
    externalId: 'tx-123',
    datetime: '2024-01-15T10:30:00Z',
    timestamp: 1705318200,
    source: 'kraken',
    sourceType: 'exchange',
    status: 'success',
    from: undefined,
    to: undefined,
    movements: {
      inflows: [],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'trade',
      type: 'buy',
    },
    blockchain: undefined,
    notes: undefined,
    excludedFromAccounting: false,
    ...overrides,
  };
}

function unwrapOk<T>(result: Result<T, Error>): T {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

describe('applyTransactionFilters', () => {
  describe('date filtering', () => {
    it('should filter transactions by until date', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({ id: 1, datetime: '2024-01-10T10:00:00Z' }),
        createTestTransaction({ id: 2, datetime: '2024-01-15T10:00:00Z' }),
        createTestTransaction({ id: 3, datetime: '2024-01-20T10:00:00Z' }),
      ];

      const params: ViewTransactionsParams = {
        until: '2024-01-15T23:59:59Z',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 2]);
    });

    it('should return all transactions when until date is not provided', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({ id: 1, datetime: '2024-01-10T10:00:00Z' }),
        createTestTransaction({ id: 2, datetime: '2024-01-20T10:00:00Z' }),
      ];

      const params: ViewTransactionsParams = {};

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
    });
  });

  describe('asset filtering', () => {
    it('should filter transactions by asset in inflows', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
        createTestTransaction({
          id: 2,
          movements: {
            inflows: [
              {
                assetSymbol: 'ETH',
                grossAmount: parseDecimal('10.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
        createTestTransaction({
          id: 3,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('0.5'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
      ];

      const params: ViewTransactionsParams = {
        assetSymbol: 'BTC',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 3]);
    });

    it('should filter transactions by asset in outflows', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [],
            outflows: [
              {
                assetSymbol: 'USD',
                grossAmount: parseDecimal('1000.0'),
                assetId: '',
              },
            ],
          },
        }),
        createTestTransaction({
          id: 2,
          movements: {
            inflows: [],
            outflows: [
              {
                assetSymbol: 'EUR',
                grossAmount: parseDecimal('900.0'),
                assetId: '',
              },
            ],
          },
        }),
      ];

      const params: ViewTransactionsParams = {
        assetSymbol: 'USD',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should match transactions with asset in either inflows or outflows', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'USD',
                grossAmount: parseDecimal('50000.0'),
                assetId: '',
              },
            ],
          },
        }),
        createTestTransaction({
          id: 2,
          movements: {
            inflows: [
              {
                assetSymbol: 'ETH',
                grossAmount: parseDecimal('10.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('0.5'),
                assetId: '',
              },
            ],
          },
        }),
      ];

      const params: ViewTransactionsParams = {
        assetSymbol: 'BTC',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 2]);
    });

    it('should return all transactions when asset filter is not provided', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({ id: 1 }),
        createTestTransaction({ id: 2 }),
      ];

      const params: ViewTransactionsParams = {};

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
    });
  });

  describe('operation type filtering', () => {
    it('should filter transactions by operation type', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({ id: 1, operation: { category: 'trade', type: 'buy' } }),
        createTestTransaction({ id: 2, operation: { category: 'trade', type: 'sell' } }),
        createTestTransaction({ id: 3, operation: { category: 'trade', type: 'buy' } }),
      ];

      const params: ViewTransactionsParams = {
        operationType: 'buy',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 3]);
    });

    it('should return all transactions when operation type filter is not provided', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({ id: 1, operation: { category: 'trade', type: 'buy' } }),
        createTestTransaction({ id: 2, operation: { category: 'trade', type: 'sell' } }),
      ];

      const params: ViewTransactionsParams = {};

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
    });
  });

  describe('no price filtering', () => {
    it('should keep transactions with missing prices when noPrice is true', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
        createTestTransaction({
          id: 2,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('0.5'),
                assetId: '',
                priceAtTxTime: {
                  price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
                  source: 'kraken',
                  fetchedAt: new Date(),
                },
              },
            ],
            outflows: [],
          },
        }),
      ];

      const params: ViewTransactionsParams = {
        noPrice: true,
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      // Only tx 1 has missing prices (BTC with no priceAtTxTime)
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should exclude fiat-only transactions (price not needed)', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'USD',
                grossAmount: parseDecimal('100.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
        createTestTransaction({
          id: 2,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
      ];

      const params: ViewTransactionsParams = {
        noPrice: true,
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      // Only tx 2 — tx 1 is fiat-only (not-needed), not "missing"
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(2);
    });

    it('should not filter when noPrice is false or undefined', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
        createTestTransaction({
          id: 2,
          movements: {
            inflows: [
              {
                assetSymbol: 'ETH',
                grossAmount: parseDecimal('5.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
      ];

      const params: ViewTransactionsParams = {};

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
    });
  });

  describe('combined filters', () => {
    it('should apply multiple filters together', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({
          id: 1,
          datetime: '2024-01-10T10:00:00Z',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'USD',
                grossAmount: parseDecimal('50000.0'),
                assetId: '',
              },
            ],
          },
        }),
        createTestTransaction({
          id: 2,
          datetime: '2024-01-12T10:00:00Z',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetSymbol: 'ETH',
                grossAmount: parseDecimal('10.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'USD',
                grossAmount: parseDecimal('30000.0'),
                assetId: '',
              },
            ],
          },
        }),
        createTestTransaction({
          id: 3,
          datetime: '2024-01-15T10:00:00Z',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('0.5'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'USD',
                grossAmount: parseDecimal('25000.0'),
                assetId: '',
              },
            ],
          },
        }),
        createTestTransaction({
          id: 4,
          datetime: '2024-01-20T10:00:00Z',
          operation: { category: 'trade', type: 'sell' },
          movements: {
            inflows: [
              {
                assetSymbol: 'USD',
                grossAmount: parseDecimal('55000.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
          },
        }),
      ];

      const params: ViewTransactionsParams = {
        until: '2024-01-15T23:59:59Z',
        assetSymbol: 'BTC',
        operationType: 'buy',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 3]);
    });
  });
});
