import type { KyselyDB } from '@exitbook/data';
import type { ImportSession, ImportSessionQuery, ImportSessionUpdate } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { IImportSessionRepository } from '@exitbook/import/app/ports/import-session-repository.js';

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
    sessionMetadata?: unknown
  ): Promise<number> {
    const result = await this.db
      .insertInto('import_sessions')
      .values({
        created_at: this.getCurrentDateTimeForDB(),
        provider_id: providerId,
        session_metadata: this.serializeToJson(sessionMetadata) || undefined,
        source_id: sourceId,
        source_type: sourceType,
        started_at: this.getCurrentDateTimeForDB(),
        status: 'started',
        transactions_failed: 0,
        transactions_imported: 0,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    this.logger.debug({ sessionId: result.id, sourceId, sourceType }, 'Import session created');
    return result.id;
  }

  async finalize(
    sessionId: number,
    status: 'completed' | 'failed' | 'cancelled',
    startTime: number,
    transactionsImported = 0,
    transactionsFailed = 0,
    errorMessage?: string,
    errorDetails?: unknown
  ): Promise<void> {
    const durationMs = Date.now() - startTime;
    const currentTimestamp = this.getCurrentDateTimeForDB();

    await this.db
      .updateTable('import_sessions')
      .set({
        completed_at: currentTimestamp as unknown as string,
        duration_ms: durationMs,
        error_details: this.serializeToJson(errorDetails) || undefined,
        error_message: errorMessage,
        status,
        transactions_failed: transactionsFailed,
        transactions_imported: transactionsImported,
        updated_at: currentTimestamp,
      })
      .where('id', '=', sessionId)
      .execute();

    this.logger.debug(
      { durationMs, sessionId, status, transactionsFailed, transactionsImported },
      'Import session finalized'
    );
  }

  async findActive(): Promise<ImportSession[]> {
    return this.findAll({ status: 'started' });
  }

  async findAll(filters?: ImportSessionQuery): Promise<ImportSession[]> {
    let query = this.db.selectFrom('import_sessions').selectAll();

    // Apply filters
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

    // Apply ordering
    query = query.orderBy('started_at', 'desc');

    // Apply limit
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const rows = await query.execute();
    return rows as ImportSession[];
  }

  async findById(sessionId: number): Promise<ImportSession | undefined> {
    const row = await this.db.selectFrom('import_sessions').selectAll().where('id', '=', sessionId).executeTakeFirst();

    return row ? row : undefined;
  }

  async findBySource(sourceId: string, limit?: number): Promise<ImportSession[]> {
    return this.findAll({ limit, sourceId });
  }

  async findRecent(limit = 10): Promise<ImportSession[]> {
    return this.findAll({ limit });
  }

  async update(sessionId: number, updates: ImportSessionUpdate): Promise<void> {
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

    if (updates.session_metadata !== undefined) {
      updateData.session_metadata = this.serializeToJson(updates.session_metadata);
    }

    // Only update if there are actual changes besides updated_at
    const hasChanges = Object.keys(updateData).length > 1;
    if (!hasChanges) {
      return;
    }

    await this.db.updateTable('import_sessions').set(updates).where('id', '=', sessionId).execute();

    this.logger.debug({ sessionId, updates: updateData }, 'Import session updated');
  }
}
