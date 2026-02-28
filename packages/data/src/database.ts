import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import {
  closeSqliteDatabase,
  createSqliteDatabase,
  Migrator,
  runMigrations as runSqliteMigrations,
} from '@exitbook/sqlite';
import type { Kysely } from '@exitbook/sqlite';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

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

export async function getMigrationStatus(
  db: KyselyDB
): Promise<Result<{ executed: string[]; pending: string[] }, Error>> {
  try {
    const migrator = new Migrator({
      db,
      provider: { getMigrations: () => Promise.resolve(migrations) },
    });

    const allMigrations = await migrator.getMigrations();

    const pending = allMigrations.filter((m) => m.executedAt === undefined).map((m) => m.name);
    const executed = allMigrations.filter((m) => m.executedAt !== undefined).map((m) => m.name);

    return ok({ executed, pending });
  } catch (error) {
    migrationsLogger.error({ error }, 'Failed to get migration status');
    return wrapError(error, 'Failed to get migration status');
  }
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
