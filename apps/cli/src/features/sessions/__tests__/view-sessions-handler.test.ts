import type { DataSource } from '@exitbook/core';
import type { DataSourceRepository } from '@exitbook/ingestion';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ViewSessionsHandler } from '../sessions-view-handler.ts';
import type { ViewSessionsParams } from '../sessions-view-utils.ts';

describe('ViewSessionsHandler', () => {
  let mockSessionRepo: DataSourceRepository;
  let handler: ViewSessionsHandler;
  let mockFindAll: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock function
    mockFindAll = vi.fn();

    // Mock repository
    mockSessionRepo = {
      findAll: mockFindAll,
    } as unknown as DataSourceRepository;

    handler = new ViewSessionsHandler(mockSessionRepo);
  });

  const createMockSession = (overrides: Partial<DataSource> = {}): DataSource => ({
    id: 1,
    sourceId: 'kraken',
    sourceType: 'exchange',
    status: 'completed',
    startedAt: new Date('2024-01-01T00:00:00Z'),
    completedAt: new Date('2024-01-01T00:01:00Z'),
    durationMs: 60000,
    importParams: {},
    importResultMetadata: {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  });

  describe('execute', () => {
    it('should return formatted sessions successfully', async () => {
      const mockSessions: DataSource[] = [
        createMockSession({ id: 1, sourceId: 'kraken' }),
        createMockSession({
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          startedAt: new Date('2024-01-02T00:00:00Z'),
          completedAt: new Date('2024-01-02T00:05:00Z'),
          durationMs: 300000,
          createdAt: new Date('2024-01-02T00:00:00Z'),
        }),
      ];

      mockFindAll.mockResolvedValue(ok(mockSessions));

      const params: ViewSessionsParams = {};
      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();

      expect(value?.count).toBe(2);
      expect(value?.sessions).toHaveLength(2);
      expect(value?.sessions[0]).toEqual({
        id: 1,
        source_id: 'kraken',
        source_type: 'exchange',
        status: 'completed',
        started_at: '2024-01-01T00:00:00.000Z',
        completed_at: '2024-01-01T00:01:00.000Z',
        duration_ms: 60000,
        error_message: undefined,
      });
    });

    it('should filter sessions by source', async () => {
      const mockSessions: DataSource[] = [createMockSession({ sourceId: 'kraken' })];

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
      const mockSessions: DataSource[] = [
        createMockSession({
          status: 'failed',
          errorMessage: 'Connection timeout',
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
      const mockSessions: DataSource[] = [createMockSession()];

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

    it('should handle sessions with all optional fields undefined', async () => {
      const mockSessions: DataSource[] = [
        createMockSession({
          status: 'started',
          completedAt: undefined,
          durationMs: undefined,
          errorMessage: undefined,
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
      const mockSessions: DataSource[] = [];
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
