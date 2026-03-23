/* eslint-disable unicorn/no-null -- null required for db */
import type { ProjectionId, ProjectionStatus } from '@exitbook/core';
import { ok, err, type Result } from '@exitbook/foundation';

import type { KyselyDB } from '../database.js';

import { BaseRepository } from './base-repository.js';

const DEFAULT_SCOPE_KEY = '__global__';

export interface ProjectionStateRow {
  projectionId: ProjectionId;
  scopeKey: string;
  status: ProjectionStatus;
  lastBuiltAt: Date | null;
  lastInvalidatedAt: Date | null;
  invalidatedBy: string | null;
  metadata: Record<string, unknown> | null;
}

export class ProjectionStateRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'projection-state-repository');
  }

  async get(
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

      if (!row) return ok(undefined);

      return ok(this.toRow(row));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
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
      return err(error instanceof Error ? error : new Error(String(error)));
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
      return err(error instanceof Error ? error : new Error(String(error)));
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
      return err(error instanceof Error ? error : new Error(String(error)));
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
      return err(error instanceof Error ? error : new Error(String(error)));
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
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private toRow(raw: {
    invalidated_by: string | null;
    last_built_at: string | null;
    last_invalidated_at: string | null;
    metadata_json: unknown;
    projection_id: string;
    scope_key: string;
    status: string;
  }): ProjectionStateRow {
    return {
      projectionId: raw.projection_id as ProjectionId,
      scopeKey: raw.scope_key,
      status: raw.status as ProjectionStatus,
      lastBuiltAt: raw.last_built_at ? new Date(raw.last_built_at) : null,
      lastInvalidatedAt: raw.last_invalidated_at ? new Date(raw.last_invalidated_at) : null,
      invalidatedBy: raw.invalidated_by,
      metadata: raw.metadata_json ? (JSON.parse(raw.metadata_json as string) as Record<string, unknown>) : null,
    };
  }
}
