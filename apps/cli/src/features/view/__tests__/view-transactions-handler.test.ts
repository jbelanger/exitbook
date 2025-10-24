import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ViewTransactionsHandler } from '../view-transactions-handler.ts';
import type { ViewTransactionsParams } from '../view-transactions-utils.ts';

import { createMockTransaction } from './test-helpers.ts';

describe('ViewTransactionsHandler', () => {
  let mockTxRepo: TransactionRepository;
  let handler: ViewTransactionsHandler;
  let mockGetTransactions: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock function
    mockGetTransactions = vi.fn();

    // Mock repository
    mockTxRepo = {
      getTransactions: mockGetTransactions,
    } as unknown as TransactionRepository;

    handler = new ViewTransactionsHandler(mockTxRepo);
  });

  describe('execute', () => {
    it('should return formatted transactions successfully', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          movements: { inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }] },
        }),
        createMockTransaction({
          id: 2,
          movements: { inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }] },
        }),
      ];

      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.count).toBe(2);
      expect(value.transactions).toHaveLength(2);
      expect(value.transactions[0]!.id).toBe(1);
      expect(value.transactions[1]!.id).toBe(2);
    });

    it('should filter by source', async () => {
      const mockTransactions: UniversalTransaction[] = [createMockTransaction()];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { source: 'kraken' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockGetTransactions).toHaveBeenCalledWith({ sourceId: 'kraken' });
    });

    it('should filter by since date', async () => {
      const mockTransactions: UniversalTransaction[] = [createMockTransaction({ datetime: '2024-06-01T00:00:00Z' })];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { since: '2024-01-01' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockGetTransactions).toHaveBeenCalledWith({ since: Math.floor(new Date('2024-01-01').getTime() / 1000) });
    });

    it('should filter by until date', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({ datetime: '2024-01-15T00:00:00Z' }),
        createMockTransaction({ datetime: '2024-02-15T00:00:00Z' }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { until: '2024-01-31' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      // Should only include first transaction (Jan 15)
      expect(value.count).toBe(1);
      expect(value.transactions[0]!.transaction_datetime).toBe('2024-01-15T00:00:00Z');
    });

    it('should filter by asset', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          movements: { inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }] },
        }),
        createMockTransaction({
          movements: { inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }] },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { asset: 'BTC' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(1);
      expect(value.transactions[0]!.movements_primary_asset).toBe('BTC');
    });

    it('should filter by operation type', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({ operation: { category: 'trade', type: 'buy' } }),
        createMockTransaction({ operation: { category: 'trade', type: 'sell' } }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { operationType: 'buy' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(1);
      expect(value.transactions[0]!.operation_type).toBe('buy');
    });

    it('should filter transactions with no price', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({ movements: { inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }] } }),
        createMockTransaction({ movements: { inflows: [], outflows: [] } }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { noPrice: true };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(1);
    });

    it('should apply limit', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({ id: 1 }),
        createMockTransaction({ id: 2 }),
        createMockTransaction({ id: 3 }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { limit: 2 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(2);
      expect(value.transactions).toHaveLength(2);
    });

    it('should apply multiple filters together', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          datetime: '2024-01-15T00:00:00Z',
          movements: { inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }] },
          operation: { type: 'buy', category: 'trade' },
        }),
        createMockTransaction({
          id: 2,
          datetime: '2024-02-01T00:00:00Z',
          movements: { inflows: [{ asset: 'BTC', amount: parseDecimal('0.5') }] },
          operation: { type: 'sell', category: 'trade' },
        }),
        createMockTransaction({
          id: 3,
          datetime: '2024-01-20T00:00:00Z',
          movements: { inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }] },
          operation: { type: 'buy', category: 'trade' },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = {
        asset: 'BTC',
        operationType: 'buy',
        until: '2024-01-31',
        limit: 10,
      };

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      // Should only include transaction #1 (BTC, buy, before Jan 31)
      expect(value.count).toBe(1);
      expect(value.transactions[0]!.id).toBe(1);
    });

    it('should return empty array when no transactions match filters', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          movements: { inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }], outflows: [] },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { asset: 'ETH' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(0);
      expect(value.transactions).toEqual([]);
    });

    it('should return error when repository fails', async () => {
      const error = new Error('Database connection failed');
      mockGetTransactions.mockResolvedValue(err(error));

      const params: ViewTransactionsParams = {};
      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(error);
    });

    it('should format blockchain transactions with addresses and hash', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          from: 'bc1q...',
          to: 'bc1p...',
          blockchain: { name: 'bitcoin', transaction_hash: '0x123abc', is_confirmed: true },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.transactions[0]!.from_address).toBe('bc1q...');
      expect(value.transactions[0]!.to_address).toBe('bc1p...');
      expect(value.transactions[0]!.blockchain_transaction_hash).toBe('0x123abc');
    });

    it('should handle date range filtering', async () => {
      // Mock returns transactions after 'since' date (March 1)
      // Handler will then filter by 'until' date (Sept 30)
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({ id: 2, datetime: '2024-06-15T00:00:00Z' }),
        createMockTransaction({ id: 3, datetime: '2024-12-31T00:00:00Z' }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = {
        since: '2024-03-01',
        until: '2024-09-30',
      };

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      // Should only include transaction #2 (June) - Dec 31 filtered out by until
      expect(value.count).toBe(1);
      expect(value.transactions[0]!.id).toBe(2);
    });
  });

  describe('destroy', () => {
    it('should not throw error when called', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
