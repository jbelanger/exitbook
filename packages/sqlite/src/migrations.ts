import { isErrorWithMessage, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { Kysely, Migrator, type Migration } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

const logger = getLogger('SqliteMigrations');

/**
 * Run all pending migrations from a programmatic migration record.
 *
 * Accepts a `Record<string, Migration>` keyed by migration name (e.g. '001_initial_schema').
 * Uses a programmatic provider instead of FileMigrationProvider to avoid dynamic `import()`
 * which fails under Vitest (native Node resolution can't resolve .js→.ts in workspace packages).
 */

export async function runMigrations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely is invariant; generic param allows any schema
  db: Kysely<any>,
  migrations: Record<string, Migration>
): Promise<Result<void, Error>> {
  try {
    logger.debug(`Running migrations (${Object.keys(migrations).length} registered)`);

    const migrator = new Migrator({
      db,
      provider: { getMigrations: () => Promise.resolve(migrations) },
    });

    const { error, results } = await migrator.migrateToLatest();

    if (results && results.length > 0) {
      for (const result of results) {
        if (result.status === 'Success') {
          logger.debug(`Migration "${result.migrationName}" executed successfully`);
        } else if (result.status === 'Error') {
          logger.error(`Migration "${result.migrationName}" failed`);
        }
      }
    } else {
      logger.debug('No pending migrations');
    }

    if (error) {
      logger.error({ error }, 'Migration failed');
      const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown migration error';
      return err(new Error(errorMessage));
    }

    return ok();
  } catch (error) {
    logger.error({ error }, 'Error running migrations');
    return wrapError(error, 'Failed to run migrations');
  }
}
