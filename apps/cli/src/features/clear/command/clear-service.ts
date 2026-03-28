import type { Account } from '@exitbook/core';
import { buildCostBasisResetPorts } from '@exitbook/data/accounting';
import { buildIngestionPurgePorts } from '@exitbook/data/ingestion';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { IngestionPurgeImpact } from '@exitbook/ingestion/ports';
import { getLogger } from '@exitbook/logger';

import {
  countProjectionResetImpact,
  resetProjections,
  type ProjectionResetImpact,
} from '../../../runtime/projection-reset.js';

const logger = getLogger('ClearService');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClearParams {
  profileId: number;
  accountId?: number | undefined;
  platformKey?: string | undefined;
  includeRaw: boolean;
}

export interface DeletionPreview {
  assetReview: ProjectionResetImpact['assetReview'];
  balances: ProjectionResetImpact['balances'];
  links: ProjectionResetImpact['links'];
  processedTransactions: ProjectionResetImpact['processedTransactions'];
  costBasisSnapshots: { snapshots: number };
  purge: IngestionPurgeImpact | undefined;
}

export interface ClearResult {
  deleted: DeletionPreview;
}

/** Flattened counts for display purposes. */
export interface FlatDeletionPreview {
  transactions: number;
  links: number;
  assetReviewStates: number;
  balanceSnapshots: number;
  balanceSnapshotAssets: number;
  costBasisSnapshots: number;
  accounts: number;
  sessions: number;
  rawData: number;
}

export function flattenPreview(preview: DeletionPreview): FlatDeletionPreview {
  return {
    transactions: preview.processedTransactions.transactions,
    links: preview.links.links,
    assetReviewStates: preview.assetReview.assets,
    balanceSnapshots: preview.balances.scopes,
    balanceSnapshotAssets: preview.balances.assetRows,
    costBasisSnapshots: preview.costBasisSnapshots.snapshots,
    accounts: preview.purge?.accounts ?? 0,
    sessions: preview.purge?.sessions ?? 0,
    rawData: preview.purge?.rawData ?? 0,
  };
}

export function calculateTotalDeletionItems(flat: FlatDeletionPreview): number {
  return (
    flat.transactions +
    flat.links +
    flat.assetReviewStates +
    flat.balanceSnapshots +
    flat.balanceSnapshotAssets +
    flat.costBasisSnapshots +
    flat.accounts +
    flat.sessions +
    flat.rawData
  );
}

// ---------------------------------------------------------------------------
// Params validation (pure)
// ---------------------------------------------------------------------------

function validateClearParams(params: ClearParams): Result<void, Error> {
  if (params.accountId && params.platformKey) {
    return err(new Error('Cannot specify both accountId and platform'));
  }
  if (params.accountId && params.accountId <= 0) {
    return err(new Error('accountId must be positive'));
  }
  return ok(undefined);
}

