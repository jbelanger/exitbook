import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { Migrator, runMigrations as runSqliteMigrations } from '@exitbook/sqlite';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import * as initialSchema from '../migrations/001_initial_schema.js';

import type { KyselyDB } from './db-types.js';

const logger = getLogger('Migrations');

const migrations = {
  '001_initial_schema': initialSchema,
};

/**
 * Run database migrations
 */
export async function runMigrations(db: KyselyDB): Promise<Result<void, Error>> {
  const result = await runSqliteMigrations(db, migrations);
  if (result.isOk()) {
    logger.debug('Migrations completed');
  }
  return result;
}

/**
 * Get migration status
 */
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
    logger.error({ error }, 'Failed to get migration status');
    return wrapError(error, 'Failed to get migration status');
  }
}
