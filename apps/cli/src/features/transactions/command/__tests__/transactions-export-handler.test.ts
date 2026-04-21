import type { Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { ANNOTATION_KINDS, ANNOTATION_TIERS, type TransactionAnnotation } from '@exitbook/transaction-interpretation';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import { TransactionsExportHandler } from '../transactions-export-handler.js';
import type { ExportHandlerParams } from '../transactions-export-utils.js';

describe('TransactionsExportHandler', () => {
  let mockTransactionRepository: {
    findAll: Mock;
  };
  let mockTransactionLinkQueries: {
    findByTransactionIds: Mock;
  };
  let mockTransactionAnnotations: {
    readAnnotations: Mock;
  };
  let handler: TransactionsExportHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTransactionRepository = {
      findAll: vi.fn(),
    };

    mockTransactionLinkQueries = {
      findByTransactionIds: vi.fn().mockResolvedValue(ok([])),
    };

    mockTransactionAnnotations = {
      readAnnotations: vi.fn().mockResolvedValue(ok([])),
    };

    const mockDb = {
      transactions: mockTransactionRepository,
      transactionLinks: mockTransactionLinkQueries,
      transactionAnnotations: mockTransactionAnnotations,
    } as unknown as DataSession;

    handler = new TransactionsExportHandler(mockDb);
  });

  const createMockTransaction = (id: number, platformKey: string, assetSymbol: string): Transaction =>
    createPersistedTransaction({
      id: id,
      accountId: 1,
      txFingerprint: `ext-${id}`,
      platformKey,
      platformKind: 'exchange',
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

  const createMockAnnotation = (
    transactionId: number,
    kind: TransactionAnnotation['kind'],
    tier: TransactionAnnotation['tier']
  ): TransactionAnnotation => ({
    annotationFingerprint: `annotation-${transactionId}-${kind}-${tier}`,
    accountId: 1,
    transactionId,
    txFingerprint: `ext-${transactionId}`,
    kind,
    tier,
    target: { scope: 'transaction' },
    detectorId: 'detector',
    derivedFromTxIds: [transactionId],
    provenanceInputs: ['processor'],
  });

  describe('execute', () => {
    it('should successfully export transactions to CSV', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC'), createMockTransaction(2, 'kraken', 'ETH')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      const exportResult = assertOk(result);
      expect(exportResult.transactionCount).toBe(2);
      expect(exportResult.format).toBe('csv');
      expect(exportResult.csvFormat).toBe('normalized');
      expect(exportResult.outputs).toHaveLength(7);
      expect(exportResult.outputs[0]?.path).toBe('./data/transactions.csv');
      expect(exportResult.outputs[0]?.content).toContain('id,tx_fingerprint,account_id');
      expect(exportResult.outputs[0]?.content).toContain('1,ext-1,1,kraken,trade');
      expect(exportResult.outputs[0]?.content).toContain('2,ext-2,1,kraken,trade');
      expect(exportResult.outputs[3]?.path).toBe('./data/transactions.annotations.csv');
      expect(exportResult.outputs[4]?.path).toBe('./data/transactions.diagnostics.csv');
      expect(exportResult.outputs[5]?.path).toBe('./data/transactions.user-notes.csv');
      expect(exportResult.outputs[6]?.path).toBe('./data/transactions.links.csv');

      expect(mockTransactionRepository.findAll).toHaveBeenCalledWith({ profileId: 1, includeExcluded: true });
      expect(mockTransactionAnnotations.readAnnotations).toHaveBeenCalledWith({
        transactionIds: [1, 2],
        kinds: ANNOTATION_KINDS,
        tiers: ANNOTATION_TIERS,
      });
      expect(mockTransactionLinkQueries.findByTransactionIds).toHaveBeenCalledWith([1, 2]);
    });

    it('should successfully export transactions to JSON', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'json',
        outputPath: './data/transactions.json',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      const exportResult = assertOk(result);
      expect(exportResult.transactionCount).toBe(1);
      expect(exportResult.format).toBe('json');
      expect(exportResult.outputs).toHaveLength(1);
      expect(exportResult.outputs[0]?.path).toBe('./data/transactions.json');
      expect(mockTransactionLinkQueries.findByTransactionIds).not.toHaveBeenCalled();

      const parsedContent = JSON.parse(exportResult.outputs[0]?.content ?? '[]') as unknown as (Transaction & {
        annotations: unknown[];
        operationGroup: string;
        operationLabel: string;
      })[];
      expect(parsedContent).toHaveLength(1);
      expect(parsedContent[0]?.id).toBe(1);
      expect(parsedContent[0]?.platformKey).toBe('kraken');
      expect(parsedContent[0]?.operationGroup).toBe('trade');
      expect(parsedContent[0]?.operationLabel).toBe('trade/buy');
      expect(parsedContent[0]?.annotations).toEqual([]);
    });

    it('should include materialized user notes in JSON exports', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'json',
        outputPath: './data/transactions.json',
      };
      const transactions = [
        {
          ...createMockTransaction(1, 'kraken', 'BTC'),
          userNotes: [
            {
              message: 'Cold storage transfer',
              createdAt: '2026-03-15T12:00:00.000Z',
              author: 'user',
            },
          ],
        },
      ];
      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);
      const exportResult = assertOk(result);
      const parsedContent = JSON.parse(exportResult.outputs[0]?.content ?? '[]') as Transaction[];

      expect(parsedContent[0]?.userNotes).toEqual([
        {
          message: 'Cold storage transfer',
          createdAt: '2026-03-15T12:00:00.000Z',
          author: 'user',
        },
      ]);
    });

    it('should include diagnostics in JSON exports', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'json',
        outputPath: './data/transactions.json',
      };
      const transactions = [
        {
          ...createMockTransaction(1, 'kraken', 'BTC'),
          diagnostics: [
            {
              code: 'classification_uncertain',
              message: 'Needs review',
              severity: 'warning',
            },
          ],
        },
      ];
      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);
      const exportResult = assertOk(result);
      const parsedContent = JSON.parse(exportResult.outputs[0]?.content ?? '[]') as Transaction[];

      expect(parsedContent[0]?.diagnostics).toEqual([
        {
          code: 'classification_uncertain',
          message: 'Needs review',
          severity: 'warning',
        },
      ]);
    });

    it('should export simple CSV when csvFormat is simple', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'csv',
        csvFormat: 'simple',
        outputPath: './data/transactions.csv',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      const exportResult = assertOk(result);
      expect(exportResult.format).toBe('csv');
      expect(exportResult.csvFormat).toBe('simple');
      expect(exportResult.outputs).toHaveLength(1);
      expect(exportResult.outputs[0]?.content).toContain('id,tx_fingerprint,platform_key,operation_category');
      expect(mockTransactionLinkQueries.findByTransactionIds).not.toHaveBeenCalled();
    });

    it('should filter by platform key', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        platformKey: 'kraken',
        format: 'csv',
        outputPath: './data/kraken.csv',
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      const exportResult = assertOk(result);
      expect(exportResult.platformKey).toBe('kraken');
      expect(exportResult.transactionCount).toBe(1);

      expect(mockTransactionRepository.findAll).toHaveBeenCalledWith({
        profileId: 1,
        platformKey: 'kraken',
        includeExcluded: true,
      });
    });

    it('should filter by since date', async () => {
      const sinceTimestamp = Date.parse('2024-01-01');
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'csv',
        outputPath: './data/transactions.csv',
        since: sinceTimestamp,
      };

      const transactions = [createMockTransaction(1, 'kraken', 'BTC')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      assertOk(result);
      expect(mockTransactionRepository.findAll).toHaveBeenCalledWith({
        profileId: 1,
        since: sinceTimestamp,
        includeExcluded: true,
      });
    });

    it('should filter by both platform key and since date', async () => {
      const sinceTimestamp = Date.parse('2024-01-01');
      const params: ExportHandlerParams = {
        profileId: 1,
        platformKey: 'bitcoin',
        format: 'json',
        outputPath: './data/bitcoin.json',
        since: sinceTimestamp,
      };

      const transactions = [createMockTransaction(1, 'bitcoin', 'BTC')];

      mockTransactionRepository.findAll.mockResolvedValue(ok(transactions));

      const result = await handler.execute(params);

      assertOk(result);
      expect(mockTransactionRepository.findAll).toHaveBeenCalledWith({
        profileId: 1,
        platformKey: 'bitcoin',
        since: sinceTimestamp,
        includeExcluded: true,
      });
    });

    it('should filter exports by annotation kind and tier', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'json',
        outputPath: './data/transactions.json',
        annotationKind: 'bridge_participant',
        annotationTier: 'asserted',
      };

      mockTransactionRepository.findAll.mockResolvedValue(
        ok([createMockTransaction(1, 'ethereum', 'ETH'), createMockTransaction(2, 'kraken', 'BTC')])
      );
      mockTransactionAnnotations.readAnnotations.mockResolvedValue(
        ok([createMockAnnotation(1, 'bridge_participant', 'asserted'), createMockAnnotation(2, 'wrap', 'asserted')])
      );

      const result = await handler.execute(params);

      const exportResult = assertOk(result);
      expect(exportResult.transactionCount).toBe(1);
      expect(mockTransactionLinkQueries.findByTransactionIds).not.toHaveBeenCalled();
      const parsedContent = JSON.parse(exportResult.outputs[0]?.content ?? '[]') as unknown as { id: number }[];
      expect(parsedContent.map((transaction) => transaction.id)).toEqual([1]);
    });

    it('should handle empty transaction list for CSV', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      mockTransactionRepository.findAll.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      const exportResult = assertOk(result);
      expect(exportResult.transactionCount).toBe(0);
      expect(exportResult.outputs[0]?.content).toBe('');
    });

    it('should handle empty transaction list for JSON', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'json',
        outputPath: './data/transactions.json',
      };

      mockTransactionRepository.findAll.mockResolvedValue(ok([]));

      const result = await handler.execute(params);

      const exportResult = assertOk(result);
      expect(exportResult.transactionCount).toBe(0);
      expect(exportResult.outputs[0]?.content).toBe('[]');
    });

    // Note: Validation tests removed - validation now handled by ExportCommandOptionsSchema at CLI boundary
    // Handler assumes params are already validated by Zod

    it('should return error when transaction retrieval fails', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      const dbError = new Error('Database connection failed');
      mockTransactionRepository.findAll.mockResolvedValue(err(dbError));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toContain('Failed to retrieve transactions');
      expect(error.message).toContain('Database connection failed');
    });

    it('should handle unexpected errors gracefully', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      mockTransactionRepository.findAll.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toContain('Unexpected error');
    });

    it('should handle non-Error exceptions', async () => {
      const params: ExportHandlerParams = {
        profileId: 1,
        format: 'csv',
        outputPath: './data/transactions.csv',
      };

      mockTransactionRepository.findAll.mockRejectedValue('String error');

      const result = await handler.execute(params);

      const error = assertErr(result);
      expect(error.message).toContain('String error');
    });
  });
});