function describeFilters(params: ClearParams): string {
  const parts: string[] = [];
  if (params.accountId !== undefined) parts.push(`accountId=${params.accountId}`);
  if (params.platformKey !== undefined) parts.push(`platform=${params.platformKey}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Composes projection-native resets → optional purge.
 * CLI-owned orchestration — not a package-level workflow.
 */
export class ClearService {
  constructor(private readonly db: DataSession) {}

  async preview(params: ClearParams): Promise<Result<DeletionPreview, Error>> {
    const validation = validateClearParams(params);
    if (validation.isErr()) return wrapError(validation.error, 'Invalid clear parameters');

    const accountIdsResult = await this.resolveAccountIds(params);
    if (accountIdsResult.isErr()) return wrapError(accountIdsResult.error, 'Failed to resolve accounts');
    const accountIds = accountIdsResult.value;

    const costBasisReset = buildCostBasisResetPorts(this.db);
    const [projectionImpactResult, costBasisResult] = await Promise.all([
      countProjectionResetImpact(this.db, 'processed-transactions', accountIds),
      costBasisReset.countResetImpact(),
    ]);
    if (projectionImpactResult.isErr()) {
      return wrapError(projectionImpactResult.error, 'Failed to count projection reset impact');
    }
    if (costBasisResult.isErr()) {
      return wrapError(costBasisResult.error, 'Failed to count cost-basis snapshot impact');
    }

    let purge: IngestionPurgeImpact | undefined;
    if (params.includeRaw) {
      const ingestionPurge = buildIngestionPurgePorts(this.db);
      const purgeResult = await ingestionPurge.countPurgeImpact(accountIds);
      if (purgeResult.isErr()) return wrapError(purgeResult.error, 'Failed to count purge impact');
      purge = purgeResult.value;
    }

    return ok({
      assetReview: projectionImpactResult.value.assetReview,
      balances: projectionImpactResult.value.balances,
      links: projectionImpactResult.value.links,
      processedTransactions: projectionImpactResult.value.processedTransactions,
      costBasisSnapshots: costBasisResult.value,
      purge,
    });
  }

  async execute(params: ClearParams): Promise<Result<ClearResult, Error>> {
    const validation = validateClearParams(params);
    if (validation.isErr()) return wrapError(validation.error, 'Invalid clear parameters');

    const accountIdsResult = await this.resolveAccountIds(params);
    if (accountIdsResult.isErr()) return wrapError(accountIdsResult.error, 'Failed to resolve accounts');
    const accountIds = accountIdsResult.value;

    logger.debug(
      { includeRaw: params.includeRaw, platformKey: params.platformKey, accountId: params.accountId },
      'Starting data clearing'
    );

    // All resets run inside a single DB transaction — ports are built from
    // the transaction-scoped context so their internal executeInTransaction
    // calls become no-ops (isTransactionScoped short-circuit).
    return this.db.executeInTransaction(async (txDb) => {
      const projectionResetResult = await resetProjections(txDb, 'processed-transactions', accountIds);
      if (projectionResetResult.isErr()) {
        return wrapError(projectionResetResult.error, 'Failed to reset projections');
      }

      // Cost-basis latest snapshots are derived artifacts outside the projection graph.
      const costBasisResetResult = await buildCostBasisResetPorts(txDb).reset();
      if (costBasisResetResult.isErr()) {
        return wrapError(costBasisResetResult.error, 'Failed to reset cost-basis snapshots');
      }

      // Optional purge (raw data, sessions, accounts)
      let purge: IngestionPurgeImpact | undefined;
      if (params.includeRaw) {
        const ingestionPurge = buildIngestionPurgePorts(txDb);
        const purgeResult = await ingestionPurge.purgeImportedData(accountIds);
        if (purgeResult.isErr()) return wrapError(purgeResult.error, 'Failed to purge imported data');
        purge = purgeResult.value;
      }

      const deleted: DeletionPreview = {
        assetReview: projectionResetResult.value.assetReview,
        balances: projectionResetResult.value.balances,
        links: projectionResetResult.value.links,
        processedTransactions: projectionResetResult.value.processedTransactions,
        costBasisSnapshots: costBasisResetResult.value,
        purge,
      };

      logger.debug({ deleted }, 'Data clearing completed');

      return ok({ deleted });
    });
  }

  private async resolveAccountIds(params: ClearParams): Promise<Result<number[] | undefined, Error>> {
    if (!params.accountId && !params.platformKey) return ok(undefined);

    if (params.accountId) {
      const result = await this.db.accounts.findAll({ profileId: params.profileId });
      if (result.isErr()) return err(result.error);
      const account = result.value.find((acc: Account) => acc.id === params.accountId);
      if (!account) {
        return err(new Error(`Account ${params.accountId} not found for profile ${params.profileId}`));
      }
      return ok([account.id]);
    }

    if (params.platformKey) {
      const result = await this.db.accounts.findAll({ profileId: params.profileId, platformKey: params.platformKey });
      if (result.isErr()) return err(result.error);
      if (result.value.length === 0) {
        return err(
          new Error(`No accounts matched the provided filters (${describeFilters(params)}). No data deleted.`)
        );
      }
      return ok(result.value.map((acc: Account) => acc.id));
    }

    return ok(undefined);
  }
}
