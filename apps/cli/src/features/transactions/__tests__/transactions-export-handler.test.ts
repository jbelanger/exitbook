import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { ExportHandler } from '../transactions-export-handler.js';
import type { ExportHandlerParams } from '../transactions-export-utils.js';

describe('ExportHandler', () => {
  let mockTransactionRepository: {
    findAll: Mock;
  };
  let mockTransactionLinkQueries: {
    findByTransactionIds: Mock;
  };
  let handler: ExportHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTransactionRepository = {
      findAll: vi.fn(),
    };

    mockTransactionLinkQueries = {
      findByTransactionIds: vi.fn().mockResolvedValue(ok([])),
    };

    const mockDb = {
      transactions: mockTransactionRepository,
      transactionLinks: mockTransactionLinkQueries,
    } as unknown as DataContext;

    handler = new ExportHandler(mockDb);
  });

  const createMockTransaction = (id: number, source: string, assetSymbol: string): UniversalTransactionData => ({
    id: id,
    accountId: 1,
    externalId: `ext-${id}`,
    source: source,
    sourceType: 'exchange',
    operation: { category: 'trade', type: 'buy' },
    datetime: '2024-01-01T12:00:00Z',
    timestamp: Date.parse('2024-01-01T12:00:00Z'),
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: `test:${assetSymbol.toLowerCase()}`,
          assetSymbol: assetSymbol as Currency,
          grossAmount: parseDecimal('1.0'),
        },
      ],
      outflows: [],
    },
    fees: [],
  });

  describe('execute', () => {
    it('should successfully export transactions to CSV', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC'), createMockTransaction(2, 'kraken', 'ETH')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.transactionCount).toBe(2);
      expect(exportResult.format).toBe('csv');
      expect(exportResult.csvFormat).toBe('normalized');
      expect(exportResult.outputs).toHaveLength(4);
      expect(exportResult.outputs[0]?.path).toBe('./data/transactions.csv');
      expect(exportResult.outputs[0]?.content).toContain('id,external_id,account_id');
      expect(exportResult.outputs[0]?.content).toContain('1,ext-1,1,kraken,trade');
      expect(exportResult.outputs[0]?.content).toContain('2,ext-2,1,kraken,trade');
      expect(exportResult.outputs[3]?.path).toBe('./data/transactions.links.csv');

      expect(mockTransactionRepository.findAll).toHaveBeenCalledWith({ includeExcluded: true });
      expect(mockTransactionLinkQueries.findByTransactionIds).toHaveBeenCalledWith([1, 2]);
    });

    it('should successfully export transactions to JSON', async () => {
      const params: ExportHandlerParams = {
        format: 'json',
        outputPath: './data/transactions.json',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.transactionCount).toBe(1);
      expect(exportResult.format).toBe('json');
      expect(exportResult.outputs).toHaveLength(1);
      expect(exportResult.outputs[0]?.path).toBe('./data/transactions.json');
      expect(mockTransactionLinkQueries.findByTransactionIds).not.toHaveBeenCalled();

      const parsedContent = JSON.parse(exportResult.outputs[0]?.content ?? '[]') as UniversalTransactionData[];
      expect(parsedContent).toHaveLength(1);
      expect(parsedContent[0]?.id).toBe(1);
      expect(parsedContent[0]?.source).toBe('kraken');
    });

    it('should export simple CSV when csvFormat is simple', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        csvFormat: 'simple',
        outputPath: './data/transactions.csv',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.format).toBe('csv');
      expect(exportResult.csvFormat).toBe('simple');
      expect(exportResult.outputs).toHaveLength(1);
      expect(exportResult.outputs[0]?.content).toContain('id,external_id,source,operation_category');
      expect(mockTransactionLinkQueries.findByTransactionIds).not.toHaveBeenCalled();
    });

    it('should filter by source name', async () => {
      const params: ExportHandlerParams = {
        sourceName: 'kraken',
        format: 'csv',
        outputPath: './data/kraken.csv',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.sourceName).toBe('kraken');
      expect(exportResult.transactionCount).toBe(1);

      expect(mockTransactionRepository.findAll).toHaveBeenCalledWith({
        sourceName: 'kraken',
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

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockTransactionRepository.findAll).toHaveBeenCalledWith({
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

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockTransactionRepository.findAll).toHaveBeenCalledWith({
        sourceName: 'bitcoin',
        since: sinceTimestamp,
        includeExcluded: true,
      });
    });

    it('should handle empty transaction list for CSV', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      mockTransactionRepository.findAll.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.transactionCount).toBe(0);
      expect(exportResult.outputs[0]?.content).toBe('');
    });

    it('should handle empty transaction list for JSON', async () => {
      const params: ExportHandlerParams = {
        format: 'json',
        outputPath: './data/transactions.json',
      };

      mockTransactionRepository.findAll.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const exportResult = result._unsafeUnwrap();
      expect(exportResult.transactionCount).toBe(0);
      expect(exportResult.outputs[0]?.content).toBe('[]');
    });

    // Note: Validation tests removed - validation now handled by ExportCommandOptionsSchema at CLI boundary
    // Handler assumes params are already validated by Zod

    it('should return error when transaction retrieval fails', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      const dbError = new Error('Database connection failed');
      mockTransactionRepository.findAll.mockResolvedValue(err(dbError));

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

      mockTransactionRepository.findAll.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Unexpected error');
    });

    it('should handle non-Error exceptions', async () => {
      const params: ExportHandlerParams = {
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      mockTransactionRepository.findAll.mockRejectedValue('String error');

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('String error');
    });
  });
});
