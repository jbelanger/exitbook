import { parseDecimal, type UniversalTransactionData } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  applyTransactionFilters,
  formatTransactionForDisplay,
  type ViewTransactionsParams,
} from './transactions-view-utils.js';

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

      const result = applyTransactionFilters(transactions, params);

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 2]);
    });

    it('should return all transactions when until date is not provided', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({ id: 1, datetime: '2024-01-10T10:00:00Z' }),
        createTestTransaction({ id: 2, datetime: '2024-01-20T10:00:00Z' }),
      ];

      const params: ViewTransactionsParams = {};

      const result = applyTransactionFilters(transactions, params);

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

      const result = applyTransactionFilters(transactions, params);

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

      const result = applyTransactionFilters(transactions, params);

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

      const result = applyTransactionFilters(transactions, params);

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 2]);
    });

    it('should return all transactions when asset filter is not provided', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({ id: 1 }),
        createTestTransaction({ id: 2 }),
      ];

      const params: ViewTransactionsParams = {};

      const result = applyTransactionFilters(transactions, params);

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

      const result = applyTransactionFilters(transactions, params);

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 3]);
    });

    it('should return all transactions when operation type filter is not provided', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({ id: 1, operation: { category: 'trade', type: 'buy' } }),
        createTestTransaction({ id: 2, operation: { category: 'trade', type: 'sell' } }),
      ];

      const params: ViewTransactionsParams = {};

      const result = applyTransactionFilters(transactions, params);

      expect(result).toHaveLength(2);
    });
  });

  describe('no price filtering', () => {
    it('should filter out transactions with no inflows when noPrice is true', () => {
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
            inflows: [],
            outflows: [
              {
                assetSymbol: 'USD',
                grossAmount: parseDecimal('100.0'),
                assetId: '',
              },
            ],
          },
        }),
      ];

      const params: ViewTransactionsParams = {
        noPrice: true,
      };

      const result = applyTransactionFilters(transactions, params);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should filter out transactions with no outflows when noPrice is true', () => {
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
        noPrice: true,
      };

      const result = applyTransactionFilters(transactions, params);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should not filter when noPrice is false or undefined', () => {
      const transactions: UniversalTransactionData[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [],
            outflows: [
              {
                assetSymbol: 'USD',
                grossAmount: parseDecimal('100.0'),
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
                assetSymbol: 'BTC',
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
      ];

      const params: ViewTransactionsParams = {};

      const result = applyTransactionFilters(transactions, params);

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

      const result = applyTransactionFilters(transactions, params);

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 3]);
    });
  });
});

describe('formatTransactionForDisplay', () => {
  it('should format a basic transaction with inflow movement', () => {
    const tx = createTestTransaction({
      id: 123,
      externalId: 'tx-abc-123',
      source: 'kraken',
      datetime: '2024-01-15T10:30:00Z',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [
          {
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1.5'),
            assetId: '',
          },
        ],
        outflows: [],
      },
    });

    const result = formatTransactionForDisplay(tx);

    expect(result).toEqual({
      id: 123,
      external_id: 'tx-abc-123',
      source_name: 'kraken',
      source_type: 'exchange',
      transaction_datetime: '2024-01-15T10:30:00Z',
      operation_category: 'trade',
      operation_type: 'buy',
      movements_primary_asset: 'BTC',
      movements_primary_amount: '1.5',
      movements_primary_direction: 'in',
      from_address: undefined,
      to_address: undefined,
      blockchain_transaction_hash: undefined,
    });
  });

  it('should format a transaction with outflow movement', () => {
    const tx = createTestTransaction({
      id: 456,
      movements: {
        inflows: [],
        outflows: [
          {
            assetSymbol: 'USD',
            grossAmount: parseDecimal('50000.00'),
            assetId: '',
          },
        ],
      },
    });

    const result = formatTransactionForDisplay(tx);

    expect(result.movements_primary_asset).toBe('USD');
    expect(result.movements_primary_amount).toBe('50000');
    expect(result.movements_primary_direction).toBe('out');
  });

  it('should format a blockchain transaction with hash', () => {
    const tx = createTestTransaction({
      id: 789,
      source: 'bitcoin',
      blockchain: {
        name: 'bitcoin',
        transaction_hash: '0x1234567890abcdef',
        is_confirmed: true,
        block_height: 800000,
      },
      from: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    });

    const result = formatTransactionForDisplay(tx);

    expect(result.source_type).toBe('blockchain');
    expect(result.blockchain_transaction_hash).toBe('0x1234567890abcdef');
    expect(result.from_address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(result.to_address).toBe('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  });

  it('should format an exchange transaction', () => {
    const tx = createTestTransaction({
      id: 999,
      source: 'kraken',
      blockchain: undefined,
    });

    const result = formatTransactionForDisplay(tx);

    expect(result.source_type).toBe('exchange');
    expect(result.blockchain_transaction_hash).toBe(undefined);
  });

  it('should handle transactions with both inflows and outflows', () => {
    const tx = createTestTransaction({
      id: 111,
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
    });

    const result = formatTransactionForDisplay(tx);

    // Primary movement is determined by largest amount (USD 50000 > BTC 1.0)
    expect(result.movements_primary_asset).toBe('USD');
    expect(result.movements_primary_amount).toBe('50000');
    expect(result.movements_primary_direction).toBe('out');
  });

  it('should handle transactions with no movements', () => {
    const tx = createTestTransaction({
      id: 222,
      movements: {
        inflows: [],
        outflows: [],
      },
    });

    const result = formatTransactionForDisplay(tx);

    expect(result.movements_primary_asset).toBe(undefined);
    expect(result.movements_primary_amount).toBe(undefined);
    expect(result.movements_primary_direction).toBe(undefined);
  });

  it('should use toFixed() for decimal amounts to avoid scientific notation', () => {
    const tx = createTestTransaction({
      id: 333,
      movements: {
        inflows: [
          {
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.00000001'),
            assetId: '',
          },
        ],
        outflows: [],
      },
    });

    const result = formatTransactionForDisplay(tx);

    expect(result.movements_primary_amount).toBe('0.00000001');
    expect(result.movements_primary_amount).not.toContain('e');
  });

  it('should format operation category and type', () => {
    const tx = createTestTransaction({
      id: 444,
      operation: { category: 'staking', type: 'reward' },
    });

    const result = formatTransactionForDisplay(tx);

    expect(result.operation_category).toBe('staking');
    expect(result.operation_type).toBe('reward');
  });

  it('should handle transactions with from and to addresses', () => {
    const tx = createTestTransaction({
      id: 555,
      from: '0x1234567890abcdef1234567890abcdef12345678',
      to: '0xabcdef1234567890abcdef1234567890abcdef12',
    });

    const result = formatTransactionForDisplay(tx);

    expect(result.from_address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.to_address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });
});
