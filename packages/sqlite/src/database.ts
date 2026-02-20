import * as fs from 'node:fs';
import * as path from 'node:path';

import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, type KyselyPlugin } from 'kysely';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import { sqliteTypeAdapterPlugin } from './plugins/sqlite-type-adapter-plugin.js';

const logger = getLogger('SqliteDatabase');

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
    return wrapError(error, `Failed to create SQLite database: ${dbPath}`);
  }
}
