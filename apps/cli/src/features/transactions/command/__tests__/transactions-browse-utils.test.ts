import type { Transaction, TransactionDraft } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import {
  applyTransactionFilters,
  buildTransactionsJsonFilters,
  buildTransactionsViewFilters,
  type TransactionsBrowseFilters,
} from '../transactions-browse-utils.js';

// Test data helper
function createTestTransaction(
  overrides: Omit<Partial<Transaction>, 'movements' | 'fees'> & {
    fees?: TransactionDraft['fees'];
    movements?: TransactionDraft['movements'];
  } = {}
): Transaction {
  return createPersistedTransaction({
    id: 1,
    accountId: 1,
    txFingerprint: String(overrides.txFingerprint ?? 'tx-123'),
    datetime: '2024-01-15T10:30:00Z',
    timestamp: 1705318200,
    platformKey: 'kraken',
    platformKind: 'exchange',
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
    diagnostics: undefined,
    userNotes: undefined,
    excludedFromAccounting: false,
    ...overrides,
  });
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
      const transactions: Transaction[] = [
        createTestTransaction({ id: 1, datetime: '2024-01-10T10:00:00Z' }),
        createTestTransaction({ id: 2, datetime: '2024-01-15T10:00:00Z' }),
        createTestTransaction({ id: 3, datetime: '2024-01-20T10:00:00Z' }),
      ];

      const params: TransactionsBrowseFilters = {
        until: '2024-01-15T23:59:59Z',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 2]);
    });

    it('should return all transactions when until date is not provided', () => {
      const transactions: Transaction[] = [
        createTestTransaction({ id: 1, datetime: '2024-01-10T10:00:00Z' }),
        createTestTransaction({ id: 2, datetime: '2024-01-20T10:00:00Z' }),
      ];

      const params: TransactionsBrowseFilters = {};

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
    });
  });

  describe('asset filtering', () => {
    it('should filter transactions by exact asset ID across movements and fees', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetId: 'blockchain:arbitrum:usdt-a',
                assetSymbol: 'USDT' as Currency,
                grossAmount: parseDecimal('1.0'),
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
                assetId: 'blockchain:arbitrum:usdt-b',
                assetSymbol: 'USDT' as Currency,
                grossAmount: parseDecimal('2.0'),
              },
            ],
            outflows: [],
          },
        }),
        createTestTransaction({
          id: 3,
          movements: {
            inflows: [],
            outflows: [],
          },
          fees: [
            {
              assetId: 'blockchain:arbitrum:usdt-a',
              assetSymbol: 'USDT' as Currency,
              amount: parseDecimal('0.1'),
              scope: 'platform',
              settlement: 'balance',
            },
          ],
        }),
      ];

      const result = unwrapOk(
        applyTransactionFilters(transactions, {
          assetId: 'blockchain:arbitrum:usdt-a',
        })
      );

      expect(result.map((tx) => tx.id)).toEqual([1, 3]);
    });

    it('should filter transactions by asset in inflows', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
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
                assetSymbol: 'ETH' as Currency,
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
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('0.5'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
      ];

      const params: TransactionsBrowseFilters = {
        assetSymbol: 'BTC',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 3]);
    });

    it('should filter transactions by asset in outflows', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [],
            outflows: [
              {
                assetSymbol: 'USD' as Currency,
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
                assetSymbol: 'EUR' as Currency,
                grossAmount: parseDecimal('900.0'),
                assetId: '',
              },
            ],
          },
        }),
      ];

      const params: TransactionsBrowseFilters = {
        assetSymbol: 'USD',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should match transactions with asset in either inflows or outflows', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'USD' as Currency,
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
                assetSymbol: 'ETH' as Currency,
                grossAmount: parseDecimal('10.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('0.5'),
                assetId: '',
              },
            ],
          },
        }),
      ];

      const params: TransactionsBrowseFilters = {
        assetSymbol: 'BTC',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 2]);
    });

    it('should include fee-only matches when filtering by asset symbol', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [],
            outflows: [],
          },
          fees: [
            {
              assetId: 'blockchain:ethereum:native',
              assetSymbol: 'ETH' as Currency,
              amount: parseDecimal('0.001'),
              scope: 'network',
              settlement: 'balance',
            },
          ],
        }),
        createTestTransaction({
          id: 2,
          movements: {
            inflows: [
              {
                assetId: 'blockchain:bitcoin:native',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
              },
            ],
            outflows: [],
          },
        }),
      ];

      const result = unwrapOk(
        applyTransactionFilters(transactions, {
          assetSymbol: 'ETH',
        })
      );

      expect(result.map((tx) => tx.id)).toEqual([1]);
    });

    it('should return all transactions when asset filter is not provided', () => {
      const transactions: Transaction[] = [createTestTransaction({ id: 1 }), createTestTransaction({ id: 2 })];

      const params: TransactionsBrowseFilters = {};

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
    });
  });

  describe('endpoint filtering', () => {
    it('filters transactions by address across either endpoint', () => {
      const transactions: Transaction[] = [
        createTestTransaction({ id: 1, from: '0xsource-1', to: '0xtarget-1' }),
        createTestTransaction({ id: 2, from: '0xsource-2', to: '0xtarget-2' }),
        createTestTransaction({ id: 3, from: '0xsource-3', to: '0xsource-1' }),
      ];

      const result = unwrapOk(
        applyTransactionFilters(transactions, {
          address: '0xsource-1',
        })
      );

      expect(result.map((tx) => tx.id)).toEqual([1, 3]);
    });

    it('filters transactions by exact from endpoint', () => {
      const transactions: Transaction[] = [
        createTestTransaction({ id: 1, from: '0xsource-1', to: '0xtarget-1' }),
        createTestTransaction({ id: 2, from: '0xsource-2', to: '0xtarget-1' }),
      ];

      const result = unwrapOk(
        applyTransactionFilters(transactions, {
          from: '0xsource-2',
        })
      );

      expect(result.map((tx) => tx.id)).toEqual([2]);
    });

    it('filters transactions by exact to endpoint', () => {
      const transactions: Transaction[] = [
        createTestTransaction({ id: 1, from: '0xsource-1', to: '0xtarget-1' }),
        createTestTransaction({ id: 2, from: '0xsource-1', to: '0xtarget-2' }),
      ];

      const result = unwrapOk(
        applyTransactionFilters(transactions, {
          to: '0xtarget-2',
        })
      );

      expect(result.map((tx) => tx.id)).toEqual([2]);
    });

    it('matches EVM endpoints case-insensitively', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          from: '0xBA7DD2a5726a5A94b3556537E7212277e0E76CBf',
          to: '0x15A2AA147781B08A0105D678386EA63E6CA06281',
        }),
      ];

      expect(
        unwrapOk(
          applyTransactionFilters(transactions, {
            address: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
          })
        ).map((tx) => tx.id)
      ).toEqual([1]);
      expect(
        unwrapOk(
          applyTransactionFilters(transactions, {
            from: '0xba7dd2a5726a5a94b3556537e7212277e0e76cbf',
          })
        ).map((tx) => tx.id)
      ).toEqual([1]);
      expect(
        unwrapOk(
          applyTransactionFilters(transactions, {
            to: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
          })
        ).map((tx) => tx.id)
      ).toEqual([1]);
    });
  });

  describe('operation type filtering handoff', () => {
    it('does not filter by operation type before interpretation is loaded', () => {
      const transactions: Transaction[] = [
        createTestTransaction({ id: 1, operation: { category: 'trade', type: 'buy' } }),
        createTestTransaction({ id: 2, operation: { category: 'trade', type: 'sell' } }),
        createTestTransaction({ id: 3, operation: { category: 'trade', type: 'buy' } }),
      ];

      const params: TransactionsBrowseFilters = {
        operationFilter: 'buy',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(3);
      expect(result.map((tx) => tx.id)).toEqual([1, 2, 3]);
    });

    it('returns all transactions when operation type filter is not provided', () => {
      const transactions: Transaction[] = [
        createTestTransaction({ id: 1, operation: { category: 'trade', type: 'buy' } }),
        createTestTransaction({ id: 2, operation: { category: 'trade', type: 'sell' } }),
      ];

      const params: TransactionsBrowseFilters = {};

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
    });
  });

  describe('no price filtering', () => {
    it('should keep transactions with missing prices when noPrice is true', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
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
                assetSymbol: 'BTC' as Currency,
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

      const params: TransactionsBrowseFilters = {
        noPrice: true,
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      // Only tx 1 has missing prices (BTC with no priceAtTxTime)
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should exclude fiat-only transactions (price not needed)', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'USD' as Currency,
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
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
      ];

      const params: TransactionsBrowseFilters = {
        noPrice: true,
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      // Only tx 2 — tx 1 is fiat-only (not-needed), not "missing"
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(2);
    });

    it('should not filter when noPrice is false or undefined', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
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
                assetSymbol: 'ETH' as Currency,
                grossAmount: parseDecimal('5.0'),
                assetId: '',
              },
            ],
            outflows: [],
          },
        }),
      ];

      const params: TransactionsBrowseFilters = {};

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
    });
  });

  describe('combined filters', () => {
    it('should apply multiple filters together', () => {
      const transactions: Transaction[] = [
        createTestTransaction({
          id: 1,
          datetime: '2024-01-10T10:00:00Z',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              {
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'USD' as Currency,
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
                assetSymbol: 'ETH' as Currency,
                grossAmount: parseDecimal('10.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'USD' as Currency,
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
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('0.5'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'USD' as Currency,
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
                assetSymbol: 'USD' as Currency,
                grossAmount: parseDecimal('55000.0'),
                assetId: '',
              },
            ],
            outflows: [
              {
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1.0'),
                assetId: '',
              },
            ],
          },
        }),
      ];

      const params: TransactionsBrowseFilters = {
        until: '2024-01-15T23:59:59Z',
        assetSymbol: 'BTC',
        operationFilter: 'buy',
      };

      const result = unwrapOk(applyTransactionFilters(transactions, params));

      expect(result).toHaveLength(2);
      expect(result.map((tx) => tx.id)).toEqual([1, 3]);
    });
  });
});

