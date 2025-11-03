import type { UniversalTransaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { ExportHandler } from '../export-handler.ts';
import type { ExportHandlerParams } from '../export-utils.ts';

// Mock dependencies
vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/data')>('@exitbook/data');
  return {
    ...actual,
    TransactionRepository: vi.fn(),
  };
});

describe('ExportHandler', () => {
  let mockDatabase: KyselyDB;
  let mockTransactionRepository: {
    getTransactions: Mock;
  };
  let handler: ExportHandler;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database
    mockDatabase = {} as KyselyDB;

    // Mock transaction repository
    mockTransactionRepository = {
      getTransactions: vi.fn(),
    };

    // Setup TransactionRepository mock
    const { TransactionRepository } = await import('@exitbook/data');
    (TransactionRepository as unknown as Mock).mockImplementation(() => mockTransactionRepository);

    handler = new ExportHandler(mockDatabase);
  });

  const createMockTransaction = (id: number, source: string, asset: string): UniversalTransaction => ({
    id: id,
    externalId: `ext-${id}`,
    source: source,
    operation: { category: 'trade', type: 'buy' },
    datetime: '2024-01-01T12:00:00Z',
    timestamp: Date.parse('2024-01-01T12:00:00Z'),
    status: 'success',
    movements: { inflows: [{ asset, amount: parseDecimal('1.0') }], outflows: [] },
    fees: {},
  });

  describe('execute', () => {
    it('should successfully export transactions to CSV', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC'), createMockTransaction(2, 'kraken', 'ETH')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.transactionCount).toBe(2);
      expect(exportResult.format).toBe('csv');
      expect(exportResult.outputPath).toBe('./data/transactions.csv');
      expect(exportResult.content).toContain('id,source,operation_category');
      expect(exportResult.content).toContain('1,kraken,trade');
      expect(exportResult.content).toContain('2,kraken,trade');

      expect(mockTransactionRepository.getTransactions).toHaveBeenCalledWith({ includeExcluded: true });
    });

    it('should successfully export transactions to JSON', async () => {
      const params: ExportHandlerParams = {
        format: 'json',
        outputPath: './data/transactions.json',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.transactionCount).toBe(1);
      expect(exportResult.format).toBe('json');
      expect(exportResult.outputPath).toBe('./data/transactions.json');

      const parsedContent = JSON.parse(exportResult.content) as UniversalTransaction[];
      expect(parsedContent).toHaveLength(1);
      expect(parsedContent[0]?.id).toBe(1);
      expect(parsedContent[0]?.source).toBe('kraken');
    });

    it('should filter by source name', async () => {
      const params: ExportHandlerParams = {
        sourceName: 'kraken',
        format: 'csv',
        outputPath: './data/kraken.csv',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.sourceName).toBe('kraken');
      expect(exportResult.transactionCount).toBe(1);

      expect(mockTransactionRepository.getTransactions).toHaveBeenCalledWith({
        sourceId: 'kraken',
        includeExcluded: true,
      });
    });

    it('should filter by since date', async () => {
      const sinceTimestamp = Date.parse('2024-01-01');
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
        since: sinceTimestamp,
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockTransactionRepository.getTransactions).toHaveBeenCalledWith({
        since: sinceTimestamp,
        includeExcluded: true,
      });
    });

    it('should filter by both source and since date', async () => {
      const sinceTimestamp = Date.parse('2024-01-01');
      const params: ExportHandlerParams = {
        sourceName: 'bitcoin',
        format: 'json',
        outputPath: './data/bitcoin.json',
        since: sinceTimestamp,
      };

      const transactions = [createMockTransaction(1, 'bitcoin', 'BTC')];

      mockTransactionRepository.getTransactions.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockTransactionRepository.getTransactions).toHaveBeenCalledWith({
        sourceId: 'bitcoin',
        since: sinceTimestamp,
        includeExcluded: true,
      });
    });

    it('should handle empty transaction list for CSV', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      mockTransactionRepository.getTransactions.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.transactionCount).toBe(0);
      expect(exportResult.content).toBe('');
    });

    it('should handle empty transaction list for JSON', async () => {
      const params: ExportHandlerParams = {
        format: 'json',
        outputPath: './data/transactions.json',
      };

      mockTransactionRepository.getTransactions.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.transactionCount).toBe(0);
      expect(exportResult.content).toBe('[]');
    });

    it('should return error when format is missing', async () => {
      const params = {
        outputPath: './data/transactions.csv',
      } as ExportHandlerParams;

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Export format is required');
    });

    it('should return error when output path is missing', async () => {
      const params = {
        format: 'csv',
      } as ExportHandlerParams;

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Output path is required');
    });

    it('should return error when transaction retrieval fails', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      const dbError = new Error('Database connection failed');
      mockTransactionRepository.getTransactions.mockResolvedValue(err(dbError));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Failed to retrieve transactions');
      expect(result._unsafeUnwrapErr().message).toContain('Database connection failed');
    });

    it('should handle unexpected errors gracefully', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      mockTransactionRepository.getTransactions.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Unexpected error');
    });

    it('should handle non-Error exceptions', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      mockTransactionRepository.getTransactions.mockRejectedValue('String error');

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('String error');
    });
  });

  describe('destroy', () => {
    it('should not throw when called', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
