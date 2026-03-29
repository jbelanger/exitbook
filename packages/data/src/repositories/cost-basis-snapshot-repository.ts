/* eslint-disable unicorn/no-null -- db nulls */
import type { CostBasisSnapshotRecord } from '@exitbook/accounting/ports';
import { ok, wrapError, type Result } from '@exitbook/foundation';

import type { KyselyDB } from '../database.js';
import { chunkItems, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';

import { BaseRepository } from './base-repository.js';

export class CostBasisSnapshotRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'cost-basis-snapshot-repository');
  }

  async findLatest(scopeKey: string): Promise<Result<CostBasisSnapshotRecord | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('cost_basis_snapshots')
        .selectAll()
        .where('scope_key', '=', scopeKey)
        .executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      return ok(this.toRecord(row));
    } catch (error) {
      this.logger.error({ error, scopeKey }, 'Failed to load latest cost-basis snapshot');
      return wrapError(error, `Failed to load latest cost-basis snapshot for ${scopeKey}`);
    }
  }

  async replaceLatest(snapshot: CostBasisSnapshotRecord): Promise<Result<void, Error>> {
    try {
      const values = {
        scope_key: snapshot.scopeKey,
        snapshot_id: snapshot.snapshotId,
        storage_schema_version: snapshot.storageSchemaVersion,
        calculation_engine_version: snapshot.calculationEngineVersion,
        artifact_kind: snapshot.artifactKind,
        links_built_at: snapshot.linksBuiltAt.toISOString(),
        asset_review_built_at: snapshot.assetReviewBuiltAt.toISOString(),
        prices_last_mutated_at: snapshot.pricesLastMutatedAt?.toISOString() ?? null,
        exclusion_fingerprint: snapshot.exclusionFingerprint,
        calculation_id: snapshot.calculationId,
        jurisdiction: snapshot.jurisdiction,
        method: snapshot.method,
        tax_year: snapshot.taxYear,
        display_currency: snapshot.displayCurrency,
        start_date: snapshot.startDate,
        end_date: snapshot.endDate,
        artifact_json: snapshot.artifactJson,
        debug_json: snapshot.debugJson,
        created_at: snapshot.createdAt.toISOString(),
        updated_at: snapshot.updatedAt.toISOString(),
      };

      await this.db
        .insertInto('cost_basis_snapshots')
        .values(values)
        .onConflict((oc) =>
          oc.column('scope_key').doUpdateSet({
            snapshot_id: values.snapshot_id,
            storage_schema_version: values.storage_schema_version,
            calculation_engine_version: values.calculation_engine_version,
            artifact_kind: values.artifact_kind,
            links_built_at: values.links_built_at,
            asset_review_built_at: values.asset_review_built_at,
            prices_last_mutated_at: values.prices_last_mutated_at,
            exclusion_fingerprint: values.exclusion_fingerprint,
            calculation_id: values.calculation_id,
            jurisdiction: values.jurisdiction,
            method: values.method,
            tax_year: values.tax_year,
            display_currency: values.display_currency,
            start_date: values.start_date,
            end_date: values.end_date,
            artifact_json: values.artifact_json,
            debug_json: values.debug_json,
            created_at: values.created_at,
            updated_at: values.updated_at,
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error, scopeKey: snapshot.scopeKey }, 'Failed to replace latest cost-basis snapshot');
      return wrapError(error, `Failed to replace latest cost-basis snapshot for ${snapshot.scopeKey}`);
    }
  }

  async deleteLatest(scopeKeys?: string[]): Promise<Result<number, Error>> {
    try {
      if (scopeKeys && scopeKeys.length === 0) {
        return ok(0);
      }

      if (!scopeKeys) {
        const result = await this.db.deleteFrom('cost_basis_snapshots').executeTakeFirst();
        return ok(Number(result.numDeletedRows));
      }

      let deletedCount = 0;
      for (const scopeKeyBatch of chunkItems(scopeKeys, SQLITE_SAFE_IN_BATCH_SIZE)) {
        const result = await this.db
          .deleteFrom('cost_basis_snapshots')
          .where('scope_key', 'in', scopeKeyBatch)
          .executeTakeFirst();
        deletedCount += Number(result.numDeletedRows);
      }

      return ok(deletedCount);
    } catch (error) {
      this.logger.error({ error, scopeKeys }, 'Failed to delete cost-basis snapshots');
      return wrapError(error, 'Failed to delete cost-basis snapshots');
    }
  }

  async count(): Promise<Result<number, Error>> {
    try {
      const row = await this.db
        .selectFrom('cost_basis_snapshots')
        .select(({ fn }) => [fn.count<number>('scope_key').as('count')])
        .executeTakeFirst();

      return ok(row?.count ?? 0);
    } catch (error) {
      this.logger.error({ error }, 'Failed to count cost-basis snapshots');
      return wrapError(error, 'Failed to count cost-basis snapshots');
    }
  }

  private toRecord(row: {
    artifact_json: unknown;
    artifact_kind: string;
    asset_review_built_at: string;
    calculation_engine_version: number;
    calculation_id: string;
    created_at: string;
    debug_json: unknown;
    display_currency: string;
    end_date: string;
    exclusion_fingerprint: string;
    jurisdiction: string;
    links_built_at: string;
    method: string;
    prices_last_mutated_at: string | null;
    scope_key: string;
    snapshot_id: string;
    start_date: string;
    storage_schema_version: number;
    tax_year: number;
    updated_at: string;
  }): CostBasisSnapshotRecord {
    return {
      scopeKey: row.scope_key,
      snapshotId: row.snapshot_id,
      storageSchemaVersion: row.storage_schema_version,
      calculationEngineVersion: row.calculation_engine_version,
      artifactKind: row.artifact_kind as CostBasisSnapshotRecord['artifactKind'],
      linksBuiltAt: new Date(row.links_built_at),
      assetReviewBuiltAt: new Date(row.asset_review_built_at),
      ...(row.prices_last_mutated_at ? { pricesLastMutatedAt: new Date(row.prices_last_mutated_at) } : {}),
      exclusionFingerprint: row.exclusion_fingerprint,
      calculationId: row.calculation_id,
      jurisdiction: row.jurisdiction,
      method: row.method,
      taxYear: row.tax_year,
      displayCurrency: row.display_currency,
      startDate: row.start_date,
      endDate: row.end_date,
      artifactJson: row.artifact_json as string,
      debugJson: row.debug_json as string,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
