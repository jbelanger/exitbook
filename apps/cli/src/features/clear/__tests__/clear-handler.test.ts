import type { CostBasisRepository, TransactionLinkRepository } from '@exitbook/accounting';
import type { KyselyDB, TransactionRepository } from '@exitbook/data';
import type { RawDataRepository } from '@exitbook/import';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ClearHandler } from '../clear-handler.ts';
import type { ClearHandlerParams } from '../clear-utils.ts';

describe('ClearHandler', () => {
  let mockDatabase: KyselyDB;
  let mockTransactionRepo: TransactionRepository;
  let mockTransactionLinkRepo: TransactionLinkRepository;
  let mockCostBasisRepo: CostBasisRepository;
  let mockRawDataRepo: RawDataRepository;
  let handler: ClearHandler;
  let mockSelectFrom: Mock;
  let mockDeleteFrom: Mock;

  // Store mock functions to avoid unbound-method lint errors
  let mockDeleteAllTransactions: Mock;
  let mockDeleteTransactionsBySource: Mock;
  let mockDeleteAllLinks: Mock;
  let mockDeleteLinksBySource: Mock;
  let mockDeleteAllDisposals: Mock;
  let mockDeleteDisposalsBySource: Mock;
  let mockDeleteAllLots: Mock;
  let mockDeleteLotsBySource: Mock;
  let mockDeleteAllCalculations: Mock;
  let mockDeleteAllRawData: Mock;
  let mockDeleteRawDataBySource: Mock;
  let mockResetProcessingStatusAll: Mock;
  let mockResetProcessingStatusBySource: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock database methods
    mockSelectFrom = vi.fn();
    mockDeleteFrom = vi.fn();

    mockDatabase = {
      deleteFrom: mockDeleteFrom,
      selectFrom: mockSelectFrom,
    } as unknown as KyselyDB;

    // Create mock functions
    mockDeleteAllTransactions = vi.fn().mockResolvedValue(ok(10));
    mockDeleteTransactionsBySource = vi.fn().mockResolvedValue(ok(10));
    mockDeleteAllLinks = vi.fn().mockResolvedValue(ok(5));
    mockDeleteLinksBySource = vi.fn().mockResolvedValue(ok(5));
    mockDeleteAllDisposals = vi.fn().mockResolvedValue(ok(3));
    mockDeleteDisposalsBySource = vi.fn().mockResolvedValue(ok(3));
    mockDeleteAllLots = vi.fn().mockResolvedValue(ok(4));
    mockDeleteLotsBySource = vi.fn().mockResolvedValue(ok(4));
    mockDeleteAllCalculations = vi.fn().mockResolvedValue(ok(2));
    mockDeleteAllRawData = vi.fn().mockResolvedValue(ok(100));
    mockDeleteRawDataBySource = vi.fn().mockResolvedValue(ok(100));
    mockResetProcessingStatusAll = vi.fn().mockResolvedValue(ok(100));
    mockResetProcessingStatusBySource = vi.fn().mockResolvedValue(ok(100));

    // Mock repositories with successful responses
    mockTransactionRepo = {
      deleteAll: mockDeleteAllTransactions,
      deleteBySource: mockDeleteTransactionsBySource,
    } as unknown as TransactionRepository;

    mockTransactionLinkRepo = {
      deleteAll: mockDeleteAllLinks,
      deleteBySource: mockDeleteLinksBySource,
    } as unknown as TransactionLinkRepository;

    mockCostBasisRepo = {
      deleteAllCalculations: mockDeleteAllCalculations,
      deleteAllDisposals: mockDeleteAllDisposals,
      deleteAllLots: mockDeleteAllLots,
      deleteDisposalsBySource: mockDeleteDisposalsBySource,
      deleteLotsBySource: mockDeleteLotsBySource,
    } as unknown as CostBasisRepository;

    mockRawDataRepo = {
      deleteAll: mockDeleteAllRawData,
      deleteBySource: mockDeleteRawDataBySource,
      resetProcessingStatusAll: mockResetProcessingStatusAll,
      resetProcessingStatusBySource: mockResetProcessingStatusBySource,
    } as unknown as RawDataRepository;

    handler = new ClearHandler(
      mockDatabase,
      mockTransactionRepo,
      mockTransactionLinkRepo,
      mockCostBasisRepo,
      mockRawDataRepo
    );
  });

  describe('previewDeletion', () => {
    it('should preview deletion counts for all tables', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      const createMockCountQuery = (count: number) => ({
        executeTakeFirst: vi.fn().mockResolvedValue({ count }),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      });

      const counts = [3, 150, 100, 25, 50, 20, 10];
      let callIndex = 0;

      mockSelectFrom.mockImplementation(() => {
        const count = counts[callIndex++] || 0;
        return createMockCountQuery(count);
      });

      const result = await handler.previewDeletion(params);

      expect(result.isOk()).toBe(true);
      const preview = result._unsafeUnwrap();
      expect(preview.sessions).toBe(3);
      expect(preview.rawData).toBe(150);
      expect(preview.transactions).toBe(100);
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      const createMockCountQuery = (count: number) => ({
        executeTakeFirst: vi.fn().mockResolvedValue({ count }),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      });

      mockSelectFrom.mockImplementation(() => createMockCountQuery(10));
    });

    it('should execute clear without including raw data', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);

      // Verify repository methods were called
      expect(mockDeleteAllDisposals).toHaveBeenCalled();
      expect(mockDeleteAllLots).toHaveBeenCalled();
      expect(mockDeleteAllCalculations).toHaveBeenCalled();
      expect(mockDeleteAllLinks).toHaveBeenCalled();
      expect(mockDeleteAllTransactions).toHaveBeenCalled();
      expect(mockResetProcessingStatusAll).toHaveBeenCalled();

      // Verify raw data was NOT deleted
      expect(mockDeleteAllRawData).not.toHaveBeenCalled();
    });

    it('should execute clear including raw data', async () => {
      const params: ClearHandlerParams = {
        includeRaw: true,
      };

      const mockDeleteQuery = {
        execute: vi.fn().mockResolvedValue({}),
        where: vi.fn().mockReturnThis(),
      };

      mockDeleteFrom.mockReturnValue(mockDeleteQuery);

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);

      // Verify raw data was deleted
      expect(mockDeleteAllRawData).toHaveBeenCalled();
      expect(mockResetProcessingStatusAll).not.toHaveBeenCalled();

      // Verify import_session_errors and import_sessions were deleted via DB
      expect(mockDeleteFrom).toHaveBeenCalledWith('import_session_errors');
      expect(mockDeleteFrom).toHaveBeenCalledWith('import_sessions');
    });

    it('should execute clear for specific source', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
        source: 'kraken',
      };

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);

      // Verify source-specific methods were called
      expect(mockDeleteDisposalsBySource).toHaveBeenCalledWith('kraken');
      expect(mockDeleteLotsBySource).toHaveBeenCalledWith('kraken');
      expect(mockDeleteLinksBySource).toHaveBeenCalledWith('kraken');
      expect(mockDeleteTransactionsBySource).toHaveBeenCalledWith('kraken');
      expect(mockResetProcessingStatusBySource).toHaveBeenCalledWith('kraken');
    });

    it('should return early when there is no data to delete', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      const createMockCountQuery = () => ({
        executeTakeFirst: vi.fn().mockResolvedValue({ count: 0 }),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      });

      mockSelectFrom.mockImplementation(() => createMockCountQuery());

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const clearResult = result._unsafeUnwrap();
      expect(clearResult.deleted.sessions).toBe(0);
      expect(clearResult.deleted.transactions).toBe(0);

      // Verify no repository delete operations were called
      expect(mockDeleteAllTransactions).not.toHaveBeenCalled();
      expect(mockDeleteTransactionsBySource).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should cleanup without errors', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
