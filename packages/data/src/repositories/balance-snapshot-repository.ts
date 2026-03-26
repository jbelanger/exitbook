/* eslint-disable unicorn/no-null -- null required for db */
import type { BalanceSnapshot, BalanceSnapshotAsset } from '@exitbook/core';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';

import type { KyselyDB } from '../database.js';
import { chunkItems, SQLITE_SAFE_INSERT_BATCH_SIZE, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';

import { BaseRepository } from './base-repository.js';

interface BalanceSnapshotRecord {
  calculated_at: string | null;
  coverage_confidence: string | null;
  coverage_status: string | null;
  failed_address_count: number | null;
  failed_asset_count: number | null;
  last_error: string | null;
  last_refresh_at: string | null;
  match_count: number;
  mismatch_count: number;
  parsed_asset_count: number | null;
  requested_address_count: number | null;
  scope_account_id: number;
  status_reason: string | null;
  successful_address_count: number | null;
  suggestion: string | null;
  total_asset_count: number | null;
  verification_status: string;
  warning_count: number;
}

interface BalanceSnapshotAssetRecord {
  asset_id: string;
  asset_symbol: string;
  calculated_balance: string;
  comparison_status: string | null;
  difference: string | null;
  excluded_from_accounting: number | boolean;
  live_balance: string | null;
  scope_account_id: number;
}

export class BalanceSnapshotRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'balance-snapshot-repository');
  }

  async findSnapshot(scopeAccountId: number): Promise<Result<BalanceSnapshot | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('balance_snapshots')
        .select([
          'scope_account_id',
          'calculated_at',
          'last_refresh_at',
          'verification_status',
          'coverage_status',
          'coverage_confidence',
          'requested_address_count',
          'successful_address_count',
          'failed_address_count',
          'total_asset_count',
          'parsed_asset_count',
          'failed_asset_count',
          'match_count',
          'warning_count',
          'mismatch_count',
          'status_reason',
          'suggestion',
          'last_error',
        ])
        .where('scope_account_id', '=', scopeAccountId)
        .executeTakeFirst();

      return ok(row ? this.toSnapshot(row) : undefined);
    } catch (error) {
      this.logger.error({ error, scopeAccountId }, 'Failed to load balance snapshot');
      return wrapError(error, 'Failed to load balance snapshot');
    }
  }

  async findSnapshots(scopeAccountIds?: number[]): Promise<Result<BalanceSnapshot[], Error>> {
    if (scopeAccountIds?.length === 0) {
      return ok([]);
    }

    try {
      const rows: BalanceSnapshotRecord[] = [];

      if (scopeAccountIds) {
        for (const scopeAccountIdBatch of chunkItems(scopeAccountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
          rows.push(
            ...(await this.db
              .selectFrom('balance_snapshots')
              .select([
                'scope_account_id',
                'calculated_at',
                'last_refresh_at',
                'verification_status',
                'coverage_status',
                'coverage_confidence',
                'requested_address_count',
                'successful_address_count',
                'failed_address_count',
                'total_asset_count',
                'parsed_asset_count',
                'failed_asset_count',
                'match_count',
                'warning_count',
                'mismatch_count',
                'status_reason',
                'suggestion',
                'last_error',
              ])
              .where('scope_account_id', 'in', scopeAccountIdBatch)
              .orderBy('scope_account_id', 'asc')
              .execute())
          );
        }
      } else {
        rows.push(
          ...(await this.db
            .selectFrom('balance_snapshots')
            .select([
              'scope_account_id',
              'calculated_at',
              'last_refresh_at',
              'verification_status',
              'coverage_status',
              'coverage_confidence',
              'requested_address_count',
              'successful_address_count',
              'failed_address_count',
              'total_asset_count',
              'parsed_asset_count',
              'failed_asset_count',
              'match_count',
              'warning_count',
              'mismatch_count',
              'status_reason',
              'suggestion',
              'last_error',
            ])
            .orderBy('scope_account_id', 'asc')
            .execute())
        );
      }

      rows.sort((left, right) => left.scope_account_id - right.scope_account_id);

      return ok(rows.map((row) => this.toSnapshot(row)));
    } catch (error) {
      this.logger.error({ error, scopeAccountIds }, 'Failed to list balance snapshots');
      return wrapError(error, 'Failed to list balance snapshots');
    }
  }

  async findAssetsByScope(scopeAccountIds?: number[]): Promise<Result<BalanceSnapshotAsset[], Error>> {
    if (scopeAccountIds?.length === 0) {
      return ok([]);
    }

    try {
      const rows: BalanceSnapshotAssetRecord[] = [];

      if (scopeAccountIds) {
        for (const scopeAccountIdBatch of chunkItems(scopeAccountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
          rows.push(
            ...(await this.db
              .selectFrom('balance_snapshot_assets')
              .selectAll()
              .where('scope_account_id', 'in', scopeAccountIdBatch)
              .orderBy('scope_account_id', 'asc')
              .orderBy('asset_id', 'asc')
              .execute())
          );
        }
      } else {
        rows.push(
          ...(await this.db
            .selectFrom('balance_snapshot_assets')
            .selectAll()
            .orderBy('scope_account_id', 'asc')
            .orderBy('asset_id', 'asc')
            .execute())
        );
      }

      rows.sort(
        (left, right) => left.scope_account_id - right.scope_account_id || left.asset_id.localeCompare(right.asset_id)
      );

      return ok(rows.map((row) => this.toSnapshotAsset(row)));
    } catch (error) {
      this.logger.error({ error, scopeAccountIds }, 'Failed to list balance snapshot assets');
      return wrapError(error, 'Failed to list balance snapshot assets');
    }
  }

  async findAssetsGroupedByAssetId(
    scopeAccountIds?: number[]
  ): Promise<Result<Map<string, BalanceSnapshotAsset[]>, Error>> {
    const assetsResult = await this.findAssetsByScope(scopeAccountIds);
    if (assetsResult.isErr()) {
      return err(assetsResult.error);
    }

    const grouped = new Map<string, BalanceSnapshotAsset[]>();

    for (const asset of assetsResult.value) {
      const existing = grouped.get(asset.assetId) ?? [];
      existing.push(asset);
      grouped.set(asset.assetId, existing);
    }

    return ok(grouped);
  }

  async replaceSnapshot(params: {
    assets: BalanceSnapshotAsset[];
    snapshot: BalanceSnapshot;
  }): Promise<Result<void, Error>> {
    const { assets, snapshot } = params;
    const scopeAccountId = snapshot.scopeAccountId;

    try {
      await this.db.deleteFrom('balance_snapshot_assets').where('scope_account_id', '=', scopeAccountId).execute();
      await this.db.deleteFrom('balance_snapshots').where('scope_account_id', '=', scopeAccountId).execute();

      await this.db.insertInto('balance_snapshots').values(this.toSnapshotRow(snapshot)).execute();

      const assetRows = assets.map((asset) => this.toSnapshotAssetRow(asset));
      for (const assetRowBatch of chunkItems(assetRows, SQLITE_SAFE_INSERT_BATCH_SIZE)) {
        await this.db.insertInto('balance_snapshot_assets').values(assetRowBatch).execute();
      }

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error, scopeAccountId }, 'Failed to replace balance snapshot');
      return wrapError(error, 'Failed to replace balance snapshot');
    }
  }

  async deleteByScopeAccountIds(scopeAccountIds?: number[]): Promise<Result<number, Error>> {
    if (scopeAccountIds?.length === 0) {
      return ok(0);
    }

    try {
      if (!scopeAccountIds) {
        const countRow = await this.db
          .selectFrom('balance_snapshots')
          .select(({ fn }) => [fn.count<number>('scope_account_id').as('count')])
          .executeTakeFirst();

        const deletedCount = Number(countRow?.count ?? 0);
        await this.db.deleteFrom('balance_snapshots').execute();
        return ok(deletedCount);
      }

      let deletedCount = 0;
      for (const scopeAccountIdBatch of chunkItems(scopeAccountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
        const countRow = await this.db
          .selectFrom('balance_snapshots')
          .select(({ fn }) => [fn.count<number>('scope_account_id').as('count')])
          .where('scope_account_id', 'in', scopeAccountIdBatch)
          .executeTakeFirst();

        deletedCount += Number(countRow?.count ?? 0);
        await this.db.deleteFrom('balance_snapshots').where('scope_account_id', 'in', scopeAccountIdBatch).execute();
      }

      return ok(deletedCount);
    } catch (error) {
      this.logger.error({ error, scopeAccountIds }, 'Failed to delete balance snapshots');
      return wrapError(error, 'Failed to delete balance snapshots');
    }
  }

  private toSnapshot(row: BalanceSnapshotRecord): BalanceSnapshot {
    return {
      scopeAccountId: row.scope_account_id,
      calculatedAt: row.calculated_at ? new Date(row.calculated_at) : undefined,
      lastRefreshAt: row.last_refresh_at ? new Date(row.last_refresh_at) : undefined,
      verificationStatus: row.verification_status as BalanceSnapshot['verificationStatus'],
      coverageStatus: row.coverage_status ? (row.coverage_status as BalanceSnapshot['coverageStatus']) : undefined,
      coverageConfidence: row.coverage_confidence
        ? (row.coverage_confidence as BalanceSnapshot['coverageConfidence'])
        : undefined,
      requestedAddressCount: row.requested_address_count ?? undefined,
      successfulAddressCount: row.successful_address_count ?? undefined,
      failedAddressCount: row.failed_address_count ?? undefined,
      totalAssetCount: row.total_asset_count ?? undefined,
      parsedAssetCount: row.parsed_asset_count ?? undefined,
      failedAssetCount: row.failed_asset_count ?? undefined,
      matchCount: row.match_count,
      warningCount: row.warning_count,
      mismatchCount: row.mismatch_count,
      statusReason: row.status_reason ?? undefined,
      suggestion: row.suggestion ?? undefined,
      lastError: row.last_error ?? undefined,
    };
  }

  private toSnapshotAsset(row: BalanceSnapshotAssetRecord): BalanceSnapshotAsset {
    return {
      scopeAccountId: row.scope_account_id,
      assetId: row.asset_id,
      assetSymbol: row.asset_symbol,
      calculatedBalance: row.calculated_balance,
      liveBalance: row.live_balance ?? undefined,
      difference: row.difference ?? undefined,
      comparisonStatus: row.comparison_status
        ? (row.comparison_status as BalanceSnapshotAsset['comparisonStatus'])
        : undefined,
      excludedFromAccounting: Boolean(row.excluded_from_accounting),
    };
  }

  private toSnapshotRow(snapshot: BalanceSnapshot) {
    const now = new Date().toISOString();

    return {
      scope_account_id: snapshot.scopeAccountId,
      calculated_at: snapshot.calculatedAt?.toISOString() ?? null,
      last_refresh_at: snapshot.lastRefreshAt?.toISOString() ?? null,
      verification_status: snapshot.verificationStatus,
      coverage_status: snapshot.coverageStatus ?? null,
      coverage_confidence: snapshot.coverageConfidence ?? null,
      requested_address_count: snapshot.requestedAddressCount ?? null,
      successful_address_count: snapshot.successfulAddressCount ?? null,
      failed_address_count: snapshot.failedAddressCount ?? null,
      total_asset_count: snapshot.totalAssetCount ?? null,
      parsed_asset_count: snapshot.parsedAssetCount ?? null,
      failed_asset_count: snapshot.failedAssetCount ?? null,
      match_count: snapshot.matchCount,
      warning_count: snapshot.warningCount,
      mismatch_count: snapshot.mismatchCount,
      status_reason: snapshot.statusReason ?? null,
      suggestion: snapshot.suggestion ?? null,
      last_error: snapshot.lastError ?? null,
      created_at: now,
      updated_at: now,
    };
  }

  private toSnapshotAssetRow(asset: BalanceSnapshotAsset) {
    return {
      scope_account_id: asset.scopeAccountId,
      asset_id: asset.assetId,
      asset_symbol: asset.assetSymbol,
      calculated_balance: asset.calculatedBalance,
      live_balance: asset.liveBalance ?? null,
      difference: asset.difference ?? null,
      comparison_status: asset.comparisonStatus ?? null,
      excluded_from_accounting: asset.excludedFromAccounting,
    };
  }
}
