/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */

import type { DataSession } from '@exitbook/data/session';
import * as dataModule from '@exitbook/data/session';
import { err, ok } from '@exitbook/foundation';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandRuntime, renderApp, runCommand, withCommandPriceProviderRuntime } from '../command-runtime.js';
import { NonInteractiveTuiError } from '../interactive-terminal.js';

// Hoisted so they're accessible inside vi.mock factory
const { mockCreatePriceProviderRuntime, mockInitialize, mockInkRender } = vi.hoisted(() => ({
  mockCreatePriceProviderRuntime: vi.fn(),
  mockInitialize: vi.fn(),
  mockInkRender: vi.fn(),
}));

// Mock the DataSession class — replace with object exposing mocked static method
vi.mock('@exitbook/data/session', async () => {
  const actual = await vi.importActual('@exitbook/data/session');
  return {
    ...actual,
    DataSession: {
      initialize: mockInitialize,
    },
  };
});

vi.mock('ink', () => ({
  render: mockInkRender,
}));

vi.mock('@exitbook/price-providers', async () => {
  const actual = await vi.importActual('@exitbook/price-providers');
  return {
    ...actual,
    createPriceProviderRuntime: mockCreatePriceProviderRuntime,
  };
});

// Mock process.exit to prevent test runner from exiting
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Module-level close mock so it's accessible across both describe blocks
let mockClose: ReturnType<typeof vi.fn>;
let mockDataContext: DataSession;
let mockPriceRuntime: {
  cleanup: ReturnType<typeof vi.fn>;
  fetchPrice: ReturnType<typeof vi.fn>;
  setManualFxRate: ReturnType<typeof vi.fn>;
  setManualPrice: ReturnType<typeof vi.fn>;
};
const originalStdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalStdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

