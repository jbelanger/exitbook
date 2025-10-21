import type { DataImportParams, DataSource, VerificationMetadata } from '@exitbook/core';
import { DataImportParamsSchema, VerificationMetadataSchema, wrapError } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import type { StoredDataSource, ImportSessionQuery, DataSourceUpdate } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { IDataSourceRepository } from '../../app/ports/data-source-repository.interface.ts';

/**
 * Kysely-based repository for data source  database operations.
 * Handles storage and retrieval of DataSource entities using type-safe queries.
 */
export class DataSourceRepository extends BaseRepository implements IDataSourceRepository {
  constructor(db: KyselyDB) {
    super(db, 'DataSourceRepository');
  }

  async create(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    importParams?: DataImportParams
  ): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .insertInto('data_sources')
        .values({
          created_at: this.getCurrentDateTimeForDB(),
          import_params: this.serializeToJson(importParams ?? {}) ?? '{}',
          import_result_metadata: this.serializeToJson({}) ?? '{}',
          source_id: sourceId,
          source_type: sourceType,
          started_at: this.getCurrentDateTimeForDB(),
          status: 'started',
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return ok(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to create data source ');
    }
  }

  async finalize(
    sessionId: number,
    status: 'completed' | 'failed' | 'cancelled',
    startTime: number,
    errorMessage?: string,
    errorDetails?: unknown,
    importResultMetadata?: Record<string, unknown>
  ): Promise<Result<void, Error>> {
    try {
      const durationMs = Date.now() - startTime;
      const currentTimestamp = this.getCurrentDateTimeForDB();

      await this.db
        .updateTable('data_sources')
        .set({
          completed_at: currentTimestamp as unknown as string,
          duration_ms: durationMs,
          error_details: this.serializeToJson(errorDetails),
          error_message: errorMessage,
          import_result_metadata: this.serializeToJson(importResultMetadata ?? {}),
          status,
          updated_at: currentTimestamp,
        })
        .where('id', '=', sessionId)
        .execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to finalize data source ');
    }
  }

  async findAll(filters?: ImportSessionQuery): Promise<Result<DataSource[], Error>> {
    try {
      let query = this.db.selectFrom('data_sources').selectAll();

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
      return ok(rows.map((row) => this.toDataSource(row)));
    } catch (error) {
      return wrapError(error, 'Failed to find import sessions');
    }
  }

  async findById(sessionId: number): Promise<Result<DataSource | undefined, Error>> {
    try {
      const row = await this.db.selectFrom('data_sources').selectAll().where('id', '=', sessionId).executeTakeFirst();

      return ok(row ? this.toDataSource(row) : undefined);
    } catch (error) {
      return wrapError(error, 'Failed to find data source  by ID');
    }
  }

  async findBySource(sourceId: string, limit?: number): Promise<Result<DataSource[], Error>> {
    return this.findAll({ limit, sourceId });
  }

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

      await this.db.updateTable('data_sources').set(updates).where('id', '=', sessionId).execute();

      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to update data source ');
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
  ): Promise<Result<DataSource | undefined, Error>> {
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
        // Use already-parsed importParams from domain model
        const storedParams = session.importParams;

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

  async updateVerificationMetadata(
    sessionId: number,
    verificationMetadata: VerificationMetadata
  ): Promise<Result<void, Error>> {
    try {
      const currentTimestamp = this.getCurrentDateTimeForDB();

      await this.db
        .updateTable('data_sources')
        .set({
          last_balance_check_at: currentTimestamp,
          updated_at: currentTimestamp,
          verification_metadata: this.serializeToJson(verificationMetadata),
        })
        .where('id', '=', sessionId)
        .execute();

      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to update verification metadata');
    }
  }

  async deleteBySource(sourceId: string): Promise<Result<void, Error>> {
    try {
      await this.db.deleteFrom('data_sources').where('source_id', '=', sourceId).execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to delete data sources by source ID');
    }
  }

  async deleteAll(): Promise<Result<void, Error>> {
    try {
      await this.db.deleteFrom('data_sources').execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to delete all data sources');
    }
  }

  /**
   * Convert database row to DataSource domain model
   * Handles JSON parsing and camelCase conversion
   */
  private toDataSource(row: StoredDataSource): DataSource {
    // Parse and validate JSON fields using schemas
    const importParams: DataImportParams = this.parseWithSchema(
      row.import_params,
      DataImportParamsSchema,
      {} as DataImportParams
    );

    const importResultMetadata: Record<string, unknown> = this.parseJson(row.import_result_metadata, {});

    const errorDetails: unknown = this.parseJson(row.error_details);

    const verificationMetadata: VerificationMetadata | undefined = this.parseWithSchema(
      row.verification_metadata,
      VerificationMetadataSchema
    );

    return {
      id: row.id,
      sourceId: row.source_id,
      sourceType: row.source_type,
      status: row.status,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
      durationMs: row.duration_ms ?? undefined,
      errorMessage: row.error_message ?? undefined,
      errorDetails,
      importParams,
      importResultMetadata,
      lastBalanceCheckAt: row.last_balance_check_at ? new Date(row.last_balance_check_at) : undefined,
      verificationMetadata,
    };
  }
}
