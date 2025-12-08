import type { ClearService } from '@exitbook/ingestion';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ClearHandler } from '../clear-handler.js';
import type { ClearHandlerParams } from '../clear-utils.js';

describe('ClearHandler', () => {
  let mockClearService: ClearService;
  let handler: ClearHandler;
  let previewDeletionMock: Mock;
  let executeMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock functions
    previewDeletionMock = vi.fn();
    executeMock = vi.fn();

    // Create the ClearService mock
    mockClearService = {
      previewDeletion: previewDeletionMock,
      execute: executeMock,
    } as unknown as ClearService;

    handler = new ClearHandler(mockClearService);
  });

  describe('previewDeletion', () => {
    it('should preview deletion counts for all tables', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      const mockPreview = {
        sessions: 3,
        rawData: 150,
        transactions: 100,
        links: 25,
        lots: 50,
        disposals: 20,
        transfers: 15,
        calculations: 10,
      };

      previewDeletionMock.mockResolvedValue(ok(mockPreview));

      const result = await handler.previewDeletion(params);

      expect(result.isOk()).toBe(true);
      const preview = result._unsafeUnwrap();
      expect(preview.sessions).toBe(3);
      expect(preview.rawData).toBe(150);
      expect(preview.transactions).toBe(100);
      expect(preview.transfers).toBe(15);

      // Verify service was called with correct params
      expect(previewDeletionMock).toHaveBeenCalledWith({
        accountId: undefined,
        source: undefined,
        includeRaw: false,
      });
    });

    it('should use subquery for raw_transactions when filtering by account', async () => {
      const params: ClearHandlerParams = {
        accountId: 1,
        includeRaw: false,
      };

      const mockPreview = {
        sessions: 10,
        rawData: 10,
        transactions: 10,
        links: 10,
        lots: 10,
        disposals: 10,
        transfers: 10,
        calculations: 10,
      };

      previewDeletionMock.mockResolvedValue(ok(mockPreview));

      const result = await handler.previewDeletion(params);

      expect(result.isOk()).toBe(true);

      // Verify service was called with accountId
      expect(previewDeletionMock).toHaveBeenCalledWith({
        accountId: 1,
        source: undefined,
        includeRaw: false,
      });
    });
  });

  describe('execute', () => {
    it('should execute clear without including raw data', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      const mockClearResult = {
        deleted: {
          sessions: 10,
          rawData: 100,
          transactions: 10,
          links: 5,
          lots: 4,
          disposals: 3,
          transfers: 2,
          calculations: 2,
        },
      };

      executeMock.mockResolvedValue(ok(mockClearResult));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);

      // Verify service was called with correct params
      expect(executeMock).toHaveBeenCalledWith({
        accountId: undefined,
        source: undefined,
        includeRaw: false,
      });
    });

    it('should execute clear including raw data', async () => {
      const params: ClearHandlerParams = {
        includeRaw: true,
      };

      const mockClearResult = {
        deleted: {
          sessions: 10,
          rawData: 100,
          transactions: 10,
          links: 5,
          lots: 4,
          disposals: 3,
          transfers: 2,
          calculations: 2,
        },
      };

      executeMock.mockResolvedValue(ok(mockClearResult));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);

      // Verify service was called with includeRaw: true
      expect(executeMock).toHaveBeenCalledWith({
        accountId: undefined,
        source: undefined,
        includeRaw: true,
      });
    });

    it('should execute clear for specific source', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
        source: 'kraken',
      };

      const mockClearResult = {
        deleted: {
          sessions: 10,
          rawData: 100,
          transactions: 10,
          links: 5,
          lots: 4,
          disposals: 3,
          transfers: 2,
          calculations: 2,
        },
      };

      executeMock.mockResolvedValue(ok(mockClearResult));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);

      // Verify service was called with source
      expect(executeMock).toHaveBeenCalledWith({
        accountId: undefined,
        source: 'kraken',
        includeRaw: false,
      });
    });

    it('should return early when there is no data to delete', async () => {
      const params: ClearHandlerParams = {
        includeRaw: false,
      };

      const mockClearResult = {
        deleted: {
          sessions: 0,
          rawData: 0,
          transactions: 0,
          links: 0,
          lots: 0,
          disposals: 0,
          transfers: 0,
          calculations: 0,
        },
      };

      (mockClearService.execute as Mock).mockResolvedValue(ok(mockClearResult));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const clearResult = result._unsafeUnwrap();
      expect(clearResult.deleted.sessions).toBe(0);
      expect(clearResult.deleted.transactions).toBe(0);
    });
  });

  describe('destroy', () => {
    it('should cleanup without errors', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