describe('CommandRuntime', () => {
  beforeEach(() => {
    mockClose = vi.fn().mockResolvedValue(ok(undefined));
    mockDataContext = { close: mockClose } as unknown as DataSession;
    mockInitialize.mockResolvedValue(ok(mockDataContext));
    mockPriceRuntime = {
      cleanup: vi.fn().mockResolvedValue(ok(undefined)),
      fetchPrice: vi.fn(),
      setManualFxRate: vi.fn().mockResolvedValue(ok(undefined)),
      setManualPrice: vi.fn().mockResolvedValue(ok(undefined)),
    };
    mockCreatePriceProviderRuntime.mockResolvedValue(ok(mockPriceRuntime));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('database()', () => {
    it('should lazily initialize database on first call', async () => {
      const ctx = new CommandRuntime();
      const db = await ctx.database();

      expect(db).toBe(mockDataContext);
      expect(dataModule.DataSession.initialize).toHaveBeenCalledOnce();
    });

    it('should return same instance on subsequent calls', async () => {
      const ctx = new CommandRuntime();
      const db1 = await ctx.database();
      const db2 = await ctx.database();

      expect(db1).toBe(db2);
      expect(dataModule.DataSession.initialize).toHaveBeenCalledOnce();
    });

    it('should throw if called after closeDatabase()', async () => {
      const ctx = new CommandRuntime();
      await ctx.database();
      await ctx.closeDatabase();

      await expect(ctx.database()).rejects.toThrow('Database already closed');
    });
  });

  describe('closeDatabase()', () => {
    it('should close database and prevent dispose from closing again', async () => {
      const ctx = new CommandRuntime();
      await ctx.database();
      await ctx.closeDatabase();
      await ctx.dispose();

      // close called once (by closeDatabase), not twice (not again by dispose)
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it('should be no-op if database was never opened', async () => {
      const ctx = new CommandRuntime();
      await ctx.closeDatabase();

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('onCleanup()', () => {
    it('should run cleanup functions in LIFO order', async () => {
      const ctx = new CommandRuntime();
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
      const ctx = new CommandRuntime();
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
      const ctx = new CommandRuntime();

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
      const ctx = new CommandRuntime();
      await ctx.database();
      await ctx.dispose();

      expect(mockClose).toHaveBeenCalled();
    });

    it('should be idempotent', async () => {
      const ctx = new CommandRuntime();
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
      const ctx = new CommandRuntime();
      await ctx.dispose();

      expect(mockClose).not.toHaveBeenCalled();
    });

    it('should throw when database close fails', async () => {
      mockClose.mockResolvedValue(err(new Error('close failed')));

      const ctx = new CommandRuntime();
      await ctx.database();

      await expect(ctx.dispose()).rejects.toThrow('close failed');
    });
  });

  describe('openPriceProviderRuntime()', () => {
    it('should throw when the raw opener fails', async () => {
      mockCreatePriceProviderRuntime.mockResolvedValue(err(new Error('price runtime init failed')));

      const ctx = new CommandRuntime();

      await expect(ctx.openPriceProviderRuntime()).rejects.toThrow('price runtime init failed');
    });
  });
});

describe('renderApp', () => {
  afterEach(() => {
    vi.clearAllMocks();
    restoreTTYFlags();
    vi.unstubAllEnvs();
  });

  it('waits one event-loop turn before waiting for Ink exit', async () => {
    setTTYFlags(true, true);

    const mockUnmount = vi.fn();
    let immediateRan = false;

    setImmediate(() => {
      immediateRan = true;
    });

    mockInkRender.mockReturnValue({
      unmount: mockUnmount,
      waitUntilExit: vi.fn(async () => {
        expect(immediateRan).toBe(true);
      }),
    });

    await renderApp(() => React.createElement('mock-app'));

    expect(mockInkRender).toHaveBeenCalledOnce();
    expect(mockUnmount).toHaveBeenCalled();
  });

  it('fails before mounting Ink when the terminal is non-interactive', async () => {
    setTTYFlags(true, false);

    await expect(renderApp(() => React.createElement('mock-app'))).rejects.toBeInstanceOf(NonInteractiveTuiError);
    expect(mockInkRender).not.toHaveBeenCalled();
  });

  it('does not throw if the provided unmount callback is called before Ink instance assignment', async () => {
    setTTYFlags(true, true);

    mockInkRender.mockReturnValue({
      unmount: vi.fn(),
      waitUntilExit: vi.fn(async () => undefined),
    });

    await expect(
      renderApp((unmount) => {
        unmount();
        return React.createElement('mock-app');
      })
    ).resolves.toBeUndefined();
  });
});

describe('runCommand', () => {
  beforeEach(() => {
    mockClose = vi.fn().mockResolvedValue(ok(undefined));
    mockDataContext = { close: mockClose } as unknown as DataSession;
    mockInitialize.mockResolvedValue(ok(mockDataContext));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should run function and dispose context', async () => {
    let dbRef: DataSession | undefined;

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

describe('withCommandPriceProviderRuntime', () => {
  beforeEach(() => {
    mockPriceRuntime = {
      cleanup: vi.fn().mockResolvedValue(ok(undefined)),
      fetchPrice: vi.fn(),
      setManualFxRate: vi.fn().mockResolvedValue(ok(undefined)),
      setManualPrice: vi.fn().mockResolvedValue(ok(undefined)),
    };
    mockCreatePriceProviderRuntime.mockResolvedValue(ok(mockPriceRuntime));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('cleans up the runtime even when the operation throws', async () => {
    const ctx = new CommandRuntime();

    await expect(
      withCommandPriceProviderRuntime(ctx, undefined, async () => {
        throw new Error('operation failed');
      })
    ).rejects.toThrow('operation failed');

    expect(mockPriceRuntime.cleanup).toHaveBeenCalledOnce();
  });

  it('throws an aggregate error when operation and cleanup both fail', async () => {
    mockPriceRuntime.cleanup.mockResolvedValue(err(new Error('cleanup failed')));

    const ctx = new CommandRuntime();
    await expect(
      withCommandPriceProviderRuntime(ctx, undefined, async () => {
        throw new Error('operation failed');
      })
    ).rejects.toThrow('Price provider runtime operation failed');
  });
});

function setTTYFlags(stdinIsTTY: boolean, stdoutIsTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: stdinIsTTY,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: stdoutIsTTY,
  });
}

function restoreTTYFlags(): void {
  if (originalStdinTTYDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', originalStdinTTYDescriptor);
  }

  if (originalStdoutTTYDescriptor) {
    Object.defineProperty(process.stdout, 'isTTY', originalStdoutTTYDescriptor);
  }
}
