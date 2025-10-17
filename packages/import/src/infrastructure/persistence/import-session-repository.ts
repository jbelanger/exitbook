import { wrapError } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import type { ImportSession, ImportSessionQuery, ImportSessionUpdate, StoredImportParams } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { IImportSessionRepository } from '@exitbook/import/app/ports/import-session-repository.interface.ts';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

/**
 * Kysely-based repository for import session database operations.
 * Handles storage and retrieval of ImportSession entities using type-safe queries.
 */
export class ImportSessionRepository extends BaseRepository implements IImportSessionRepository {
  constructor(db: KyselyDB) {
    super(db, 'ImportSessionRepository');
  }

  async create(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    providerId?: string,
    importParams?: StoredImportParams
  ): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .insertInto('import_sessions')
        .values({
          created_at: this.getCurrentDateTimeForDB(),
          import_params: this.serializeToJson(importParams ?? {}) ?? '{}',
          import_result_metadata: this.serializeToJson({}) ?? '{}',
          provider_id: providerId,
          source_id: sourceId,
          source_type: sourceType,
          started_at: this.getCurrentDateTimeForDB(),
          status: 'started',
          transactions_failed: 0,
          transactions_imported: 0,
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
    status: 'completed' | 'failed' | 'cancelled',
    startTime: number,
    transactionsImported = 0,
    transactionsFailed = 0,
    errorMessage?: string,
    errorDetails?: unknown,
    importResultMetadata?: Record<string, unknown>
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
          import_result_metadata: this.serializeToJson(importResultMetadata ?? {}),
          status,
          transactions_failed: transactionsFailed,
          transactions_imported: transactionsImported,
          updated_at: currentTimestamp,
        })
        .where('id', '=', sessionId)
        .execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to finalize import session');
    }
  }

  async findActive(): Promise<Result<ImportSession[], Error>> {
    return this.findAll({ status: 'started' });
  }

  async findAll(filters?: ImportSessionQuery): Promise<Result<ImportSession[], Error>> {
    try {
      let query = this.db.selectFrom('import_sessions').selectAll();

      if (filters?.sourceId) {
        query = query.where('source_id', '=', filters.sourceId);
      }

      if (filters?.sourceType) {
        query = query.where('source_type', '=', filters.sourceType);
      }

      if (filters?.status) {
        query = query.where('status', '=', filters.status);
      }

      if (filters?.since) {
        // Convert Unix timestamp to ISO string for comparison
        const sinceDate = new Date(filters.since * 1000).toISOString();
        query = query.where('started_at', '>=', sinceDate);
      }

      query = query.orderBy('started_at', 'desc');

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      const rows = await query.execute();
      return ok(rows as ImportSession[]);
    } catch (error) {
      return wrapError(error, 'Failed to find import sessions');
    }
  }

  async findById(sessionId: number): Promise<Result<ImportSession | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('import_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirst();

      return ok(row ? row : undefined);
    } catch (error) {
      return wrapError(error, 'Failed to find import session by ID');
    }
  }

  async findBySource(sourceId: string, limit?: number): Promise<Result<ImportSession[], Error>> {
    return this.findAll({ limit, sourceId });
  }

  async findRecent(limit = 10): Promise<Result<ImportSession[], Error>> {
    return this.findAll({ limit });
  }

  async update(sessionId: number, updates: ImportSessionUpdate): Promise<Result<void, Error>> {
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

      if (updates.transactions_imported !== undefined) {
        updateData.transactions_imported = updates.transactions_imported;
      }

      if (updates.transactions_failed !== undefined) {
        updateData.transactions_failed = updates.transactions_failed;
      }

      if (updates.import_params !== undefined) {
        updateData.import_params =
          typeof updates.import_params === 'string'
            ? updates.import_params
            : this.serializeToJson(updates.import_params);
      }

      if (updates.import_result_metadata !== undefined) {
        updateData.import_result_metadata =
          typeof updates.import_result_metadata === 'string'
            ? updates.import_result_metadata
            : this.serializeToJson(updates.import_result_metadata);
      }

      // Only update if there are actual changes besides updated_at
      const hasChanges = Object.keys(updateData).length > 1;
      if (!hasChanges) {
        return ok();
      }

      await this.db.updateTable('import_sessions').set(updates).where('id', '=', sessionId).execute();

      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to update import session');
    }
  }

  async findCompletedWithMatchingParams(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    params: {
      address?: string;
      csvDirectories?: string[];
      providerId?: string;
      since?: number;
    }
  ): Promise<Result<ImportSession | undefined, Error>> {
    try {
      // Find all completed sessions for this source
      const sessionsResult = await this.findAll({
        sourceId,
        sourceType,
        status: 'completed',
      });

      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessions = sessionsResult.value;

      // Find a session with matching import parameters
      for (const session of sessions) {
        const storedParams: StoredImportParams =
          typeof session.import_params === 'string'
            ? (JSON.parse(session.import_params) as StoredImportParams)
            : (session.import_params as StoredImportParams);

        // Compare relevant parameters
        const addressMatches = params.address === storedParams.address;

        // Compare CSV directories (arrays need deep comparison)
        const csvDirsMatch =
          JSON.stringify(params.csvDirectories?.sort()) === JSON.stringify(storedParams.csvDirectories?.sort());

        if (addressMatches && csvDirsMatch) {
          return ok(session);
        }
      }

      // eslint-disable-next-line unicorn/no-useless-undefined -- Explicitly return undefined when no match found
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to find completed session with matching params');
    }
  }
}
