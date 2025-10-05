/* eslint-disable unicorn/no-null -- db requires null handling */
import type { KyselyDB } from '@exitbook/data';
import type { ImportSessionError } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type {
  CreateImportSessionErrorParams,
  IImportSessionErrorRepository,
} from '@exitbook/import/app/ports/import-session-error-repository.interface.ts';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * Kysely-based repository for import session error database operations.
 * Handles storage and retrieval of ImportSessionError entities using type-safe queries.
 */
export class ImportSessionErrorRepository extends BaseRepository implements IImportSessionErrorRepository {
  constructor(db: KyselyDB) {
    super(db, 'ImportSessionErrorRepository');
  }

  async create(params: CreateImportSessionErrorParams): Promise<Result<number, Error>> {
    try {
      const currentDateTime = this.getCurrentDateTimeForDB();

      const result = await this.db
        .insertInto('import_session_errors')
        .values({
          created_at: currentDateTime,
          error_details: params.errorDetails ? this.serializeToJson(params.errorDetails) : null,
          error_message: params.errorMessage,
          error_type: params.errorType,
          failed_item_data: params.failedItemData ? this.serializeToJson(params.failedItemData) : null,
          import_session_id: params.importSessionId,
          occurred_at: currentDateTime,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return ok(result.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, params }, 'Failed to create import session error');
      return err(new Error(`Failed to create import session error: ${errorMessage}`));
    }
  }

  async findBySessionId(sessionId: number): Promise<Result<ImportSessionError[], Error>> {
    try {
      const errors = await this.db
        .selectFrom('import_session_errors')
        .selectAll()
        .where('import_session_id', '=', sessionId)
        .orderBy('occurred_at', 'desc')
        .execute();

      return ok(errors);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, sessionId }, 'Failed to find import session errors');
      return err(new Error(`Failed to find import session errors: ${errorMessage}`));
    }
  }

  async findBySessionIdAndType(
    sessionId: number,
    errorType: 'validation' | 'fetch' | 'processing'
  ): Promise<Result<ImportSessionError[], Error>> {
    try {
      const errors = await this.db
        .selectFrom('import_session_errors')
        .selectAll()
        .where('import_session_id', '=', sessionId)
        .where('error_type', '=', errorType)
        .orderBy('occurred_at', 'desc')
        .execute();

      return ok(errors);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, sessionId, errorType }, 'Failed to find import session errors by type');
      return err(new Error(`Failed to find import session errors by type: ${errorMessage}`));
    }
  }

  async getErrorCount(sessionId: number): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .selectFrom('import_session_errors')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('import_session_id', '=', sessionId)
        .executeTakeFirst();

      return ok(result?.count ?? 0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, sessionId }, 'Failed to get error count');
      return err(new Error(`Failed to get error count: ${errorMessage}`));
    }
  }
}
