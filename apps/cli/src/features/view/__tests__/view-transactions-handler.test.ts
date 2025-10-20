/* eslint-disable unicorn/no-null -- db requires explicit null */
import { parseDecimal } from '@exitbook/core';
import type { StoredTransaction, TransactionRepository } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ViewTransactionsHandler } from '../view-transactions-handler.ts';
import type { ViewTransactionsParams } from '../view-transactions-utils.ts';

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

  const createMockTransaction = (overrides: Partial<StoredTransaction> = {}): StoredTransaction => ({
    id: 1,
    import_session_id: 1,
    source_id: 'kraken',
    source_type: 'exchange',
    external_id: 'ext-123',
    transaction_status: 'success',
    transaction_datetime: '2024-01-01T00:00:00Z',
    from_address: null,
    to_address: null,
    price: '50000.00',
    price_currency: 'USD',
    note_type: null,
    note_severity: null,
    note_message: null,
    note_metadata: null,
    raw_normalized_data: {},
    movements_inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }],
    movements_outflows: [],
    fees_network: null,
    fees_platform: null,
    fees_total: null,
    operation_category: 'trade',
    operation_type: 'buy',
    blockchain_name: null,
    blockchain_block_height: null,
    blockchain_transaction_hash: null,
    blockchain_is_confirmed: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  });

  describe('execute', () => {
    it('should return formatted transactions successfully', async () => {
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({
          id: 1,
          movements_inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }],
          movements_outflows: [],
        }),
        createMockTransaction({
          id: 2,
          movements_inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }],
          movements_outflows: [],
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
      const mockTransactions: StoredTransaction[] = [createMockTransaction()];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { source: 'kraken' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockGetTransactions).toHaveBeenCalledWith('kraken', undefined);
    });

    it('should filter by since date', async () => {
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({ transaction_datetime: '2024-06-01T00:00:00Z' }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { since: '2024-01-01' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockGetTransactions).toHaveBeenCalledWith(undefined, Math.floor(new Date('2024-01-01').getTime() / 1000));
    });

    it('should filter by until date', async () => {
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({ transaction_datetime: '2024-01-15T00:00:00Z' }),
        createMockTransaction({ transaction_datetime: '2024-02-15T00:00:00Z' }),
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
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({
          movements_inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }],
          movements_outflows: [],
        }),
        createMockTransaction({
          movements_inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }],
          movements_outflows: [],
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
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({ operation_type: 'buy' }),
        createMockTransaction({ operation_type: 'sell' }),
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
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({ price: '50000.00' }),
        createMockTransaction({ price: null }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = { noPrice: true };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(1);
      expect(value.transactions[0]!.price).toBeNull();
    });

    it('should apply limit', async () => {
      const mockTransactions: StoredTransaction[] = [
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
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({
          id: 1,
          transaction_datetime: '2024-01-15T00:00:00Z',
          movements_inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }],
          movements_outflows: [],
          operation_type: 'buy',
        }),
        createMockTransaction({
          id: 2,
          transaction_datetime: '2024-02-01T00:00:00Z',
          movements_inflows: [{ asset: 'BTC', amount: parseDecimal('0.5') }],
          movements_outflows: [],
          operation_type: 'sell',
        }),
        createMockTransaction({
          id: 3,
          transaction_datetime: '2024-01-20T00:00:00Z',
          movements_inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }],
          movements_outflows: [],
          operation_type: 'buy',
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
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({
          movements_inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }],
          movements_outflows: [],
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
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({
          source_type: 'blockchain',
          from_address: 'bc1q...',
          to_address: 'bc1p...',
          blockchain_transaction_hash: '0x123abc',
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

    it('should handle transactions with null optional fields', async () => {
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({
          external_id: null,
          operation_category: null,
          operation_type: null,
          movements_inflows: [],
          movements_outflows: [],
          price: null,
          price_currency: null,
          from_address: null,
          to_address: null,
          blockchain_transaction_hash: null,
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewTransactionsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.transactions[0]!.external_id).toBeNull();
      expect(value.transactions[0]!.price).toBeNull();
      // When movements are empty, primary movement is computed as undefined
      expect(value.transactions[0]!.movements_primary_asset).toBeUndefined();
      expect(value.transactions[0]!.movements_primary_amount).toBeUndefined();
      expect(value.transactions[0]!.movements_primary_direction).toBeUndefined();
    });

    it('should handle date range filtering', async () => {
      // Mock returns transactions after 'since' date (March 1)
      // Handler will then filter by 'until' date (Sept 30)
      const mockTransactions: StoredTransaction[] = [
        createMockTransaction({ id: 2, transaction_datetime: '2024-06-15T00:00:00Z' }),
        createMockTransaction({ id: 3, transaction_datetime: '2024-12-31T00:00:00Z' }),
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
