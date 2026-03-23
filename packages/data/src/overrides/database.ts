import { wrapError } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { closeSqliteDatabase, createSqliteDatabase, runMigrations, type Kysely } from '@exitbook/sqlite';

import * as initialSchema from './migrations/001_initial_schema.js';
import type { OverridesDatabaseSchema } from './schema.js';

const logger = getLogger('OverridesDatabase');

const migrations = {
  '001_initial_schema': initialSchema,
};

type OverridesDb = Kysely<OverridesDatabaseSchema>;

function createOverridesDatabase(dbPath: string): Result<OverridesDb, Error> {
  return createSqliteDatabase<OverridesDatabaseSchema>(dbPath);
}

async function initializeOverridesDatabase(dbPath: string): Promise<Result<OverridesDb, Error>> {
  const dbResult = createOverridesDatabase(dbPath);
  if (dbResult.isErr()) {
    return dbResult;
  }

  const db = dbResult.value;
  const migrationResult = await runMigrations(db, migrations);
  if (migrationResult.isErr()) {
    const closeResult = await closeSqliteDatabase(db);
    if (closeResult.isErr()) {
      logger.warn({ error: closeResult.error }, 'Failed to close overrides database after migration failure');
    }
    return err(migrationResult.error);
  }

  return ok(db);
}

async function closeOverridesDatabase(db: OverridesDb): Promise<Result<void, Error>> {
  return closeSqliteDatabase(db);
}

export async function withOverridesDatabase<T>(
  dbPath: string,
  fn: (db: OverridesDb) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  const dbResult = await initializeOverridesDatabase(dbPath);
  if (dbResult.isErr()) {
    return err(dbResult.error);
  }

  const db = dbResult.value;
  try {
    return await fn(db);
  } catch (error) {
    return wrapError(error, 'Overrides database operation failed');
  } finally {
    const closeResult = await closeOverridesDatabase(db);
    if (closeResult.isErr()) {
      logger.warn({ error: closeResult.error }, 'Failed to close overrides database');
    }
  }
}
