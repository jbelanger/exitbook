import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ViewPricesHandler } from '../view-prices-handler.ts';
import type { ViewPricesParams } from '../view-prices-utils.ts';

import { addPriceToMovement, createMockTransaction } from './test-helpers.ts';

describe('ViewPricesHandler', () => {
  let mockTxRepo: TransactionRepository;
  let handler: ViewPricesHandler;
  let mockGetTransactions: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock function
    mockGetTransactions = vi.fn();

    // Mock repository
    mockTxRepo = {
      getTransactions: mockGetTransactions,
    } as unknown as TransactionRepository;

    handler = new ViewPricesHandler(mockTxRepo);
  });

  describe('execute', () => {
    it('should calculate price coverage for multiple assets', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          movements: {
            inflows: [addPriceToMovement({ asset: 'BTC', amount: parseDecimal('1.0') })],
            outflows: [],
          },
        }),
        createMockTransaction({
          id: 2,
          movements: {
            inflows: [{ asset: 'BTC', amount: parseDecimal('0.5') }],
            outflows: [],
          },
        }),
        createMockTransaction({
          id: 3,
          movements: {
            inflows: [addPriceToMovement({ asset: 'ETH', amount: parseDecimal('10.0') })],
            outflows: [],
          },
        }),
      ];

      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.coverage).toHaveLength(2);

      // BTC: 1 with price, 1 without = 50%
      const btcCoverage = value.coverage.find((c) => c.asset === 'BTC');
      expect(btcCoverage).toBeDefined();
      expect(btcCoverage!.total_transactions).toBe(2);
      expect(btcCoverage!.with_price).toBe(1);
      expect(btcCoverage!.missing_price).toBe(1);
      expect(btcCoverage!.coverage_percentage).toBe(50);

      // ETH: 1 with price = 100%
      const ethCoverage = value.coverage.find((c) => c.asset === 'ETH');
      expect(ethCoverage).toBeDefined();
      expect(ethCoverage!.total_transactions).toBe(1);
      expect(ethCoverage!.with_price).toBe(1);
      expect(ethCoverage!.missing_price).toBe(0);
      expect(ethCoverage!.coverage_percentage).toBe(100);

      // Summary
      expect(value.summary.total_transactions).toBe(3);
      expect(value.summary.with_price).toBe(2);
      expect(value.summary.missing_price).toBe(1);
      expect(value.summary.overall_coverage_percentage).toBeCloseTo(66.67, 1);
    });

    it('should filter by source', async () => {
      const mockTransactions: UniversalTransaction[] = [createMockTransaction()];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = { source: 'kraken' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockGetTransactions).toHaveBeenCalledWith({ sourceId: 'kraken' });
    });

    it('should filter by asset', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          movements: {
            inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }],
            outflows: [],
          },
        }),
        createMockTransaction({
          movements: {
            inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }],
            outflows: [],
          },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = { asset: 'BTC' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.coverage).toHaveLength(1);
      expect(value.coverage[0]!.asset).toBe('BTC');
    });

    it('should filter by missing-only', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          movements: {
            inflows: [addPriceToMovement({ asset: 'BTC', amount: parseDecimal('1.0') })],
            outflows: [],
          },
        }),
        createMockTransaction({
          id: 2,
          movements: {
            inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }],
            outflows: [],
          },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = { missingOnly: true };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      // Only ETH should be shown (has missing price)
      expect(value.coverage).toHaveLength(1);
      expect(value.coverage[0]!.asset).toBe('ETH');
      expect(value.coverage[0]!.missing_price).toBe(1);
    });

    it('should handle transactions without movements', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          movements: {
            inflows: [],
            outflows: [],
          },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.coverage).toHaveLength(0);
      expect(value.summary.total_transactions).toBe(0);
    });

    it('should use outflow if no inflow exists', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          movements: {
            inflows: [],
            outflows: [addPriceToMovement({ asset: 'BTC', amount: parseDecimal('1.0') })],
          },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.coverage).toHaveLength(1);
      expect(value.coverage[0]!.asset).toBe('BTC');
      expect(value.coverage[0]!.with_price).toBe(1);
    });

    it('should handle all transactions having prices', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          movements: {
            inflows: [addPriceToMovement({ asset: 'BTC', amount: parseDecimal('1.0') })],
            outflows: [],
          },
        }),
        createMockTransaction({
          id: 2,
          movements: {
            inflows: [addPriceToMovement({ asset: 'ETH', amount: parseDecimal('10.0') })],
            outflows: [],
          },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.coverage).toHaveLength(2);
      expect(value.summary.overall_coverage_percentage).toBe(100);
      expect(value.summary.missing_price).toBe(0);
    });

    it('should handle all transactions missing prices', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          movements: {
            inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }],
            outflows: [],
          },
        }),
        createMockTransaction({
          id: 2,
          movements: {
            inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }],
            outflows: [],
          },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.coverage).toHaveLength(2);
      expect(value.summary.overall_coverage_percentage).toBe(0);
      expect(value.summary.with_price).toBe(0);
    });

    it('should return empty coverage when no transactions exist', async () => {
      mockGetTransactions.mockResolvedValue(ok([]));

      const params: ViewPricesParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.coverage).toHaveLength(0);
      expect(value.summary.total_transactions).toBe(0);
      expect(value.summary.with_price).toBe(0);
      expect(value.summary.missing_price).toBe(0);
      expect(value.summary.overall_coverage_percentage).toBe(0);
    });

    it('should return error when repository fails', async () => {
      const error = new Error('Database connection failed');
      mockGetTransactions.mockResolvedValue(err(error));

      const params: ViewPricesParams = {};
      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
    });

    it('should sort coverage by asset name alphabetically', async () => {
      const mockTransactions: UniversalTransaction[] = [
        createMockTransaction({
          movements: {
            inflows: [{ asset: 'SOL', amount: parseDecimal('100.0') }],
            outflows: [],
          },
        }),
        createMockTransaction({
          movements: {
            inflows: [{ asset: 'BTC', amount: parseDecimal('1.0') }],
            outflows: [],
          },
        }),
        createMockTransaction({
          movements: {
            inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }],
            outflows: [],
          },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.coverage).toHaveLength(3);
      expect(value.coverage[0]!.asset).toBe('BTC');
      expect(value.coverage[1]!.asset).toBe('ETH');
      expect(value.coverage[2]!.asset).toBe('SOL');
    });

    it('should not double-count multi-asset transactions in summary', async () => {
      const mockTransactions: UniversalTransaction[] = [
        // Trade transaction with BTC (with price) and USDT (with price)
        createMockTransaction({
          id: 1,
          movements: {
            inflows: [addPriceToMovement({ asset: 'BTC', amount: parseDecimal('1.0') })],
            outflows: [addPriceToMovement({ asset: 'USDT', amount: parseDecimal('50000') })],
          },
        }),
        // Transfer transaction with only ETH (without price)
        createMockTransaction({
          id: 2,
          movements: {
            inflows: [{ asset: 'ETH', amount: parseDecimal('10.0') }],
            outflows: [],
          },
        }),
      ];
      mockGetTransactions.mockResolvedValue(ok(mockTransactions));

      const params: ViewPricesParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      // Should have 3 assets
      expect(value.coverage).toHaveLength(3);

      // Per-asset coverage should be correct
      const btcCoverage = value.coverage.find((c) => c.asset === 'BTC');
      expect(btcCoverage?.total_transactions).toBe(1);
      expect(btcCoverage?.with_price).toBe(1);

      const usdtCoverage = value.coverage.find((c) => c.asset === 'USDT');
      expect(usdtCoverage?.total_transactions).toBe(1);
      expect(usdtCoverage?.with_price).toBe(1);

      const ethCoverage = value.coverage.find((c) => c.asset === 'ETH');
      expect(ethCoverage?.total_transactions).toBe(1);
      expect(ethCoverage?.missing_price).toBe(1);

      // Summary should show 2 unique transactions, not 3
      expect(value.summary.total_transactions).toBe(2);
      expect(value.summary.with_price).toBe(2); // BTC + USDT asset-transaction pairs
      expect(value.summary.missing_price).toBe(1); // ETH asset-transaction pair
      // Overall coverage: 2 priced / 3 total asset-transactions = 66.67%
      expect(value.summary.overall_coverage_percentage).toBeCloseTo(66.67, 1);
    });
  });

  describe('destroy', () => {
    it('should not throw error when called', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
