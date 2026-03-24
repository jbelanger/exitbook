import type { Account } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { buildCostBasisResetPorts, buildIngestionPurgePorts } from '@exitbook/data';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { IngestionPurgeImpact } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

import {
  countProjectionResetImpact,
  resetProjections,
  type ProjectionResetImpact,
} from '../../shared/consumer-input-prereqs.js';

const logger = getLogger('ClearHandler');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClearParams {
  accountId?: number | undefined;
  source?: string | undefined;
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
  if (params.accountId && params.source) {
    return err(new Error('Cannot specify both accountId and source'));
  }
  if (params.accountId && params.accountId <= 0) {
    return err(new Error('accountId must be positive'));
  }
  return ok(undefined);
}

function describeFilters(params: ClearParams): string {
  const parts: string[] = [];
  if (params.accountId !== undefined) parts.push(`accountId=${params.accountId}`);
  if (params.source !== undefined) parts.push(`source=${params.source}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface ClearHandlerDeps {
  db: DataContext;
}

/**
 * Composes projection-native resets → optional purge.
 * CLI-owned orchestration — not a package-level workflow.
 */
export function createClearHandler(deps: ClearHandlerDeps) {
  const { db } = deps;

  async function resolveAccountIds(params: ClearParams): Promise<Result<number[] | undefined, Error>> {
    if (!params.accountId && !params.source) return ok(undefined);

    const userResult = await db.users.findOrCreateDefault();
    if (userResult.isErr()) return err(userResult.error);
    const user = userResult.value;

    if (params.accountId) {
      const result = await db.accounts.findAll({ userId: user.id });
      if (result.isErr()) return err(result.error);
      const account = result.value.find((acc: Account) => acc.id === params.accountId);
      if (!account) {
        return err(new Error(`Account ${params.accountId} not found for user ${user.id}`));
      }
      return ok([account.id]);
    }

    if (params.source) {
      const result = await db.accounts.findAll({ userId: user.id, sourceName: params.source });
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

  return {
    async preview(params: ClearParams): Promise<Result<DeletionPreview, Error>> {
      const validation = validateClearParams(params);
      if (validation.isErr()) return wrapError(validation.error, 'Invalid clear parameters');

      const accountIdsResult = await resolveAccountIds(params);
      if (accountIdsResult.isErr()) return wrapError(accountIdsResult.error, 'Failed to resolve accounts');
      const accountIds = accountIdsResult.value;

      const costBasisReset = buildCostBasisResetPorts(db);
      const [projectionImpactResult, costBasisResult] = await Promise.all([
        countProjectionResetImpact(db, 'processed-transactions', accountIds),
        costBasisReset.countResetImpact(),
      ]);
      if (projectionImpactResult.isErr()) {
        return wrapError(projectionImpactResult.error, 'Failed to count projection reset impact');
      }
      if (costBasisResult.isErr())
        return wrapError(costBasisResult.error, 'Failed to count cost-basis snapshot impact');

      let purge: IngestionPurgeImpact | undefined;
      if (params.includeRaw) {
        const ingestionPurge = buildIngestionPurgePorts(db);
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
    },

    async execute(params: ClearParams): Promise<Result<ClearResult, Error>> {
      const validation = validateClearParams(params);
      if (validation.isErr()) return wrapError(validation.error, 'Invalid clear parameters');

      const accountIdsResult = await resolveAccountIds(params);
      if (accountIdsResult.isErr()) return wrapError(accountIdsResult.error, 'Failed to resolve accounts');
      const accountIds = accountIdsResult.value;

      logger.debug(
        { includeRaw: params.includeRaw, source: params.source, accountId: params.accountId },
        'Starting data clearing'
      );

      // All resets run inside a single DB transaction — ports are built from
      // the transaction-scoped context so their internal executeInTransaction
      // calls become no-ops (isTransactionScoped short-circuit).
      return db.executeInTransaction(async (txDb) => {
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
    },
  };
}

export type ClearHandler = ReturnType<typeof createClearHandler>;
