import type { ImportSession, ImportSessionStatus } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import type { StoredImportSession, ImportSessionUpdate } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { DatabaseSchema } from '../schema/database-schema.js';

/**
 * Interface for import session repository operations.
 */
export interface IImportSessionRepository {
  /**
   * Create a new import session for an account.
   */
  create(accountId: number): Promise<Result<number, Error>>;

  /**
   * Finalize an import session with results and status.
   */
  finalize(
    sessionId: number,
    status: Exclude<ImportSessionStatus, 'started'>,
    startTime: number,
    transactionsImported: number,
    transactionsSkipped: number,
    errorMessage?: string,
    errorDetails?: unknown
  ): Promise<Result<void, Error>>;

  /**
   * Find import session by ID.
   */
  findById(sessionId: number): Promise<Result<ImportSession | undefined, Error>>;

  /**
   * Find all import sessions for multiple accounts in one query (avoids N+1).
   */
  findByAccounts(accountIds: number[]): Promise<Result<ImportSession[], Error>>;

  /**
   * Get session counts for multiple accounts in one query (avoids N+1).
   * Returns a Map of accountId -> session count.
   */
  getSessionCountsByAccount(accountIds: number[]): Promise<Result<Map<number, number>, Error>>;

  /**
   * Find latest incomplete import session for an account to support resume.
   * Status 'started' or 'failed' indicates incomplete import.
   */
  findLatestIncomplete(accountId: number): Promise<Result<ImportSession | undefined, Error>>;

  /**
   * Update an existing import session.
   */
  update(sessionId: number, updates: ImportSessionUpdate): Promise<Result<void, Error>>;

  /**
   * Count import sessions with optional filtering.
   */
  count(filters?: { accountIds?: number[] }): Promise<Result<number, Error>>;

  /**
   * Delete all import sessions for an account.
   */
  deleteByAccount(accountId: number): Promise<Result<void, Error>>;

  /**
   * Delete all import sessions.
   */
  deleteAll(): Promise<Result<void, Error>>;
}

/**
 * Kysely-based repository for import session database operations.
 * Handles storage and retrieval of ImportSession entities using type-safe queries.
 */
export class ImportSessionRepository extends BaseRepository<DatabaseSchema> implements IImportSessionRepository {
  constructor(db: KyselyDB) {
    super(db, 'ImportSessionRepository');
  }

