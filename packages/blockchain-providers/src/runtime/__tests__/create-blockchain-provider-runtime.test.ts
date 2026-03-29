import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateProviderRegistry,
  mockInitProviderStatsPersistence,
  mockInitTokenMetadataPersistence,
  mockLoadPersistedStats,
  mockProviderDestroy,
  mockStartBackgroundTasks,
} = vi.hoisted(() => ({
  mockCreateProviderRegistry: vi.fn(),
  mockInitProviderStatsPersistence: vi.fn(),
  mockInitTokenMetadataPersistence: vi.fn(),
  mockLoadPersistedStats: vi.fn(),
  mockProviderDestroy: vi.fn(),
  mockStartBackgroundTasks: vi.fn(),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../initialize.js', () => ({
  createProviderRegistry: mockCreateProviderRegistry,
}));

vi.mock('../../provider-stats/persistence/runtime.js', () => ({
  initProviderStatsPersistence: mockInitProviderStatsPersistence,
}));

vi.mock('../../token-metadata/persistence/runtime.js', () => ({
  initTokenMetadataPersistence: mockInitTokenMetadataPersistence,
}));

vi.mock('../manager/provider-manager.js', () => ({
  BlockchainProviderManager: class MockBlockchainProviderManager {
    destroy = mockProviderDestroy;
    loadPersistedStats = mockLoadPersistedStats;
    startBackgroundTasks = mockStartBackgroundTasks;

    constructor() {
      // No-op; method mocks control behavior in tests.
    }
  },
}));

import { createBlockchainProviderRuntime } from '../create-blockchain-provider-runtime.js';

describe('createBlockchainProviderRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateProviderRegistry.mockReturnValue({});
    mockProviderDestroy.mockResolvedValue(undefined);
    mockLoadPersistedStats.mockResolvedValue(undefined);
    mockStartBackgroundTasks.mockImplementation(() => undefined);
    mockInitProviderStatsPersistence.mockResolvedValue(
      ok({
        cleanup: vi.fn().mockResolvedValue(undefined),
        database: {},
        queries: {},
      })
    );
    mockInitTokenMetadataPersistence.mockResolvedValue(
      ok({
        cleanup: vi.fn().mockResolvedValue(undefined),
        database: {},
        queries: {},
      })
    );
  });

  it('wraps initialization failures with runtime-specific context', async () => {
    mockLoadPersistedStats.mockRejectedValueOnce(new Error('stats load failed'));

    const result = await createBlockchainProviderRuntime({ dataDir: '/tmp/test-runtime' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Failed to create blockchain provider runtime');
      expect(result.error.cause).toBeInstanceOf(Error);
      expect(result.error.cause).toMatchObject({ message: 'stats load failed' });
    }

    expect(mockStartBackgroundTasks).toHaveBeenCalledOnce();
    expect(mockProviderDestroy).toHaveBeenCalledOnce();
  });

  it('preserves cleanup failures when startup abort cleanup also fails', async () => {
    mockLoadPersistedStats.mockRejectedValueOnce(new Error('stats load failed'));
    mockProviderDestroy.mockRejectedValueOnce(new Error('destroy failed'));

    const result = await createBlockchainProviderRuntime({ dataDir: '/tmp/test-runtime' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AggregateError);
      const aggregateError = result.error as AggregateError;
      expect(aggregateError.errors).toHaveLength(2);
      expect((aggregateError.errors[0] as Error).message).toContain('Failed to create blockchain provider runtime');
      expect((aggregateError.errors[1] as Error).message).toBe('destroy failed');
    }
  });

  it('continues without persisted stats when stats persistence is unavailable', async () => {
    mockInitProviderStatsPersistence.mockResolvedValueOnce(err(new Error('stats unavailable')));

    const result = await createBlockchainProviderRuntime({ dataDir: '/tmp/test-runtime' });

    expect(result.isOk()).toBe(true);
    expect(mockLoadPersistedStats).not.toHaveBeenCalled();
  });
});
