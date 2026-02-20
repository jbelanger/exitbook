import { getLogger } from '@exitbook/logger';
import { Migrator, runMigrations as runSqliteMigrations } from '@exitbook/sqlite';

import * as initialSchema from '../migrations/001_initial_schema.js';

import type { KyselyDB } from './database.js';

const logger = getLogger('Migrations');

const migrations = {
  '001_initial_schema': initialSchema,
};

/**
 * Run database migrations
 */
export async function runMigrations(db: KyselyDB): Promise<void> {
  const result = await runSqliteMigrations(db, migrations);
  if (result.isErr()) {
    throw result.error;
  }

  logger.debug('Migrations completed');
}

/**
 * Get migration status
 */
export async function getMigrationStatus(db: KyselyDB): Promise<{ executed: string[]; pending: string[] }> {
  try {
    const migrator = new Migrator({
      db,
      provider: { getMigrations: () => Promise.resolve(migrations) },
    });

    const allMigrations = await migrator.getMigrations();

    const pending = allMigrations.filter((m) => m.executedAt === undefined).map((m) => m.name);
    const executed = allMigrations.filter((m) => m.executedAt !== undefined).map((m) => m.name);

    return { executed, pending };
  } catch (error) {
    logger.error({ error }, 'Failed to get migration status');
    throw error;
  }
}
