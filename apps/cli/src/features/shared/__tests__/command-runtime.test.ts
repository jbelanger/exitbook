/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */
/* eslint-disable @typescript-eslint/require-await -- Acceptable for tests */
import type { DataContext } from '@exitbook/data';
import * as dataModule from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandContext, runCommand } from '../command-runtime.js';

// Hoisted so they're accessible inside vi.mock factory
const { mockInitialize } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
}));

// Mock the DataContext class — replace with object exposing mocked static method
vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual('@exitbook/data');
  return {
    ...actual,
    DataContext: {
      initialize: mockInitialize,
    },
  };
});

// Mock process.exit to prevent test runner from exiting
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Module-level close mock so it's accessible across both describe blocks
let mockClose: ReturnType<typeof vi.fn>;
let mockDataContext: DataContext;

describe('CommandContext', () => {
  beforeEach(() => {
    mockClose = vi.fn().mockResolvedValue(ok(undefined));
    mockDataContext = { close: mockClose } as unknown as DataContext;
    mockInitialize.mockResolvedValue(ok(mockDataContext));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('database()', () => {
    it('should lazily initialize database on first call', async () => {
      const ctx = new CommandContext();
      const db = await ctx.database();

      expect(db).toBe(mockDataContext);
      expect(dataModule.DataContext.initialize).toHaveBeenCalledOnce();
    });

    it('should return same instance on subsequent calls', async () => {
      const ctx = new CommandContext();
      const db1 = await ctx.database();
      const db2 = await ctx.database();

      expect(db1).toBe(db2);
      expect(dataModule.DataContext.initialize).toHaveBeenCalledOnce();
    });

    it('should throw if called after closeDatabase()', async () => {
      const ctx = new CommandContext();
      await ctx.database();
      await ctx.closeDatabase();

      await expect(ctx.database()).rejects.toThrow('Database already closed');
    });
  });

  describe('closeDatabase()', () => {
    it('should close database and prevent dispose from closing again', async () => {
      const ctx = new CommandContext();
      await ctx.database();
      await ctx.closeDatabase();
      await ctx.dispose();

      // close called once (by closeDatabase), not twice (not again by dispose)
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it('should be no-op if database was never opened', async () => {
      const ctx = new CommandContext();
      await ctx.closeDatabase();

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('onCleanup()', () => {
    it('should run cleanup functions in LIFO order', async () => {
      const ctx = new CommandContext();
      const order: number[] = [];

      ctx.onCleanup(async () => {
        order.push(1);
      });
      ctx.onCleanup(async () => {
        order.push(2);
      });
      ctx.onCleanup(async () => {
        order.push(3);
      });

      await ctx.dispose();

      expect(order).toEqual([3, 2, 1]);
    });

    it('should continue running cleanup even if one throws, then propagate error', async () => {
      const ctx = new CommandContext();
      const order: number[] = [];

      ctx.onCleanup(async () => {
        order.push(1);
      });
      ctx.onCleanup(async () => {
        throw new Error('cleanup failed');
      });
      ctx.onCleanup(async () => {
        order.push(3);
      });

      await expect(ctx.dispose()).rejects.toThrow('cleanup failed');

      // All cleanup functions still ran
      expect(order).toEqual([3, 1]);
    });

    it('should throw AggregateError when multiple cleanup functions fail', async () => {
      const ctx = new CommandContext();

      ctx.onCleanup(async () => {
        throw new Error('first failure');
      });
      ctx.onCleanup(async () => {
        throw new Error('second failure');
      });

      await expect(ctx.dispose()).rejects.toThrow('Multiple cleanup failures');
    });
  });

  describe('dispose()', () => {
    it('should close database if still open', async () => {
      const ctx = new CommandContext();
      await ctx.database();
      await ctx.dispose();

      expect(mockClose).toHaveBeenCalled();
    });

    it('should be idempotent', async () => {
      const ctx = new CommandContext();
      const cleanupFn = vi.fn(async () => {
        /* empty */
      });
      ctx.onCleanup(cleanupFn);
      await ctx.database();

      await ctx.dispose();
      await ctx.dispose();

      expect(cleanupFn).toHaveBeenCalledOnce();
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it('should not close database if never opened', async () => {
      const ctx = new CommandContext();
      await ctx.dispose();

      expect(mockClose).not.toHaveBeenCalled();
    });

    it('should throw when database close fails', async () => {
      mockClose.mockResolvedValue(err(new Error('close failed')));

      const ctx = new CommandContext();
      await ctx.database();

      await expect(ctx.dispose()).rejects.toThrow('close failed');
    });
  });
});

describe('runCommand', () => {
  beforeEach(() => {
    mockClose = vi.fn().mockResolvedValue(ok(undefined));
    mockDataContext = { close: mockClose } as unknown as DataContext;
    mockInitialize.mockResolvedValue(ok(mockDataContext));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should run function and dispose context', async () => {
    let dbRef: DataContext | undefined;

    await runCommand(async (ctx) => {
      dbRef = await ctx.database();
    });

    expect(dbRef).toBe(mockDataContext);
    expect(mockClose).toHaveBeenCalled();
  });

  it('should dispose even if function throws', async () => {
    const testError = new Error('Test error');

    await expect(
      runCommand(async (ctx) => {
        await ctx.database();
        throw testError;
      })
    ).rejects.toThrow(testError);

    expect(mockClose).toHaveBeenCalled();
  });

  it('should call process.exit with non-zero exitCode', async () => {
    await runCommand(async (ctx) => {
      ctx.exitCode = 1;
    });

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should not call process.exit on success (exitCode 0)', async () => {
    await runCommand(async () => {
      // no-op
    });

    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should propagate dispose error when fn succeeds', async () => {
    mockClose.mockResolvedValue(err(new Error('close failed')));

    await expect(
      runCommand(async (ctx) => {
        await ctx.database();
      })
    ).rejects.toThrow('close failed');
  });

  it('should prioritize fn error over dispose error', async () => {
    mockClose.mockResolvedValue(err(new Error('close failed')));

    await expect(
      runCommand(async (ctx) => {
        await ctx.database();
        throw new Error('fn failed');
      })
    ).rejects.toThrow('fn failed');

    // DB close was still attempted
    expect(mockClose).toHaveBeenCalled();
  });
});
