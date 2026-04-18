/* eslint-disable unicorn/no-null -- null required for db */
import type { ImportSession, ImportSessionStatus } from '@exitbook/core';
import { wrapError } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Selectable, Updateable } from '@exitbook/sqlite';

import type { ImportSessionsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { parseJson, serializeToJson } from '../utils/json-column-codec.js';
import { chunkItems, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';

import { BaseRepository } from './base-repository.js';

function toImportSession(row: Selectable<ImportSessionsTable>): Result<ImportSession, Error> {
  const errorDetailsResult = parseJson(row.error_details);
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

export class ImportSessionRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'import-session-repository');
  }

  async create(accountId: number): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .insertInto('import_sessions')
        .values({
          account_id: accountId,
          created_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
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
      const currentTimestamp = new Date().toISOString();
      const serializedErrorDetails = serializeToJson(errorDetails);
      if (serializedErrorDetails.isErr()) {
        return err(serializedErrorDetails.error);
      }

      await this.db
        .updateTable('import_sessions')
        .set({
          completed_at: currentTimestamp,
          duration_ms: durationMs,
          error_details: serializedErrorDetails.value ?? null,
          error_message: errorMessage,
          status,
          transactions_imported: transactionsImported,
          transactions_skipped: transactionsSkipped,
          updated_at: currentTimestamp,
        })
        .where('id', '=', sessionId)
        .execute();
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to finalize import session');
    }
  }

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

      const result = toImportSession(row);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to find import session by ID');
    }
  }

  async findAll(filters?: { accountIds?: number[] }): Promise<Result<ImportSession[], Error>> {
    try {
      if (filters?.accountIds !== undefined && filters.accountIds.length === 0) {
        return ok([]);
      }

      const rows: Selectable<ImportSessionsTable>[] = [];
      if (filters?.accountIds !== undefined) {
        for (const accountIdBatch of chunkItems(filters.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
          rows.push(
            ...(await this.db
              .selectFrom('import_sessions')
              .selectAll()
              .where('account_id', 'in', accountIdBatch)
              .orderBy('started_at', 'desc')
              .execute())
          );
        }
      } else {
        rows.push(...(await this.db.selectFrom('import_sessions').selectAll().orderBy('started_at', 'desc').execute()));
      }

      rows.sort((left, right) => right.started_at.localeCompare(left.started_at));

      const importSessions: ImportSession[] = [];
      for (const row of rows) {
        const sessionResult = toImportSession(row);
        if (sessionResult.isErr()) {
          return err(sessionResult.error);
        }
        importSessions.push(sessionResult.value);
      }

      return ok(importSessions);
    } catch (error) {
      return wrapError(error, 'Failed to find import sessions');
    }
  }

  async countByAccount(accountIds: number[]): Promise<Result<Map<number, number>, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(new Map());
      }

      const counts = new Map<number, number>();

      for (const accountIdBatch of chunkItems(accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
        const results = await this.db
          .selectFrom('import_sessions')
          .select(['account_id', (eb) => eb.fn.count<number>('id').as('count')])
          .where('account_id', 'in', accountIdBatch)
          .groupBy('account_id')
          .execute();

        for (const row of results) {
          counts.set(row.account_id, row.count);
        }
      }

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

  async update(sessionId: number, updates: Updateable<ImportSessionsTable>): Promise<Result<void, Error>> {
    try {
      const currentTimestamp = new Date().toISOString();
      const updateData: Updateable<ImportSessionsTable> = {
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
        const serializedErrorDetails = serializeToJson(updates.error_details);
        if (serializedErrorDetails.isErr()) {
          return err(serializedErrorDetails.error);
        }
        updateData.error_details = serializedErrorDetails.value ?? null;
      }

      if (updates.transactions_imported !== undefined) {
        updateData.transactions_imported = updates.transactions_imported;
      }

      if (updates.transactions_skipped !== undefined) {
        updateData.transactions_skipped = updates.transactions_skipped;
      }

      const hasChanges = Object.keys(updateData).length > 1;
      if (!hasChanges) {
        return ok(undefined);
      }

      await this.db.updateTable('import_sessions').set(updateData).where('id', '=', sessionId).execute();

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error, sessionId }, 'Failed to update import session');
      return wrapError(error, 'Failed to update import session');
    }
  }

  async count(filters?: { accountIds?: number[] }): Promise<Result<number, Error>> {
    try {
      const query = this.db.selectFrom('import_sessions').select(({ fn }) => [fn.count<number>('id').as('count')]);

      if (filters?.accountIds !== undefined) {
        if (filters.accountIds.length === 0) {
          return ok(0);
        }
        let totalCount = 0;
        for (const accountIdBatch of chunkItems(filters.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
          const result = await this.db
            .selectFrom('import_sessions')
            .select(({ fn }) => [fn.count<number>('id').as('count')])
            .where('account_id', 'in', accountIdBatch)
            .executeTakeFirst();
          totalCount += result?.count ?? 0;
        }
        return ok(totalCount);
      }

      const result = await query.executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      return wrapError(error, 'Failed to count import sessions');
    }
  }

  async deleteBy(filters?: { accountId?: number }): Promise<Result<void, Error>> {
    try {
      let query = this.db.deleteFrom('import_sessions');

      if (filters?.accountId !== undefined) {
        query = query.where('account_id', '=', filters.accountId);
      }

      await query.execute();
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to delete import sessions');
    }
  }

  async findLatestCompletedAt(filters?: { profileId?: number | undefined }): Promise<Result<Date | null, Error>> {
    try {
      if (filters?.profileId !== undefined) {
        const result = await this.db
          .selectFrom('import_sessions')
          .innerJoin('accounts', 'accounts.id', 'import_sessions.account_id')
          .select(({ fn }) => [fn.max<string>('import_sessions.completed_at').as('latest')])
          .where('import_sessions.status', '=', 'completed')
          .where('accounts.profile_id', '=', filters.profileId)
          .executeTakeFirst();

        if (!result?.latest) {
          return ok(null);
        }

        return ok(new Date(result.latest));
      }

      const result = await this.db
        .selectFrom('import_sessions')
        .select(({ fn }) => [fn.max<string>('completed_at').as('latest')])
        .where('status', '=', 'completed')
        .executeTakeFirst();

      if (!result?.latest) {
        return ok(null);
      }

      return ok(new Date(result.latest));
    } catch (error) {
      return wrapError(error, 'Failed to get latest import session completed_at');
    }
  }

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

      const result = toImportSession(row);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to find latest incomplete import session');
    }
  }
}
