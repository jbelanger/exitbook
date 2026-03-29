import * as fs from 'node:fs';
import * as path from 'node:path';

import { wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, type KyselyPlugin } from 'kysely';

import { sqliteTypeAdapterPlugin } from './plugins/sqlite-type-adapter-plugin.js';

const logger = getLogger('SqliteDatabase');

const BETTER_SQLITE3_NATIVE_MODULE_HINT = 'Failed to load better-sqlite3 native module';
const BETTER_SQLITE3_REBUILD_COMMAND = 'pnpm rebuild better-sqlite3';

export interface CreateSqliteDatabaseOptions {
  /** Additional Kysely plugins (sqliteTypeAdapterPlugin is always applied) */
  plugins?: KyselyPlugin[] | undefined;
}

/**
 * Create and configure a SQLite-backed Kysely database instance.
 *
 * Always applies the sqliteTypeAdapterPlugin (boolean→0/1, undefined→null).
 * Pass additional plugins via options.plugins.
 */
export function createSqliteDatabase<T>(
  dbPath: string,
  options?: CreateSqliteDatabaseOptions
): Result<Kysely<T>, Error> {
  try {
    const dataDir = path.dirname(dbPath);
    if (dbPath !== ':memory:' && !fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const sqliteDb = new Database(dbPath);

    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('synchronous = NORMAL');
    sqliteDb.pragma('cache_size = 10000');
    sqliteDb.pragma('temp_store = memory');

    logger.debug(`Connected to SQLite database: ${dbPath}`);

    const plugins = [sqliteTypeAdapterPlugin, ...(options?.plugins ?? [])];

    let kysely = new Kysely<T>({
      dialect: new SqliteDialect({ database: sqliteDb }),
    });

    for (const plugin of plugins) {
      kysely = kysely.withPlugin(plugin);
    }

    return ok(kysely);
  } catch (error) {
    logger.error({ error }, `Error creating SQLite database: ${dbPath}`);
    return wrapError(error, getSqliteDatabaseErrorContext(dbPath, error));
  }
}

function getSqliteDatabaseErrorContext(dbPath: string, error: unknown): string {
  const baseContext = `Failed to create SQLite database: ${dbPath}`;

  if (!(error instanceof Error)) {
    return baseContext;
  }

  const errorMessage = error.message.toLowerCase();

  if (isBetterSqliteBinaryMismatchError(errorMessage)) {
    return `${baseContext}. ${BETTER_SQLITE3_NATIVE_MODULE_HINT}. This usually means node_modules contains a binary built for a different OS, CPU architecture, or runtime. Rebuild it with \`${BETTER_SQLITE3_REBUILD_COMMAND}\` or reinstall dependencies on this machine.`;
  }

  if (isBetterSqliteNodeAbiMismatchError(errorMessage)) {
    return `${baseContext}. ${BETTER_SQLITE3_NATIVE_MODULE_HINT}. The installed binary was compiled for a different Node.js version. Rebuild it with \`${BETTER_SQLITE3_REBUILD_COMMAND}\` after switching Node versions.`;
  }

  return baseContext;
}

function isBetterSqliteBinaryMismatchError(errorMessage: string): boolean {
  return (
    mentionsBetterSqliteNativeModule(errorMessage) &&
    [
      'slice is not valid mach-o file',
      'not a mach-o file',
      'invalid elf header',
      'wrong elf class',
      'exec format error',
    ].some((pattern) => errorMessage.includes(pattern))
  );
}

function isBetterSqliteNodeAbiMismatchError(errorMessage: string): boolean {
  return (
    mentionsBetterSqliteNativeModule(errorMessage) &&
    ['node_module_version', 'module version mismatch', 'compiled against a different node.js version'].some((pattern) =>
      errorMessage.includes(pattern)
    )
  );
}

function mentionsBetterSqliteNativeModule(errorMessage: string): boolean {
  return errorMessage.includes('better_sqlite3.node') || errorMessage.includes('better-sqlite3');
}
