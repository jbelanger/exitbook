import type { DataSource, DataSourceStatus } from '@exitbook/core';
import { ImportResultMetadataSchema, wrapError } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import type { StoredDataSource, ImportSessionQuery, DataSourceUpdate } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { IDataSourceRepository } from '../types/repositories.js';

/**
 * Kysely-based repository for import session database operations.
 * Handles storage and retrieval of DataSource entities using type-safe queries.
 * Per ADR-007: import_sessions represents discrete import events, linked to accounts via account_id
 */
export class DataSourceRepository extends BaseRepository implements IDataSourceRepository {
  constructor(db: KyselyDB) {
    super(db, 'DataSourceRepository');
  }

  /**
   * Create a new import session
   * Per ADR-007: Each import execution creates a new session record
   */
  async create(accountId: number): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .insertInto('import_sessions')
        .values({
          account_id: accountId,
          created_at: this.getCurrentDateTimeForDB(),
          import_result_metadata: this.serializeToJson({}) ?? '{}',
          started_at: this.getCurrentDateTimeForDB(),
          status: 'started',
          transactions_imported: 0,
          transactions_failed: 0,
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
   * Sets final status, duration, and result metadata
   */
  async finalize(
    sessionId: number,
    status: Exclude<DataSourceStatus, 'started'>,
    startTime: number,
    errorMessage?: string,
    errorDetails?: unknown,
    importResultMetadata?: Record<string, unknown>
  ): Promise<Result<void, Error>> {
    try {
      // Validate import result metadata before saving
      const metadataToSave = importResultMetadata ?? {};
      const validationResult = ImportResultMetadataSchema.safeParse(metadataToSave);
      if (!validationResult.success) {
        return err(new Error(`Invalid import result metadata: ${validationResult.error.message}`));
      }

      const durationMs = Date.now() - startTime;
      const currentTimestamp = this.getCurrentDateTimeForDB();

      await this.db
        .updateTable('import_sessions')
        .set({
          completed_at: currentTimestamp as unknown as string,
          duration_ms: durationMs,
          error_details: this.serializeToJson(errorDetails),
          error_message: errorMessage,
          import_result_metadata: this.serializeToJson(validationResult.data),
          status,
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
   * Find all import sessions matching filters
   */
  async findAll(filters?: ImportSessionQuery): Promise<Result<DataSource[], Error>> {
    try {
      let query = this.db.selectFrom('import_sessions').selectAll();

      if (filters?.accountId !== undefined) {
        query = query.where('account_id', '=', filters.accountId);
      }

      if (filters?.status) {
        query = query.where('status', '=', filters.status);
      }

      if (filters?.since) {
        // Convert Unix timestamp to ISO string for comparison
        const sinceDate = new Date(filters.since * 1000).toISOString();
        query = query.where('started_at', '>=', sinceDate);
      }

      query = query.orderBy('started_at', 'asc');

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      const rows = await query.execute();

      // Convert rows to domain models, failing fast on any parse errors
      const dataSources: DataSource[] = [];
      for (const row of rows) {
        const result = this.toDataSource(row);
        if (result.isErr()) {
          return err(result.error);
        }
        dataSources.push(result.value);
      }

      return ok(dataSources);
    } catch (error) {
      return wrapError(error, 'Failed to find import sessions');
    }
  }

  /**
   * Find import session by ID
   */
  async findById(sessionId: number): Promise<Result<DataSource | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('import_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      const result = this.toDataSource(row);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to find import session by ID');
    }
  }

  /**
   * Find all import sessions for an account
   */
  async findByAccount(accountId: number, limit?: number): Promise<Result<DataSource[], Error>> {
    return this.findAll({ accountId, limit });
  }

  /**
   * Update import session
   */
  async update(sessionId: number, updates: DataSourceUpdate): Promise<Result<void, Error>> {
    try {
      const currentTimestamp = this.getCurrentDateTimeForDB();
      const updateData: Record<string, unknown> = {
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
        updateData.error_details = this.serializeToJson(updates.error_details);
      }

      if (updates.import_result_metadata !== undefined) {
        if (typeof updates.import_result_metadata === 'string') {
          updateData.import_result_metadata = updates.import_result_metadata;
        } else {
          // Validate before saving
          const validationResult = ImportResultMetadataSchema.safeParse(updates.import_result_metadata);
          if (!validationResult.success) {
            return err(new Error(`Invalid import result metadata: ${validationResult.error.message}`));
          }
          updateData.import_result_metadata = this.serializeToJson(validationResult.data);
        }
      }

      if (updates.transactions_imported !== undefined) {
        updateData.transactions_imported = updates.transactions_imported;
      }

      if (updates.transactions_failed !== undefined) {
        updateData.transactions_failed = updates.transactions_failed;
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
  async findLatestIncomplete(accountId: number): Promise<Result<DataSource | undefined, Error>> {
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

      const result = this.toDataSource(row);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to find latest incomplete import session');
    }
  }

  /**
   * Convert database row to DataSource domain model
   * Handles JSON parsing and camelCase conversion
   */
  private toDataSource(row: StoredDataSource): Result<DataSource, Error> {
    // Parse and validate JSON fields using schemas
    const importResultMetadataResult = this.parseWithSchema(row.import_result_metadata, ImportResultMetadataSchema);
    if (importResultMetadataResult.isErr()) {
      return err(importResultMetadataResult.error);
    }

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
      transactionsFailed: row.transactions_failed,
      errorMessage: row.error_message ?? undefined,
      errorDetails: errorDetailsResult.value,
      importResultMetadata: importResultMetadataResult.value ?? {},
    });
  }
}
