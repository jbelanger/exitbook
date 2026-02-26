/* eslint-disable no-restricted-imports -- ok here since this is the CLI boundary */
import path from 'node:path';

import type { KyselyDB } from '@exitbook/data';
import { closeDatabase, initializeDatabase } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { render } from 'ink';
import type React from 'react';

import { getDataDir } from './data-dir.js';

const logger = getLogger('command-runtime');

// CLI-owned database type alias used by feature handlers to avoid direct KyselyDB imports.
export type CommandDatabase = KyselyDB;

/**
 * Manages database lifecycle, SIGINT handling, and cleanup for CLI commands.
 *
 * - `database()` — lazy init; auto-closed in dispose
 * - `closeDatabase()` — early close for snapshot TUI pattern
 * - `onCleanup()` — LIFO stack, runs during dispose
 * - `onAbort()` — SIGINT: fn() sync → await dispose → exit(130)
 * - `dispose()` — remove SIGINT, run stack, close DB. Idempotent. Throws on cleanup failures.
 */
export class CommandContext {
  exitCode = 0;
  readonly dataDir: string;

  private _database?: KyselyDB | undefined;
  private _databaseClosed = false;
  private _disposed = false;
  private cleanupStack: (() => Promise<void>)[] = [];
  private sigintHandler: (() => void) | undefined;

  constructor() {
    this.dataDir = getDataDir();
  }

  /**
   * Lazy-initialize and return the database connection.
   * Throws if called after closeDatabase().
   */
  async database(): Promise<KyselyDB> {
    if (this._databaseClosed) {
      throw new Error('Database already closed');
    }
    if (!this._database) {
      const initResult = await initializeDatabase(path.join(this.dataDir, 'transactions.db'));
      if (initResult.isErr()) {
        throw initResult.error;
      }
      this._database = initResult.value;
    }
    return this._database;
  }

  /**
   * Early close for snapshot TUI pattern (load data → close → render).
   * Prevents dispose() from closing again.
   */
  async closeDatabase(): Promise<void> {
    if (this._database && !this._databaseClosed) {
      const closeResult = await closeDatabase(this._database);
      if (closeResult.isErr()) {
        throw closeResult.error;
      }
      this._databaseClosed = true;
    }
  }

  /**
   * Register a cleanup function. Runs in LIFO order during dispose().
   */
  onCleanup(fn: () => Promise<void>): void {
    this.cleanupStack.push(fn);
  }

  /**
   * Register a SIGINT handler. On Ctrl-C: fn() runs synchronously,
   * then dispose fires as void promise, then process.exit(130).
   */
  onAbort(fn: () => void): void {
    // Remove any previous handler
    if (this.sigintHandler) {
      process.off('SIGINT', this.sigintHandler);
    }

    this.sigintHandler = () => {
      // Remove to prevent double-fire
      if (this.sigintHandler) {
        process.off('SIGINT', this.sigintHandler);
      }

      // Run sync abort callback (e.g. controller.abort())
      try {
        fn();
      } catch (error) {
        logger.error({ error }, 'Abort callback threw during SIGINT');
      }

      // Await dispose before exiting so cleanup actually completes
      this.dispose()
        .catch((error) => {
          logger.error({ error }, 'Error during abort dispose');
        })
        .finally(() => {
          process.exit(130);
        });
    };

    process.on('SIGINT', this.sigintHandler);
  }

  /**
   * Remove SIGINT handler, run cleanup stack (LIFO), close DB.
   * Idempotent — safe to call multiple times.
   */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;

    // Remove SIGINT handler
    if (this.sigintHandler) {
      process.off('SIGINT', this.sigintHandler);
      this.sigintHandler = undefined;
    }

    // Run cleanup stack in LIFO order (continue on failure, collect errors)
    const errors: Error[] = [];
    while (this.cleanupStack.length > 0) {
      const fn = this.cleanupStack.pop()!;
      try {
        await fn();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error({ error }, 'Cleanup function failed');
        errors.push(err);
      }
    }

    // Close DB last (if still open)
    if (this._database && !this._databaseClosed) {
      try {
        const closeResult = await closeDatabase(this._database);
        if (closeResult.isErr()) {
          throw closeResult.error;
        }
        this._databaseClosed = true;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error({ error }, 'Failed to close database during dispose');
        errors.push(err);
      }
    }

    if (errors.length === 1) {
      throw errors[0]!;
    } else if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple cleanup failures');
    }
  }
}

/**
 * Run a CLI command with automatic resource cleanup.
 *
 * Does NOT catch fn errors — they propagate to the outer catch in each command.
 * Dispose always runs. If both fn and dispose fail, the fn error takes priority
 * (dispose error is logged). If only dispose fails, that error propagates.
 */
export async function runCommand(fn: (ctx: CommandContext) => Promise<void>): Promise<void> {
  const ctx = new CommandContext();
  let fnError: unknown;

  try {
    await fn(ctx);
  } catch (error) {
    fnError = error;
  }

  try {
    await ctx.dispose();
  } catch (disposeError) {
    if (fnError) {
      logger.error({ error: disposeError }, 'Cleanup failed (original error takes priority)');
    } else {
      fnError = disposeError;
    }
  }

  if (ctx.exitCode !== 0) {
    process.exit(ctx.exitCode);
  }

  if (fnError) {
    if (fnError instanceof Error) throw fnError;
    throw new Error(typeof fnError === 'string' ? fnError : 'Command failed');
  }
}

/**
 * Render an Ink app, wait for exit, and defensively unmount.
 *
 * @param create - Receives unmount function, returns React element
 */
export async function renderApp(create: (unmount: () => void) => React.ReactElement): Promise<void> {
  let inkInstance: { unmount: () => void; waitUntilExit: () => Promise<void> } | undefined;
  try {
    const instance = render(create(() => instance?.unmount()));
    inkInstance = instance as { unmount: () => void; waitUntilExit: () => Promise<void> };
    await inkInstance.waitUntilExit();
  } finally {
    if (inkInstance) {
      try {
        inkInstance.unmount();
      } catch (error) {
        logger.warn({ error }, 'Ink unmount failed');
      }
    }
  }
}
