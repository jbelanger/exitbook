import type { UniversalTransaction } from '@exitbook/core';
import { Currency, parseDecimal } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { GapsViewHandler } from '../gaps-view-handler.js';
import type { GapsViewParams } from '../gaps-view-utils.js';

// Mock dependencies
vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/data')>('@exitbook/data');
  return {
    ...actual,
    TransactionRepository: vi.fn(),
  };
});

describe('GapsViewHandler', () => {
  let mockTransactionRepository: {
    getTransactions: Mock;
  };
  let handler: GapsViewHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock transaction repository
    mockTransactionRepository = {
      getTransactions: vi.fn(),
    };

    handler = new GapsViewHandler(mockTransactionRepository as unknown as TransactionRepository);
  });

  const createMockTransaction = (overrides: Partial<UniversalTransaction> = {}): UniversalTransaction => ({
    id: 1,
    externalId: 'tx-123',
    datetime: '2024-01-01T12:00:00Z',
    timestamp: 1704110400000,
    source: 'kraken',
    status: 'success',
    movements: {
      inflows: [],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'withdrawal',
    },
    ...overrides,
  });

  describe('execute - fees category', () => {
    it('should successfully analyze fee gaps', async () => {
      const params: GapsViewParams = {
        category: 'fees',
      };

      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          fees: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.0001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: undefined, // Missing price
            },
          ],
        }),
        createMockTransaction({
          id: 2,
          externalId: 'tx-2',
          operation: {
            category: 'fee',
            type: 'fee',
          },
          movements: {
            inflows: [],
            outflows: [
              {
                asset: 'ETH',
                grossAmount: parseDecimal('0.01'),
              },
            ],
          },
          fees: [],
        }),
      ];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const gapsResult = result._unsafeUnwrap();
      expect(gapsResult.category).toBe('fees');
      expect(gapsResult.analysis.summary.total_issues).toBeGreaterThan(0);
      expect(mockTransactionRepository.getTransactions).toHaveBeenCalled();
    });

    it('should return empty analysis when no issues found', async () => {
      const params: GapsViewParams = {
        category: 'fees',
      };

      const transactions: UniversalTransaction[] = [
        createMockTransaction({
          id: 1,
          externalId: 'tx-1',
          fees: [
            {
              asset: 'BTC',
              amount: parseDecimal('0.0001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: {
                price: { amount: parseDecimal('60000'), currency: Currency.create('USD') },
                source: 'exchange-execution',
                fetchedAt: new Date('2024-01-01T12:00:00Z'),
              },
            },
          ],
        }),
      ];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const gapsResult = result._unsafeUnwrap();
      expect(gapsResult.category).toBe('fees');
      expect(gapsResult.analysis.summary.total_issues).toBe(0);
    });

    it('should default to fees category when not specified', async () => {
      const params: GapsViewParams = {};

      mockTransactionRepository.getTransactions.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const gapsResult = result._unsafeUnwrap();
      expect(gapsResult.category).toBe('fees');
    });

    it('should return error if findAll fails', async () => {
      const params: GapsViewParams = {
        category: 'fees',
      };

      mockTransactionRepository.getTransactions.mockResolvedValue(err(new Error('Database error')));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database error');
    });
  });

  describe('execute - unsupported categories', () => {
    it('should return error for prices category (not implemented)', async () => {
      const params: GapsViewParams = {
        category: 'prices',
      };

      mockTransactionRepository.getTransactions.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not yet implemented');
    });

    it('should return error for links category (not implemented)', async () => {
      const params: GapsViewParams = {
        category: 'links',
      };

      mockTransactionRepository.getTransactions.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not yet implemented');
    });

    it('should return error for validation category (not implemented)', async () => {
      const params: GapsViewParams = {
        category: 'validation',
      };

      mockTransactionRepository.getTransactions.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not yet implemented');
    });
  });

  describe('execute - error handling', () => {
    it('should handle exceptions gracefully', async () => {
      const params: GapsViewParams = {
        category: 'fees',
      };

      mockTransactionRepository.getTransactions.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Unexpected error');
    });

    it('should handle non-Error exceptions', async () => {
      const params: GapsViewParams = {
        category: 'fees',
      };

      mockTransactionRepository.getTransactions.mockRejectedValue('String error');

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('String error');
    });
  });

  describe('destroy', () => {
    it('should cleanup resources without errors', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
