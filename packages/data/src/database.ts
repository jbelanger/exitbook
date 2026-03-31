import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { closeSqliteDatabase, createSqliteDatabase, runMigrations as runSqliteMigrations } from '@exitbook/sqlite';
import type { Kysely } from '@exitbook/sqlite';

import type { DatabaseSchema } from './database-schema.js';
import { down as initialSchemaDown, up as initialSchemaUp } from './migrations/001_initial_schema.js';
import { validateAccountFingerprintIntegrity } from './repositories/account-identity-support.js';

export type KyselyDB = Kysely<DatabaseSchema>;

const initLogger = getLogger('DatabaseInitialization');
const migrationsLogger = getLogger('Migrations');

const migrations = {
  '001_initial_schema': {
    up: initialSchemaUp,
    down: initialSchemaDown,
  },
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

  const accountIntegrityResult = await validateAccountFingerprintIntegrity(database);
  if (accountIntegrityResult.isErr()) {
    const closeResult = await closeDatabase(database);
    if (closeResult.isErr()) {
      initLogger.warn({ error: closeResult.error }, 'Failed to close database after account integrity failure');
    }
    return err(accountIntegrityResult.error);
  }

  initLogger.debug('Database initialization completed');
  return ok(database);
}
