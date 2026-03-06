import { ProcessOperation } from '@exitbook/app';
import { ok } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { RawDataProcessingService } from '@exitbook/ingestion';
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('ProcessOperation', () => {
  let mockProcessService: RawDataProcessingService;
  let mockDb: DataContext;
  let operation: ProcessOperation;

  beforeEach(() => {
    mockProcessService = {
      processImportedSessions: vi.fn().mockResolvedValue(ok({ processed: 0, errors: [], failed: 0 })),
      assertNoIncompleteImports: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as RawDataProcessingService;

    mockDb = {
      rawTransactions: {
        findDistinctAccountIds: vi.fn().mockResolvedValue(ok([])),
      },
      users: {
        findOrCreateDefault: vi.fn().mockResolvedValue(ok({ id: 1 })),
      },
      accounts: {
        findAll: vi.fn().mockResolvedValue(ok([{ id: 123, identifier: 'test' }])),
      },
      transactions: {
        count: vi.fn().mockResolvedValue(ok(0)),
      },
      transactionLinks: {
        count: vi.fn().mockResolvedValue(ok(0)),
      },
      executeInTransaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          utxoConsolidatedMovements: { deleteByAccountIds: vi.fn().mockResolvedValue(ok(undefined)) },
          transactionLinks: { deleteByAccountIds: vi.fn().mockResolvedValue(ok(undefined)) },
          transactions: { deleteByAccountIds: vi.fn().mockResolvedValue(ok(undefined)) },
          rawTransactions: { resetProcessingStatus: vi.fn().mockResolvedValue(ok(undefined)) },
        };
        return fn(tx);
      }),
    } as unknown as DataContext;

    operation = new ProcessOperation(mockDb, mockProcessService);
  });

  describe('Basic Execution', () => {
    test('should return early with no pending data', async () => {
      const result = await operation.execute({ accountId: undefined });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.processed).toBe(0);
        expect(result.value.errors).toEqual([]);
      }
    });

    test('should execute reprocess with specific account ID', async () => {
      mockProcessService.processImportedSessions = vi
        .fn()
        .mockResolvedValue(ok({ processed: 5, errors: [], failed: 0 }));

      const result = await operation.execute({ accountId: 123 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.processed).toBe(5);
      }
      // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
      expect(mockProcessService.processImportedSessions).toHaveBeenCalledWith([123]);
    });
  });
});
