import path from 'node:path';

import { DataContext } from '@exitbook/data/context';
import type { Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';
import { render } from 'ink';
import type React from 'react';

import {
  openCliBlockchainProviderRuntime,
  type CliBlockchainProviderRuntimeOptions,
  type OpenedCliBlockchainProviderRuntime,
} from '../features/shared/blockchain-provider-runtime.js';
import {
  openCliPriceProviderRuntime,
  type CliPriceProviderRuntimeOptions,
} from '../features/shared/cli-price-provider-runtime.js';
import { getDataDir } from '../features/shared/data-dir.js';

import type { CliAppRuntime } from './app-runtime.js';

const logger = getLogger('command-scope');

interface ResultCleanupOutcome {
  error?: Error | undefined;
  isErr(): boolean;
}

/**
 * Manages database lifecycle, SIGINT handling, and cleanup for CLI commands.
 *
 * - `database()` — lazy init; auto-closed in dispose
 * - `closeDatabase()` — early close for snapshot TUI pattern
 * - `onCleanup()` — LIFO stack, runs during dispose
 * - `openPriceProviderRuntime()` / `openBlockchainProviderRuntime()` — command-scoped runtime setup
 * - `onAbort()` — SIGINT: fn() sync → await dispose → exit(130)
 * - `dispose()` — remove SIGINT, run stack, close DB. Idempotent. Throws on cleanup failures.
 */
export class CommandScope {
  exitCode = 0;
  readonly app?: CliAppRuntime | undefined;
  readonly dataDir: string;

  private _database?: DataContext | undefined;
  private _databaseClosed = false;
  private _disposed = false;
  private cleanupStack: (() => Promise<void>)[] = [];
  private sigintHandler: (() => void) | undefined;

  constructor(app?: CliAppRuntime) {
    this.app = app;
    this.dataDir = app?.dataDir ?? getDataDir();
  }

  requireAppRuntime(): CliAppRuntime {
    if (!this.app) {
      throw new Error('CLI app runtime is required for this command. Pass appRuntime into runCommand().');
    }

    return this.app;
  }

  /**
   * Lazy-initialize and return the database connection.
   * Throws if called after closeDatabase().
   */
  async database(): Promise<DataContext> {
    if (this._databaseClosed) {
      throw new Error('Database already closed');
    }
    if (!this._database) {
      const databasePath = this.app?.databasePath ?? path.join(this.dataDir, 'transactions.db');
      const initResult = await DataContext.initialize(databasePath);
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
      const closeResult = await this._database.close();
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

  async openBlockchainProviderRuntime(
    options?: CliBlockchainProviderRuntimeOptions & { registerCleanup?: boolean | undefined }
  ): Promise<Result<OpenedCliBlockchainProviderRuntime, Error>> {
    const runtimeResult = await openCliBlockchainProviderRuntime({
      dataDir: this.dataDir,
      explorerConfig: options?.explorerConfig ?? this.app?.blockchainExplorersConfig,
      instrumentation: options?.instrumentation,
      eventBus: options?.eventBus,
    });
    if (runtimeResult.isErr()) {
      return runtimeResult;
    }

    if (options?.registerCleanup !== false) {
      this.onCleanup(adaptResultCleanup(runtimeResult.value.cleanup));
    }

    return runtimeResult;
  }

  async openPriceProviderRuntime(
    options?: CliPriceProviderRuntimeOptions & { registerCleanup?: boolean | undefined }
  ): Promise<Result<IPriceProviderRuntime, Error>> {
    const runtimeResult = await openCliPriceProviderRuntime({
      dataDir: this.dataDir,
      providers: options?.providers ?? this.app?.priceProviderConfig,
      instrumentation: options?.instrumentation,
      eventBus: options?.eventBus,
    });
    if (runtimeResult.isErr()) {
      return runtimeResult;
    }

    if (options?.registerCleanup !== false) {
      this.onCleanup(adaptResultCleanup(runtimeResult.value.cleanup));
    }

    return runtimeResult;
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
        const closeResult = await this._database.close();
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
 * Adapt a Result-returning cleanup function into CommandScope.onCleanup() shape.
 */
export function adaptResultCleanup(cleanup: () => Promise<ResultCleanupOutcome>): () => Promise<void> {
  return async () => {
    const cleanupResult = await cleanup();
    if (cleanupResult.isErr()) {
      throw cleanupResult.error ?? new Error('Cleanup failed');
    }
  };
}

/**
 * Run a CLI command with automatic resource cleanup.
 *
 * Does NOT catch fn errors — they propagate to the outer catch in each command.
 * Dispose always runs. If both fn and dispose fail, the fn error takes priority
 * (dispose error is logged). If only dispose fails, that error propagates.
 */
export async function runCommand(appRuntime: CliAppRuntime, fn: (scope: CommandScope) => Promise<void>): Promise<void>;
export async function runCommand(fn: (scope: CommandScope) => Promise<void>): Promise<void>;
export async function runCommand(
  appRuntimeOrFn: CliAppRuntime | ((scope: CommandScope) => Promise<void>),
  maybeFn?: (scope: CommandScope) => Promise<void>
): Promise<void> {
  const appRuntime = typeof appRuntimeOrFn === 'function' ? undefined : appRuntimeOrFn;
  const fn = typeof appRuntimeOrFn === 'function' ? appRuntimeOrFn : maybeFn;
  if (!fn) {
    throw new Error('runCommand() requires a command function');
  }

  const scope = new CommandScope(appRuntime);
  let fnError: unknown;

  try {
    await fn(scope);
  } catch (error) {
    fnError = error;
  }

  try {
    await scope.dispose();
  } catch (disposeError) {
    if (fnError) {
      logger.error({ error: disposeError }, 'Cleanup failed (original error takes priority)');
    } else {
      fnError = disposeError;
    }
  }

  if (scope.exitCode !== 0) {
    process.exit(scope.exitCode);
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
    // Ink enables raw stdin in useEffect/useInput after the first commit. Give that
    // one event-loop turn to run before waitUntilExit() arms beforeExit auto-unmount.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
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
