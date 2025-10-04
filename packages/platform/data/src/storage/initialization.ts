import { getLogger } from '@exitbook/shared-logger';

import { clearDatabase, createDatabase, type KyselyDB } from './database.js';
import { runMigrations } from './migrations.js';

const logger = getLogger('DatabaseInitialization');

/**
 * Initialize database with migrations
 */
export async function initializeDatabase(shouldClearDatabase = false): Promise<KyselyDB> {
  logger.info('Initializing database...');

  const database = createDatabase();

  if (shouldClearDatabase) {
    await clearDatabase(database);
    logger.info('Database cleared and reinitialized');
  }

  // Run migrations to ensure schema is up to date
  await runMigrations(database);

  logger.info('Database initialization completed');
  return database;
}
