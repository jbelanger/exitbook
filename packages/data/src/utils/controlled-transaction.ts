import { wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';
import type { ControlledTransaction, Kysely } from '@exitbook/sqlite';

export async function withControlledTransaction<T, TDB>(
  db: Kysely<TDB>,
  logger: Logger,
  fn: (trx: ControlledTransaction<TDB>) => Promise<Result<T, Error>>,
  errorContext: string
): Promise<Result<T, Error>> {
  let trx: ControlledTransaction<TDB> | undefined;

  try {
    trx = await db.startTransaction().execute();
    const result = await fn(trx);

    if (result.isErr()) {
      await trx.rollback().execute();
      return result;
    }

    await trx.commit().execute();
    return result;
  } catch (error) {
    if (trx) {
      try {
        await trx.rollback().execute();
      } catch (rollbackError) {
        logger.error({ rollbackError }, 'Failed to rollback controlled transaction');
      }
    }
    return wrapError(error, errorContext);
  }
}