  /**
   * Create a new import session
   */
  async create(accountId: number): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .insertInto('import_sessions')
        .values({
          account_id: accountId,
          created_at: this.getCurrentDateTimeForDB(),
          started_at: this.getCurrentDateTimeForDB(),
          status: 'started',
          transactions_imported: 0,
          transactions_skipped: 0,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return ok(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to create import session');
    }
  }

  /**
   * Finalize an import session
   * Sets final status, duration, and transaction results
   */
  async finalize(
    sessionId: number,
    status: Exclude<ImportSessionStatus, 'started'>,
    startTime: number,
    transactionsImported: number,
    transactionsSkipped: number,
    errorMessage?: string,
    errorDetails?: unknown
  ): Promise<Result<void, Error>> {
    try {
      const durationMs = Date.now() - startTime;
      const currentTimestamp = this.getCurrentDateTimeForDB();

      await this.db
        .updateTable('import_sessions')
        .set({
          completed_at: currentTimestamp as unknown as string,
          duration_ms: durationMs,
          error_details: this.serializeToJson(errorDetails),
          error_message: errorMessage,
          status,
          transactions_imported: transactionsImported,
          transactions_skipped: transactionsSkipped,
          updated_at: currentTimestamp,
        })
        .where('id', '=', sessionId)
        .execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to finalize import session');
    }
  }

  /**
   * Find import session by ID
   */
  async findById(sessionId: number): Promise<Result<ImportSession | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('import_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      const result = this.toImportSession(row);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to find import session by ID');
    }
  }

  /**
   * Find all import sessions for multiple accounts in one query (avoids N+1).
   */
  async findByAccounts(accountIds: number[]): Promise<Result<ImportSession[], Error>> {
    try {
      if (accountIds.length === 0) {
        return ok([]);
      }

      const rows = await this.db
        .selectFrom('import_sessions')
        .selectAll()
        .where('account_id', 'in', accountIds)
        .orderBy('started_at', 'desc')
        .execute();

      // Convert rows to domain models
      const importSessions: ImportSession[] = [];
      for (const row of rows) {
        const ds = this.toImportSession(row);
        if (ds.isErr()) {
          return err(ds.error);
        }
        importSessions.push(ds.value);
      }

      return ok(importSessions);
    } catch (error) {
      return wrapError(error, 'Failed to find import sessions by accounts');
    }
  }

  /**
   * Get session counts for multiple accounts in one query (avoids N+1).
   * Returns a Map of accountId -> session count.
   */
  async getSessionCountsByAccount(accountIds: number[]): Promise<Result<Map<number, number>, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(new Map());
      }

      const results = await this.db
        .selectFrom('import_sessions')
        .select(['account_id', (eb) => eb.fn.count<number>('id').as('count')])
        .where('account_id', 'in', accountIds)
        .groupBy('account_id')
        .execute();

      const counts = new Map<number, number>();
      for (const row of results) {
        counts.set(row.account_id, row.count);
      }

      // Add zero counts for accounts with no sessions
      for (const accountId of accountIds) {
        if (!counts.has(accountId)) {
          counts.set(accountId, 0);
        }
      }

      return ok(counts);
    } catch (error) {
      return wrapError(error, 'Failed to get session counts by account');
    }
  }

  /**
   * Update import session
   */
  async update(sessionId: number, updates: ImportSessionUpdate): Promise<Result<void, Error>> {
    try {
      const currentTimestamp = this.getCurrentDateTimeForDB();
      const updateData: ImportSessionUpdate = {
        updated_at: currentTimestamp,
      };

      if (updates.status !== undefined) {
        updateData.status = updates.status;

        if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') {
          updateData.completed_at = currentTimestamp;
        }
      }

      if (updates.error_message !== undefined) {
        updateData.error_message = updates.error_message;
      }

      if (updates.error_details !== undefined) {
        const serializedErrorDetails = this.serializeToJson(updates.error_details);
        updateData.error_details = serializedErrorDetails ?? updates.error_details;
      }

      if (updates.transactions_imported !== undefined) {
        updateData.transactions_imported = updates.transactions_imported;
      }

      if (updates.transactions_skipped !== undefined) {
        updateData.transactions_skipped = updates.transactions_skipped;
      }

      // Only update if there are actual changes besides updated_at
      const hasChanges = Object.keys(updateData).length > 1;
      if (!hasChanges) {
        return ok();
      }

      await this.db.updateTable('import_sessions').set(updateData).where('id', '=', sessionId).execute();

      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to update import session');
    }
  }

  /**
   * Count import sessions with optional filtering
   */
  async count(filters?: { accountIds?: number[] }): Promise<Result<number, Error>> {
    try {
      let query = this.db.selectFrom('import_sessions').select(({ fn }) => [fn.count<number>('id').as('count')]);

      if (filters?.accountIds !== undefined) {
        if (filters.accountIds.length === 0) {
          return ok(0);
        }
        query = query.where('account_id', 'in', filters.accountIds);
      }

      const result = await query.executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      return wrapError(error, 'Failed to count import sessions');
    }
  }

  /**
   * Delete all import sessions for an account
   */
  async deleteByAccount(accountId: number): Promise<Result<void, Error>> {
    try {
      await this.db.deleteFrom('import_sessions').where('account_id', '=', accountId).execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to delete import sessions by account ID');
    }
  }

  /**
   * Delete all import sessions
   */
  async deleteAll(): Promise<Result<void, Error>> {
    try {
      await this.db.deleteFrom('import_sessions').execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to delete all import sessions');
    }
  }

  /**
   * Find latest incomplete import session for an account to support resume
   * Status 'started' or 'failed' indicates incomplete import
   */
  async findLatestIncomplete(accountId: number): Promise<Result<ImportSession | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('import_sessions')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('status', 'in', ['started', 'failed'])
        .orderBy('started_at', 'desc')
        .limit(1)
        .executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      const result = this.toImportSession(row);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to find latest incomplete import session');
    }
  }

  /**
   * Convert database row to ImportSession domain model
   * Handles JSON parsing and camelCase conversion
   */
  private toImportSession(row: StoredImportSession): Result<ImportSession, Error> {
    const errorDetailsResult = this.parseJson<unknown>(row.error_details);
    if (errorDetailsResult.isErr()) {
      return err(errorDetailsResult.error);
    }

    return ok({
      id: row.id,
      accountId: row.account_id,
      status: row.status,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
      durationMs: row.duration_ms ?? undefined,
      transactionsImported: row.transactions_imported,
      transactionsSkipped: row.transactions_skipped,
      errorMessage: row.error_message ?? undefined,
      errorDetails: errorDetailsResult.value,
    });
  }
}
