import type { KyselyDB } from '@exitbook/data';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ClearHandler } from '../clear-handler.ts';
import type { ClearHandlerParams } from '../clear-utils.ts';

describe('ClearHandler', () => {
  let mockDatabase: KyselyDB;
  let handler: ClearHandler;
  let mockSelectFrom: Mock;
  let mockDeleteFrom: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock database methods
    mockSelectFrom = vi.fn();
    mockDeleteFrom = vi.fn();

    mockDatabase = {
      selectFrom: mockSelectFrom,
      deleteFrom: mockDeleteFrom,
    } as unknown as KyselyDB;

    handler = new ClearHandler(mockDatabase);
  });

  describe('previewDeletion', () => {
    it('should preview deletion counts for all tables without source filter', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      // Mock count responses
      const createMockCountQuery = (count: number) => ({
        executeTakeFirst: vi.fn().mockResolvedValue({ count }),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      });

      // Set up different counts for each table
      const counts = {
        sessions: 3,
        rawData: 150,
        transactions: 100,
        links: 25,
        lots: 50,
        disposals: 20,
        calculations: 10,
      };

      const countsArray = Object.values(counts);
      let callIndex = 0;

      mockSelectFrom.mockImplementation(() => {
        const count = countsArray[callIndex++] || 0;
        return createMockCountQuery(count);
      });

      const result = await handler.previewDeletion(params);

      expect(result.isOk()).toBe(true);
      const preview = result._unsafeUnwrap();

      expect(preview.sessions).toBe(3);
      expect(preview.rawData).toBe(150);
      expect(preview.transactions).toBe(100);
      expect(preview.links).toBe(25);
      expect(preview.lots).toBe(50);
      expect(preview.disposals).toBe(20);
      expect(preview.calculations).toBe(10);
    });

    it('should preview deletion counts with source filter', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
        source: 'kraken',
      };

      const createMockCountQuery = (count: number) => ({
        executeTakeFirst: vi.fn().mockResolvedValue({ count }),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      });

      const counts = [5, 0, 50, 0, 0, 0, 0]; // sessions, raw, transactions, links, lots, disposals, calculations
      let callIndex = 0;

      mockSelectFrom.mockImplementation(() => {
        const count = counts[callIndex++] || 0;
        return createMockCountQuery(count);
      });

      const result = await handler.previewDeletion(params);

      expect(result.isOk()).toBe(true);
      const preview = result._unsafeUnwrap();
      expect(preview.sessions).toBe(5);
      expect(preview.transactions).toBe(50);
    });

    it('should handle database errors gracefully by returning zero counts', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      // Mock individual table query errors - should now propagate
      mockSelectFrom.mockImplementation(() => ({
        executeTakeFirst: vi.fn().mockRejectedValue(new Error('Database error')),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      }));

      const result = await handler.previewDeletion(params);

      // Should now return an error instead of silently returning zeros
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Database error');
    });

    it('should return zeros when count queries return empty result', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      mockSelectFrom.mockImplementation(() => ({
        executeTakeFirst: vi.fn().mockResolvedValue({}),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      }));

      const result = await handler.previewDeletion(params);

      expect(result.isOk()).toBe(true);
      const preview = result._unsafeUnwrap();
      expect(preview.sessions).toBe(0);
      expect(preview.rawData).toBe(0);
      expect(preview.transactions).toBe(0);
      expect(preview.links).toBe(0);
      expect(preview.lots).toBe(0);
      expect(preview.disposals).toBe(0);
      expect(preview.calculations).toBe(0);
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      // Setup preview deletion mock
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

      // Mock delete operations
      const mockDeleteQuery = {
        execute: vi.fn().mockResolvedValue({}),
        where: vi.fn().mockReturnThis(),
      };

      mockDeleteFrom.mockReturnValue(mockDeleteQuery);

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const clearResult = result._unsafeUnwrap();
      expect(clearResult.deleted).toBeDefined();

      // Verify delete was called for processed data tables
      expect(mockDeleteFrom).toHaveBeenCalledWith('lot_disposals');
      expect(mockDeleteFrom).toHaveBeenCalledWith('acquisition_lots');
      expect(mockDeleteFrom).toHaveBeenCalledWith('cost_basis_calculations');
      expect(mockDeleteFrom).toHaveBeenCalledWith('transaction_links');
      expect(mockDeleteFrom).toHaveBeenCalledWith('transactions');

      // Verify raw data tables were NOT deleted
      expect(mockDeleteFrom).not.toHaveBeenCalledWith('external_transaction_data');
      expect(mockDeleteFrom).not.toHaveBeenCalledWith('import_sessions');
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

      // Verify raw data tables were also deleted
      expect(mockDeleteFrom).toHaveBeenCalledWith('external_transaction_data');
      expect(mockDeleteFrom).toHaveBeenCalledWith('import_session_errors');
      expect(mockDeleteFrom).toHaveBeenCalledWith('import_sessions');
    });

    it('should execute clear for specific source', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
        source: 'kraken',
      };

      const mockWhereClause = {
        execute: vi.fn().mockResolvedValue({}),
      };

      const mockDeleteQuery = {
        execute: vi.fn().mockResolvedValue({}),
        where: vi.fn().mockReturnValue(mockWhereClause),
      };

      mockDeleteFrom.mockReturnValue(mockDeleteQuery);

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);

      // Verify source-specific where clauses were applied
      expect(mockDeleteQuery.where).toHaveBeenCalled();
    });

    it('should return early when there is no data to delete', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      // Mock preview to return zero counts
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

      // Verify no delete operations were attempted
      expect(mockDeleteFrom).not.toHaveBeenCalled();
    });

    it('should handle delete errors gracefully', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      // Mock delete to throw error
      mockDeleteFrom.mockImplementation(() => ({
        execute: vi.fn().mockRejectedValue(new Error('Delete failed')),
        where: vi.fn().mockReturnThis(),
      }));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Delete failed');
    });

    it('should handle source filter with includeRaw', async () => {
      const params: ClearHandlerParams = {
        includeRaw: true,
        source: 'ethereum',
      };

      const mockWhereClause = {
        execute: vi.fn().mockResolvedValue({}),
      };

      const mockDeleteQuery = {
        execute: vi.fn().mockResolvedValue({}),
        where: vi.fn().mockReturnValue(mockWhereClause),
      };

      mockDeleteFrom.mockReturnValue(mockDeleteQuery);

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);

      // Should delete raw data with source filter
      expect(mockDeleteFrom).toHaveBeenCalledWith('external_transaction_data');
      expect(mockDeleteFrom).toHaveBeenCalledWith('import_sessions');
    });
  });

  describe('destroy', () => {
    it('should cleanup without errors', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
