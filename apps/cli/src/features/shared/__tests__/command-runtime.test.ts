/* eslint-disable @typescript-eslint/require-await -- Acceptable for tests */
import type { KyselyDB } from '@exitbook/data';
import * as dataModule from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandContext, runCommand } from '../command-runtime.js';

// Mock the data module
vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual('@exitbook/data');
  return {
    ...actual,
    initializeDatabase: vi.fn(),
    closeDatabase: vi.fn(),
  };
});

// Mock process.exit to prevent test runner from exiting
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

describe('CommandContext', () => {
  const mockDatabase = { mock: 'database' } as unknown as KyselyDB;

  beforeEach(() => {
    vi.mocked(dataModule.initializeDatabase).mockResolvedValue(ok(mockDatabase));
    vi.mocked(dataModule.closeDatabase).mockResolvedValue(ok(undefined));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('database()', () => {
    it('should lazily initialize database on first call', async () => {
      const ctx = new CommandContext();
      const db = await ctx.database();

      expect(db).toBe(mockDatabase);
      expect(dataModule.initializeDatabase).toHaveBeenCalledOnce();
    });

    it('should return same instance on subsequent calls', async () => {
      const ctx = new CommandContext();
      const db1 = await ctx.database();
      const db2 = await ctx.database();

      expect(db1).toBe(db2);
      expect(dataModule.initializeDatabase).toHaveBeenCalledOnce();
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

      // closeDatabase called once (by closeDatabase), not twice (not again by dispose)
      expect(dataModule.closeDatabase).toHaveBeenCalledOnce();
    });

    it('should be no-op if database was never opened', async () => {
      const ctx = new CommandContext();
      await ctx.closeDatabase();

      expect(dataModule.closeDatabase).not.toHaveBeenCalled();
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

      expect(dataModule.closeDatabase).toHaveBeenCalledWith(mockDatabase);
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
      expect(dataModule.closeDatabase).toHaveBeenCalledOnce();
    });

    it('should not close database if never opened', async () => {
      const ctx = new CommandContext();
      await ctx.dispose();

      expect(dataModule.closeDatabase).not.toHaveBeenCalled();
    });

    it('should throw when database close fails', async () => {
      vi.mocked(dataModule.closeDatabase).mockResolvedValue(err(new Error('close failed')));

      const ctx = new CommandContext();
      await ctx.database();

      await expect(ctx.dispose()).rejects.toThrow('close failed');
    });
  });
});

describe('runCommand', () => {
  const mockDatabase = { mock: 'database' } as unknown as KyselyDB;

  beforeEach(() => {
    vi.mocked(dataModule.initializeDatabase).mockResolvedValue(ok(mockDatabase));
    vi.mocked(dataModule.closeDatabase).mockResolvedValue(ok(undefined));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should run function and dispose context', async () => {
    let dbRef: KyselyDB | undefined;

    await runCommand(async (ctx) => {
      dbRef = await ctx.database();
    });

    expect(dbRef).toBe(mockDatabase);
    expect(dataModule.closeDatabase).toHaveBeenCalledWith(mockDatabase);
  });

  it('should dispose even if function throws', async () => {
    const testError = new Error('Test error');

    await expect(
      runCommand(async (ctx) => {
        await ctx.database();
        throw testError;
      })
    ).rejects.toThrow(testError);

    expect(dataModule.closeDatabase).toHaveBeenCalledWith(mockDatabase);
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
    vi.mocked(dataModule.closeDatabase).mockResolvedValue(err(new Error('close failed')));

    await expect(
      runCommand(async (ctx) => {
        await ctx.database();
      })
    ).rejects.toThrow('close failed');
  });

  it('should prioritize fn error over dispose error', async () => {
    vi.mocked(dataModule.closeDatabase).mockResolvedValue(err(new Error('close failed')));

    await expect(
      runCommand(async (ctx) => {
        await ctx.database();
        throw new Error('fn failed');
      })
    ).rejects.toThrow('fn failed');

    // DB close was still attempted
    expect(dataModule.closeDatabase).toHaveBeenCalledWith(mockDatabase);
  });
});
