import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Kysely } from 'kysely';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

const logger = getLogger('SqliteDatabase');

/**
 * Close a Kysely database connection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely is invariant; generic param allows any schema
export async function closeSqliteDatabase(db: Kysely<any>): Promise<Result<void, Error>> {
  try {
    await db.destroy();
    logger.debug('Database connection closed');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error closing database');
    return wrapError(error, 'Failed to close database');
  }
}
