/* eslint-disable unicorn/no-null -- null required for db */
import { PROJECTION_DEFINITIONS, type ProjectionId, type ProjectionStatus } from '@exitbook/core';
import { ok, err, wrapError, type Result } from '@exitbook/foundation';

import type { KyselyDB } from '../database.js';

import { BaseRepository } from './base-repository.js';

const DEFAULT_SCOPE_KEY = '__global__';
const PROJECTION_IDS = new Set(PROJECTION_DEFINITIONS.map(({ id }) => id));

interface ProjectionStateRow {
  projectionId: ProjectionId;
  scopeKey: string;
  status: ProjectionStatus;
  lastBuiltAt: Date | null;
  lastInvalidatedAt: Date | null;
  invalidatedBy: string | null;
  metadata: Record<string, unknown> | null;
}

interface ProjectionStateRecord {
  invalidated_by: string | null;
  last_built_at: string | null;
  last_invalidated_at: string | null;
  metadata_json: unknown;
  projection_id: string;
  scope_key: string;
  status: ProjectionStatus;
}

export class ProjectionStateRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'projection-state-repository');
  }

  async find(
    projectionId: ProjectionId,
    scopeKey: string = DEFAULT_SCOPE_KEY
  ): Promise<Result<ProjectionStateRow | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('projection_state')
        .selectAll()
        .where('projection_id', '=', projectionId)
        .where('scope_key', '=', scopeKey)
        .executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      return this.toRow(row);
    } catch (error) {
      this.logger.error({ error, projectionId, scopeKey }, 'Failed to load projection state');
      return wrapError(error, `Failed to load projection state for ${projectionId} (${scopeKey})`);
    }
  }

  async upsert(row: ProjectionStateRow): Promise<Result<void, Error>> {
    try {
      const values = {
        projection_id: row.projectionId,
        scope_key: row.scopeKey,
        status: row.status,
        last_built_at: row.lastBuiltAt?.toISOString() ?? null,
        last_invalidated_at: row.lastInvalidatedAt?.toISOString() ?? null,
        invalidated_by: row.invalidatedBy,
        metadata_json: row.metadata ? JSON.stringify(row.metadata) : null,
      };

      await this.db
        .insertInto('projection_state')
        .values(values)
        .onConflict((oc) =>
          oc.columns(['projection_id', 'scope_key']).doUpdateSet({
            status: values.status,
            last_built_at: values.last_built_at,
            last_invalidated_at: values.last_invalidated_at,
            invalidated_by: values.invalidated_by,
            metadata_json: values.metadata_json,
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      this.logger.error(
        { error, projectionId: row.projectionId, scopeKey: row.scopeKey },
        'Failed to upsert projection state'
      );
      return wrapError(error, `Failed to upsert projection state for ${row.projectionId} (${row.scopeKey})`);
    }
  }

  async markStale(
    projectionId: ProjectionId,
    invalidatedBy: string,
    scopeKey: string = DEFAULT_SCOPE_KEY
  ): Promise<Result<void, Error>> {
    try {
      const now = new Date().toISOString();

      await this.db
        .insertInto('projection_state')
        .values({
          projection_id: projectionId,
          scope_key: scopeKey,
          status: 'stale',
          last_invalidated_at: now,
          invalidated_by: invalidatedBy,
        })
        .onConflict((oc) =>
          oc.columns(['projection_id', 'scope_key']).doUpdateSet({
            status: 'stale',
            last_invalidated_at: now,
            invalidated_by: invalidatedBy,
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error, projectionId, scopeKey, invalidatedBy }, 'Failed to mark projection state stale');
      return wrapError(error, `Failed to mark projection state stale for ${projectionId} (${scopeKey})`);
    }
  }

  async markBuilding(projectionId: ProjectionId, scopeKey: string = DEFAULT_SCOPE_KEY): Promise<Result<void, Error>> {
    try {
      await this.db
        .insertInto('projection_state')
        .values({
          projection_id: projectionId,
          scope_key: scopeKey,
          status: 'building',
        })
        .onConflict((oc) =>
          oc.columns(['projection_id', 'scope_key']).doUpdateSet({
            status: 'building',
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error, projectionId, scopeKey }, 'Failed to mark projection state building');
      return wrapError(error, `Failed to mark projection state building for ${projectionId} (${scopeKey})`);
    }
  }

  async markFresh(
    projectionId: ProjectionId,
    metadata: Record<string, unknown> | null,
    scopeKey: string = DEFAULT_SCOPE_KEY
  ): Promise<Result<void, Error>> {
    try {
      const now = new Date().toISOString();

      await this.db
        .insertInto('projection_state')
        .values({
          projection_id: projectionId,
          scope_key: scopeKey,
          status: 'fresh',
          last_built_at: now,
          metadata_json: metadata ? JSON.stringify(metadata) : null,
        })
        .onConflict((oc) =>
          oc.columns(['projection_id', 'scope_key']).doUpdateSet({
            status: 'fresh',
            last_built_at: now,
            last_invalidated_at: null,
            invalidated_by: null,
            metadata_json: metadata ? JSON.stringify(metadata) : null,
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error, projectionId, scopeKey }, 'Failed to mark projection state fresh');
      return wrapError(error, `Failed to mark projection state fresh for ${projectionId} (${scopeKey})`);
    }
  }

  async markFailed(projectionId: ProjectionId, scopeKey: string = DEFAULT_SCOPE_KEY): Promise<Result<void, Error>> {
    try {
      await this.db
        .insertInto('projection_state')
        .values({
          projection_id: projectionId,
          scope_key: scopeKey,
          status: 'failed',
        })
        .onConflict((oc) =>
          oc.columns(['projection_id', 'scope_key']).doUpdateSet({
            status: 'failed',
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error, projectionId, scopeKey }, 'Failed to mark projection state failed');
      return wrapError(error, `Failed to mark projection state failed for ${projectionId} (${scopeKey})`);
    }
  }

  private toRow(raw: ProjectionStateRecord): Result<ProjectionStateRow, Error> {
    const projectionIdResult = this.parseProjectionId(raw.projection_id, raw.scope_key);
    if (projectionIdResult.isErr()) {
      return err(projectionIdResult.error);
    }

    const metadataResult = this.parseMetadata(raw.metadata_json, projectionIdResult.value, raw.scope_key);
    if (metadataResult.isErr()) {
      return err(metadataResult.error);
    }

    return ok({
      projectionId: projectionIdResult.value,
      scopeKey: raw.scope_key,
      status: raw.status,
      lastBuiltAt: raw.last_built_at ? new Date(raw.last_built_at) : null,
      lastInvalidatedAt: raw.last_invalidated_at ? new Date(raw.last_invalidated_at) : null,
      invalidatedBy: raw.invalidated_by,
      metadata: metadataResult.value,
    });
  }

  private parseProjectionId(value: string, scopeKey: string): Result<ProjectionId, Error> {
    if (PROJECTION_IDS.has(value as ProjectionId)) {
      return ok(value as ProjectionId);
    }

    return err(new Error(`Projection state row for ${value} (${scopeKey}) used an unknown projection id`));
  }

  private parseMetadata(
    value: unknown,
    projectionId: ProjectionId,
    scopeKey: string
  ): Result<Record<string, unknown> | null, Error> {
    if (value === null || value === undefined || value === '') {
      return ok(null);
    }

    if (typeof value !== 'string') {
      return err(new Error(`Projection state metadata for ${projectionId} (${scopeKey}) was not stored as JSON text`));
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return err(new Error(`Projection state metadata for ${projectionId} (${scopeKey}) was not an object`));
      }

      return ok(parsed as Record<string, unknown>);
    } catch (error) {
      return wrapError(error, `Failed to parse projection state metadata for ${projectionId} (${scopeKey})`);
    }
  }
}
