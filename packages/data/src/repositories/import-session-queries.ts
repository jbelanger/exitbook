/* eslint-disable unicorn/no-null -- null required for db */
import type { ImportSession, ImportSessionStatus } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Selectable, Updateable } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import type { ImportSessionsTable } from '../schema/database-schema.js';
import type { KyselyDB } from '../storage/database.js';
import type { ImportSessionUpdate } from '../types/data-types.js';

import { parseJson, serializeToJson } from './query-utils.js';

export function createImportSessionQueries(db: KyselyDB) {
  const logger = getLogger('import-session-queries');

  function toImportSession(row: Selectable<ImportSessionsTable>): Result<ImportSession, Error> {
    const errorDetailsResult = parseJson<unknown>(row.error_details);
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

  async function create(accountId: number): Promise<Result<number, Error>> {
    try {
      const result = await db
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

  /**
   * Finalize an import session
   * Sets final status, duration, and transaction results
   */
  async function finalize(
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

      await db
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
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to finalize import session');
    }
  }

  async function findById(sessionId: number): Promise<Result<ImportSession | undefined, Error>> {
    try {
      const row = await db.selectFrom('import_sessions').selectAll().where('id', '=', sessionId).executeTakeFirst();

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

  async function findByAccounts(accountIds: number[]): Promise<Result<ImportSession[], Error>> {
    try {
      if (accountIds.length === 0) {
        return ok([]);
      }

      const rows = await db
        .selectFrom('import_sessions')
        .selectAll()
        .where('account_id', 'in', accountIds)
        .orderBy('started_at', 'desc')
        .execute();

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
      return wrapError(error, 'Failed to find import sessions by accounts');
    }
  }

  async function getSessionCountsByAccount(accountIds: number[]): Promise<Result<Map<number, number>, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(new Map());
      }

      const results = await db
        .selectFrom('import_sessions')
        .select(['account_id', (eb) => eb.fn.count<number>('id').as('count')])
        .where('account_id', 'in', accountIds)
        .groupBy('account_id')
        .execute();

      const counts = new Map<number, number>();
      for (const row of results) {
        counts.set(row.account_id, row.count);
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

  async function update(sessionId: number, updates: ImportSessionUpdate): Promise<Result<void, Error>> {
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
        return ok();
      }

      await db.updateTable('import_sessions').set(updateData).where('id', '=', sessionId).execute();

      return ok();
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to update import session');
      return wrapError(error, 'Failed to update import session');
    }
  }

  async function count(filters?: { accountIds?: number[] }): Promise<Result<number, Error>> {
    try {
      let query = db.selectFrom('import_sessions').select(({ fn }) => [fn.count<number>('id').as('count')]);

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

  async function deleteByAccount(accountId: number): Promise<Result<void, Error>> {
    try {
      await db.deleteFrom('import_sessions').where('account_id', '=', accountId).execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to delete import sessions by account ID');
    }
  }

  async function deleteAll(): Promise<Result<void, Error>> {
    try {
      await db.deleteFrom('import_sessions').execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to delete all import sessions');
    }
  }

  /**
   * Find latest incomplete import session for an account to support resume
   * Status 'started' or 'failed' indicates incomplete import
   */
  async function findLatestIncomplete(accountId: number): Promise<Result<ImportSession | undefined, Error>> {
    try {
      const row = await db
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

  return {
    create,
    finalize,
    findById,
    findByAccounts,
    getSessionCountsByAccount,
    findLatestIncomplete,
    update,
    count,
    deleteByAccount,
    deleteAll,
  };
}

export type ImportSessionQueries = ReturnType<typeof createImportSessionQueries>;