describe('transaction browse filter metadata', () => {
  it('includes the account selector in view and JSON filter metadata', () => {
    const params: TransactionsBrowseFilters = {
      account: 'wallet-main',
      annotationKind: 'bridge_participant',
      annotationTier: 'heuristic',
      platform: 'bitcoin',
      assetSymbol: 'BTC',
      noPrice: true,
      since: '2024-01-01',
    };

    expect(buildTransactionsViewFilters(params)).toEqual({
      accountFilter: 'wallet-main',
      annotationKindFilter: 'bridge_participant',
      annotationTierFilter: 'heuristic',
      platformFilter: 'bitcoin',
      assetFilter: 'BTC',
      assetIdFilter: undefined,
      addressFilter: undefined,
      fromFilter: undefined,
      toFilter: undefined,
      operationFilter: undefined,
      noPriceFilter: true,
    });
    expect(buildTransactionsJsonFilters(params)).toEqual({
      account: 'wallet-main',
      annotationKind: 'bridge_participant',
      annotationTier: 'heuristic',
      platform: 'bitcoin',
      asset: 'BTC',
      since: '2024-01-01',
      noPrice: true,
    });
  });

  it('includes endpoint filters in view and JSON filter metadata', () => {
    const params: TransactionsBrowseFilters = {
      address: '0xabc',
      from: undefined,
      to: '0xdef',
    };

    expect(buildTransactionsViewFilters(params)).toEqual({
      accountFilter: undefined,
      annotationKindFilter: undefined,
      annotationTierFilter: undefined,
      platformFilter: undefined,
      assetFilter: undefined,
      assetIdFilter: undefined,
      addressFilter: '0xabc',
      fromFilter: undefined,
      toFilter: '0xdef',
      operationFilter: undefined,
      noPriceFilter: undefined,
    });
    expect(buildTransactionsJsonFilters(params)).toEqual({
      address: '0xabc',
      to: '0xdef',
    });
  });
});
