import { wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Kysely } from 'kysely';

const logger = getLogger('SqliteDatabase');

/**
 * Close a Kysely database connection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely is invariant; generic param allows any schema
export async function closeSqliteDatabase(db: Kysely<any>): Promise<Result<void, Error>> {
  try {
    await db.destroy();
    logger.debug('Database connection closed');
    return ok(undefined);
  } catch (error) {
    logger.error({ error }, 'Error closing database');
    return wrapError(error, 'Failed to close database');
  }
}
