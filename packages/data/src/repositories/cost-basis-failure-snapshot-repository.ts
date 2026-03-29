/* eslint-disable unicorn/no-null -- db nulls */
import type { CostBasisFailureConsumer, CostBasisFailureSnapshotRecord } from '@exitbook/accounting/ports';
import { ok, wrapError, type Result } from '@exitbook/foundation';

import type { KyselyDB } from '../database.js';
import { chunkItems, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';

import { BaseRepository } from './base-repository.js';

export class CostBasisFailureSnapshotRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'cost-basis-failure-snapshot-repository');
  }

  async replaceLatest(snapshot: CostBasisFailureSnapshotRecord): Promise<Result<void, Error>> {
    try {
      const values = {
        scope_key: snapshot.scopeKey,
        consumer: snapshot.consumer,
        snapshot_id: snapshot.snapshotId,
        links_status: snapshot.linksStatus,
        links_built_at: snapshot.linksBuiltAt?.toISOString() ?? null,
        asset_review_status: snapshot.assetReviewStatus,
        asset_review_built_at: snapshot.assetReviewBuiltAt?.toISOString() ?? null,
        prices_last_mutated_at: snapshot.pricesLastMutatedAt?.toISOString() ?? null,
        exclusion_fingerprint: snapshot.exclusionFingerprint,
        jurisdiction: snapshot.jurisdiction,
        method: snapshot.method,
        tax_year: snapshot.taxYear,
        display_currency: snapshot.displayCurrency,
        start_date: snapshot.startDate,
        end_date: snapshot.endDate,
        error_name: snapshot.errorName,
        error_message: snapshot.errorMessage,
        error_stack: snapshot.errorStack ?? null,
        debug_json: snapshot.debugJson,
        created_at: snapshot.createdAt.toISOString(),
        updated_at: snapshot.updatedAt.toISOString(),
      };

      await this.db
        .insertInto('cost_basis_failure_snapshots')
        .values(values)
        .onConflict((oc) =>
          oc.columns(['scope_key', 'consumer']).doUpdateSet({
            snapshot_id: values.snapshot_id,
            links_status: values.links_status,
            links_built_at: values.links_built_at,
            asset_review_status: values.asset_review_status,
            asset_review_built_at: values.asset_review_built_at,
            prices_last_mutated_at: values.prices_last_mutated_at,
            exclusion_fingerprint: values.exclusion_fingerprint,
            jurisdiction: values.jurisdiction,
            method: values.method,
            tax_year: values.tax_year,
            display_currency: values.display_currency,
            start_date: values.start_date,
            end_date: values.end_date,
            error_name: values.error_name,
            error_message: values.error_message,
            error_stack: values.error_stack,
            debug_json: values.debug_json,
            updated_at: values.updated_at,
          })
        )
        .execute();

      return ok(undefined);
    } catch (error) {
      this.logger.error(
        { error, scopeKey: snapshot.scopeKey, consumer: snapshot.consumer },
        'Failed to replace latest cost-basis failure snapshot'
      );
      return wrapError(
        error,
        `Failed to replace latest cost-basis failure snapshot for ${snapshot.scopeKey} (${snapshot.consumer})`
      );
    }
  }

  async deleteLatest(scopeKeys?: string[], consumers?: CostBasisFailureConsumer[]): Promise<Result<number, Error>> {
    try {
      if ((scopeKeys && scopeKeys.length === 0) || (consumers && consumers.length === 0)) {
        return ok(0);
      }

      if (!scopeKeys) {
        let query = this.db.deleteFrom('cost_basis_failure_snapshots');
        if (consumers) {
          query = query.where('consumer', 'in', consumers);
        }

        const result = await query.executeTakeFirst();
        return ok(Number(result.numDeletedRows));
      }

      let deletedCount = 0;
      for (const scopeKeyBatch of chunkItems(scopeKeys, SQLITE_SAFE_IN_BATCH_SIZE)) {
        let query = this.db.deleteFrom('cost_basis_failure_snapshots').where('scope_key', 'in', scopeKeyBatch);
        if (consumers) {
          query = query.where('consumer', 'in', consumers);
        }

        const result = await query.executeTakeFirst();
        deletedCount += Number(result.numDeletedRows);
      }

      return ok(deletedCount);
    } catch (error) {
      this.logger.error({ error, scopeKeys, consumers }, 'Failed to delete cost-basis failure snapshots');
      return wrapError(error, 'Failed to delete cost-basis failure snapshots');
    }
  }

  async count(consumers?: CostBasisFailureConsumer[]): Promise<Result<number, Error>> {
    try {
      let query = this.db.selectFrom('cost_basis_failure_snapshots');
      if (consumers) {
        query = query.where('consumer', 'in', consumers);
      }

      const row = await query.select(({ fn }) => [fn.count<number>('scope_key').as('count')]).executeTakeFirst();
      return ok(row?.count ?? 0);
    } catch (error) {
      this.logger.error({ error, consumers }, 'Failed to count cost-basis failure snapshots');
      return wrapError(error, 'Failed to count cost-basis failure snapshots');
    }
  }
}
