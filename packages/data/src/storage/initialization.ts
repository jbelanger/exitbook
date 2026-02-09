import { getLogger } from '@exitbook/logger';

import { createDatabase, type KyselyDB } from './database.js';
import { runMigrations } from './migrations.js';

const logger = getLogger('DatabaseInitialization');

/**
 * Initialize database with migrations
 */
export async function initializeDatabase(dbPath: string): Promise<KyselyDB> {
  logger.debug('Initializing database...');

  const database = createDatabase(dbPath);

  // Run migrations to ensure schema is up to date
  await runMigrations(database);

  logger.debug('Database initialization completed');
  return database;
}
