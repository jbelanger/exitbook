/* eslint-disable unicorn/no-null -- db requires explicit null */
import type { ImportSession } from '@exitbook/data';
import type { ImportSessionRepository } from '@exitbook/import';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ViewSessionsHandler } from '../view-sessions-handler.ts';
import type { ViewSessionsParams } from '../view-sessions-utils.ts';

describe('ViewSessionsHandler', () => {
  let mockSessionRepo: ImportSessionRepository;
  let handler: ViewSessionsHandler;
  let mockFindAll: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock function
    mockFindAll = vi.fn();

    // Mock repository
    mockSessionRepo = {
      findAll: mockFindAll,
    } as unknown as ImportSessionRepository;

    handler = new ViewSessionsHandler(mockSessionRepo);
  });

  const createMockSession = (overrides: Partial<ImportSession> = {}): ImportSession => ({
    id: 1,
    source_id: 'kraken',
    source_type: 'exchange',
    provider_id: null,
    status: 'completed',
    transactions_imported: 10,
    transactions_failed: 0,
    started_at: '2024-01-01T00:00:00Z',
    completed_at: '2024-01-01T00:01:00Z',
    duration_ms: 60000,
    error_message: null,
    error_details: null,
    import_params: {},
    import_result_metadata: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  });

  describe('execute', () => {
    it('should return formatted sessions successfully', async () => {
      const mockSessions: ImportSession[] = [
        createMockSession({ id: 1, source_id: 'kraken' }),
        createMockSession({
          id: 2,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          provider_id: 'blockstream',
          started_at: '2024-01-02T00:00:00Z',
          completed_at: '2024-01-02T00:05:00Z',
          duration_ms: 300000,
          transactions_imported: 5,
          created_at: '2024-01-02T00:00:00Z',
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockSessions));

      const params: ViewSessionsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value.count).toBe(2);
      expect(value.sessions).toHaveLength(2);
      expect(value.sessions[0]).toEqual({
        id: 1,
        source_id: 'kraken',
        source_type: 'exchange',
        provider_id: undefined,
        status: 'completed',
        transactions_imported: 10,
        transactions_failed: 0,
        started_at: '2024-01-01T00:00:00Z',
        completed_at: '2024-01-01T00:01:00Z',
        duration_ms: 60000,
        error_message: undefined,
      });
    });

    it('should filter sessions by source', async () => {
      const mockSessions: ImportSession[] = [createMockSession({ source_id: 'kraken' })];

      mockFindAll.mockResolvedValue(ok(mockSessions));

      const params: ViewSessionsParams = { source: 'kraken' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockFindAll).toHaveBeenCalledWith({
        sourceId: 'kraken',
        status: undefined,
        limit: undefined,
      });
    });

    it('should filter sessions by status', async () => {
      const mockSessions: ImportSession[] = [
        createMockSession({
          status: 'failed',
          transactions_imported: 0,
          transactions_failed: 5,
          error_message: 'Connection timeout',
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockSessions));

      const params: ViewSessionsParams = { status: 'failed' };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockFindAll).toHaveBeenCalledWith({
        sourceId: undefined,
        status: 'failed',
        limit: undefined,
      });

      const value = result._unsafeUnwrap();
      expect(value.sessions[0]?.error_message).toBe('Connection timeout');
    });

    it('should limit number of sessions', async () => {
      const mockSessions: ImportSession[] = [createMockSession()];

      mockFindAll.mockResolvedValue(ok(mockSessions));

      const params: ViewSessionsParams = { limit: 10 };
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockFindAll).toHaveBeenCalledWith({
        sourceId: undefined,
        status: undefined,
        limit: 10,
      });
    });

    it('should return empty array when no sessions found', async () => {
      mockFindAll.mockResolvedValue(ok([]));

      const params: ViewSessionsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.count).toBe(0);
      expect(value.sessions).toEqual([]);
    });

    it('should return error when repository fails', async () => {
      const error = new Error('Database connection failed');
      mockFindAll.mockResolvedValue(err(error));

      const params: ViewSessionsParams = {};
      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(error);
    });

    it('should handle sessions with all optional fields null', async () => {
      const mockSessions: ImportSession[] = [
        createMockSession({
          provider_id: null,
          status: 'started',
          transactions_imported: 0,
          completed_at: null,
          duration_ms: null,
          error_message: null,
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockSessions));

      const params: ViewSessionsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.sessions[0]?.completed_at).toBeUndefined();
      expect(value.sessions[0]?.duration_ms).toBeUndefined();
      expect(value.sessions[0]?.error_message).toBeUndefined();
    });

    it('should handle combined filters', async () => {
      const mockSessions: ImportSession[] = [];
      mockFindAll.mockResolvedValue(ok(mockSessions));

      const params: ViewSessionsParams = {
        source: 'bitcoin',
        status: 'completed',
        limit: 25,
      };

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockFindAll).toHaveBeenCalledWith({
        sourceId: 'bitcoin',
        status: 'completed',
        limit: 25,
      });
    });
  });

  describe('destroy', () => {
    it('should not throw error when called', () => {
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
