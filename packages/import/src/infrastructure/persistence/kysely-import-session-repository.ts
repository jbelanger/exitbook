import { KyselyBaseRepository } from '@crypto/data/src/repositories/kysely-base-repository.ts';
import type { ImportSessionsTable, ExternalTransactionDataTable } from '@crypto/data/src/schema/database-schema.ts';
import type { KyselyDB } from '@crypto/data/src/storage/kysely-database.ts';
import type {
  ImportSession,
  ImportSessionQuery,
  ImportSessionWithRawData,
  UpdateImportSessionRequest,
} from '@crypto/data/src/types/data-types.ts';

import type { IImportSessionRepository } from '../../app/ports/import-session-repository.ts';

/**
 * Maps database row to ImportSession domain object
 */
function mapToImportSession(row: Record<string, unknown>): ImportSession {
  return {
    completedAt: row.completed_at ? new Date(row.completed_at as string).getTime() / 1000 : undefined,
    createdAt: new Date(row.created_at as string).getTime() / 1000,
    durationMs: row.duration_ms as number | undefined,
    errorDetails: row.error_details ? JSON.parse(row.error_details as string) : undefined,
    errorMessage: row.error_message as string | undefined,
    id: row.id as number,
    providerId: row.provider_id as string | undefined,
    sessionMetadata: row.session_metadata ? JSON.parse(row.session_metadata as string) : undefined,
    sourceId: row.source_id as string,
    sourceType: row.source_type as 'exchange' | 'blockchain',
    startedAt: new Date(row.started_at as string).getTime() / 1000,
    status: row.status as 'started' | 'completed' | 'failed' | 'cancelled',
    transactionsFailed: row.transactions_failed as number,
    transactionsImported: row.transactions_imported as number,
    updatedAt: new Date(row.updated_at as string).getTime() / 1000,
  };
}

/**
 * Kysely-based repository for import session database operations.
 * Handles storage and retrieval of ImportSession entities using type-safe queries.
 */
export class KyselyImportSessionRepository extends KyselyBaseRepository implements IImportSessionRepository {
  constructor(db: KyselyDB) {
    super(db, 'KyselyImportSessionRepository');
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
    return rows.map(mapToImportSession);
  }

  async findById(sessionId: number): Promise<ImportSession | undefined> {
    const row = await this.db.selectFrom('import_sessions').selectAll().where('id', '=', sessionId).executeTakeFirst();

    return row ? mapToImportSession(row) : undefined;
  }

  async findBySource(sourceId: string, limit?: number): Promise<ImportSession[]> {
    return this.findAll({ limit, sourceId });
  }

  async findRecent(limit = 10): Promise<ImportSession[]> {
    return this.findAll({ limit });
  }

  async update(sessionId: number, updates: UpdateImportSessionRequest): Promise<void> {
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

    if (updates.errorMessage !== undefined) {
      updateData.error_message = updates.errorMessage;
    }

    if (updates.errorDetails !== undefined) {
      updateData.error_details = this.serializeToJson(updates.errorDetails);
    }

    if (updates.transactionsImported !== undefined) {
      updateData.transactions_imported = updates.transactionsImported;
    }

    if (updates.transactionsFailed !== undefined) {
      updateData.transactions_failed = updates.transactionsFailed;
    }

    if (updates.sessionMetadata !== undefined) {
      updateData.session_metadata = this.serializeToJson(updates.sessionMetadata);
    }

    // Only update if there are actual changes besides updated_at
    const hasChanges = Object.keys(updateData).length > 1;
    if (!hasChanges) {
      return;
    }

    await this.db
      .updateTable('import_sessions')
      .set({
        completed_at: updateData.completed_at as string | undefined,
        error_details: updateData.error_details as string | undefined,
        error_message: updateData.error_message as string | undefined,
        session_metadata: updateData.session_metadata as string | undefined,
        status: updateData.status as 'started' | 'completed' | 'failed' | 'cancelled' | undefined,
        transactions_failed: updateData.transactions_failed as number | undefined,
        transactions_imported: updateData.transactions_imported as number | undefined,
        updated_at: updateData.updated_at as string,
      })
      .where('id', '=', sessionId)
      .execute();

    this.logger.debug({ sessionId, updates: updateData }, 'Import session updated');
  }

  async findWithRawData(filters: { sourceId: string }): Promise<ImportSessionWithRawData[]> {
    const rows = await this.db
      .selectFrom('import_sessions as s')
      .leftJoin('external_transaction_data as r', 's.id', 'r.import_session_id')
      .select([
        // Session fields
        's.id',
        's.source_id',
        's.source_type',
        's.provider_id',
        's.session_metadata',
        's.status',
        's.started_at',
        's.completed_at',
        's.duration_ms',
        's.transactions_imported',
        's.transactions_failed',
        's.error_message',
        's.error_details',
        's.created_at',
        's.updated_at',
        // Raw data fields (with alias to avoid conflicts)
        'r.id as raw_id',
        'r.provider_id as raw_provider_id',
        'r.raw_data',
        'r.metadata as raw_metadata',
        'r.processing_status',
        'r.processing_error',
        'r.processed_at',
        'r.created_at as raw_created_at',
      ])
      .where('s.source_id', '=', filters.sourceId)
      .orderBy(['s.started_at desc', 'r.created_at asc'])
      .execute();

    // Group results by session
    const sessionsMap = new Map<number, ImportSessionWithRawData>();

    rows.forEach((row) => {
      const sessionId = row.id;

      if (!sessionsMap.has(sessionId)) {
        // Create session object
        const session = mapToImportSession({
          completed_at: row.completed_at,
          created_at: row.created_at,
          duration_ms: row.duration_ms,
          error_details: row.error_details,
          error_message: row.error_message,
          id: row.id,
          provider_id: row.provider_id,
          session_metadata: row.session_metadata,
          source_id: row.source_id,
          source_type: row.source_type,
          started_at: row.started_at,
          status: row.status,
          transactions_failed: row.transactions_failed,
          transactions_imported: row.transactions_imported,
          updated_at: row.updated_at,
        });

        sessionsMap.set(sessionId, {
          rawDataItems: [],
          session,
        });
      }

      // Add raw data item if present
      if (row.raw_id) {
        const rawDataItem = {
          createdAt: row.raw_created_at ? new Date(row.raw_created_at as unknown as string).getTime() / 1000 : 0,
          id: row.raw_id,
          importSessionId: sessionId,
          metadata: this.parseJsonField(row.raw_metadata as string | undefined, {}),
          processedAt: row.processed_at ? new Date(row.processed_at as unknown as string).getTime() / 1000 : undefined,
          processingError: row.processing_error ?? undefined,
          processingStatus: row.processing_status ?? '',
          providerId: row.raw_provider_id ?? undefined,
          rawData: this.parseJsonField(row.raw_data as string | undefined, {}),
          sourceId: row.source_id,
          sourceType: row.source_type,
        };

        sessionsMap.get(sessionId)!.rawDataItems.push(rawDataItem);
      }
    });

    const results = Array.from(sessionsMap.values());
    this.logger.debug({ sessionsCount: results.length, sourceId: filters.sourceId }, 'Found sessions with raw data');

    return results;
  }
}
