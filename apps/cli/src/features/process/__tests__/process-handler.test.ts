import type { RawDataQueries } from '@exitbook/data';
import type { ClearService, TransactionProcessingService } from '@exitbook/ingestion';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { executeReprocess } from '../process-handler.js';

describe('executeReprocess', () => {
  let mockProcessService: TransactionProcessingService;
  let mockClearService: ClearService;
  let mockRawDataQueries: RawDataQueries;

  beforeEach(() => {
    mockProcessService = {
      processImportedSessions: vi.fn().mockResolvedValue(ok({ processed: 0, errors: [], failed: 0 })),
    } as unknown as TransactionProcessingService;

    mockClearService = {
      execute: vi.fn().mockResolvedValue(
        ok({
          deleted: {
            accounts: 0,
            transactions: 0,
            links: 0,
            lots: 0,
            disposals: 0,
            calculations: 0,
            transfers: 0,
            sessions: 0,
            rawData: 0,
          },
        })
      ),
    } as unknown as ClearService;

    mockRawDataQueries = {
      getAccountsWithPendingData: vi.fn().mockResolvedValue(ok([])),
    } as unknown as RawDataQueries;
  });

  describe('Basic Execution', () => {
    test('should execute reprocess with no pending data', async () => {
      const result = await executeReprocess(
        { accountId: undefined },
        {
          transactionProcessService: mockProcessService,
          clearService: mockClearService,
          rawDataQueries: mockRawDataQueries,
        }
      );

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

      const result = await executeReprocess(
        { accountId: 123 },
        {
          transactionProcessService: mockProcessService,
          clearService: mockClearService,
          rawDataQueries: mockRawDataQueries,
        }
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.processed).toBe(5);
      }
      // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
      expect(mockProcessService.processImportedSessions).toHaveBeenCalledWith([123]);
    });
  });
});
