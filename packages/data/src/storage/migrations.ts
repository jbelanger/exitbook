import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getLogger } from '@exitbook/shared-logger';
import { FileMigrationProvider, Migrator } from 'kysely';

import type { KyselyDB } from './database.js';

const logger = getLogger('Migrations');

/**
 * Run database migrations
 */
export async function runMigrations(db: KyselyDB): Promise<void> {
  try {
    // Get the current file's directory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Create migration provider
    const migrationProvider = new FileMigrationProvider({
      fs,
      migrationFolder: path.join(__dirname, '../migrations'),
      path,
    });

    // Create migrator
    const migrator = new Migrator({
      db,
      provider: migrationProvider,
    });

    // Run migrations
    const { error, results } = await migrator.migrateToLatest();

    if (error) {
      logger.error({ error }, 'Migration failed');
      throw new Error('Migration failed');
    }

    if (!results) {
      logger.info('No migrations to run');
      return;
    }

    for (const result of results) {
      if (result.status === 'Success') {
        logger.info(`Migration "${result.migrationName}" executed successfully`);
      } else if (result.status === 'Error') {
        logger.error(`Migration "${result.migrationName}" failed`);
        throw new Error(`Migration "${result.migrationName}" failed`);
      }
    }

    logger.info(`Executed ${results.length} migrations`);
  } catch (error) {
    logger.error({ error }, 'Failed to run migrations');
    throw error;
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(db: KyselyDB): Promise<{ executed: string[]; pending: string[] }> {
  try {
    // Get the current file's directory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const migrationProvider = new FileMigrationProvider({
      fs,
      migrationFolder: path.join(__dirname, '../migrations'),
      path,
    });

    const migrator = new Migrator({
      db,
      provider: migrationProvider,
    });

    const migrations = await migrator.getMigrations();

    const pending = migrations.filter((m) => m.executedAt === undefined).map((m) => m.name);

    const executed = migrations.filter((m) => m.executedAt !== undefined).map((m) => m.name);

    return { executed, pending };
  } catch (error) {
    logger.error({ error }, 'Failed to get migration status');
    throw error;
  }
}
