import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { closeSqliteDatabase, createSqliteDatabase, runMigrations as runSqliteMigrations } from '@exitbook/sqlite';
import type { Kysely } from '@exitbook/sqlite';

import type { DatabaseSchema } from './database-schema.js';
import * as initialSchema from './migrations/001_initial_schema.js';

export type KyselyDB = Kysely<DatabaseSchema>;

const initLogger = getLogger('DatabaseInitialization');
const migrationsLogger = getLogger('Migrations');

const migrations = {
  '001_initial_schema': initialSchema,
};

export function createDatabase(dbPath: string): Result<KyselyDB, Error> {
  return createSqliteDatabase<DatabaseSchema>(dbPath);
}

export async function closeDatabase(db: KyselyDB): Promise<Result<void, Error>> {
  return closeSqliteDatabase(db);
}

export async function runMigrations(db: KyselyDB): Promise<Result<void, Error>> {
  const result = await runSqliteMigrations(db, migrations);
  if (result.isOk()) {
    migrationsLogger.debug('Migrations completed');
  }
  return result;
}

export async function initializeDatabase(dbPath: string): Promise<Result<KyselyDB, Error>> {
  initLogger.debug('Initializing database...');

  const databaseResult = createDatabase(dbPath);
  if (databaseResult.isErr()) {
    return databaseResult;
  }

  const database = databaseResult.value;

  const migrationResult = await runMigrations(database);
  if (migrationResult.isErr()) {
    const closeResult = await closeDatabase(database);
    if (closeResult.isErr()) {
      initLogger.warn({ error: closeResult.error }, 'Failed to close database after migration failure');
    }
    return err(migrationResult.error);
  }

  initLogger.debug('Database initialization completed');
  return ok(database);
}
