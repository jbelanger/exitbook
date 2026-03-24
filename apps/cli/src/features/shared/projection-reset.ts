import { type ProjectionId, resetPlan } from '@exitbook/core';
import {
  buildAssetReviewResetPorts,
  buildBalancesResetPorts,
  buildLinksResetPorts,
  buildProcessedTransactionsResetPorts,
} from '@exitbook/data/projections';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

export interface ProjectionResetImpact {
  assetReview: { assets: number };
  balances: { assetRows: number; scopes: number };
  links: { links: number };
  processedTransactions: { transactions: number };
}

export async function countProjectionResetImpact(
  db: DataSession,
  target: ProjectionId,
  accountIds?: number[]
): Promise<Result<ProjectionResetImpact, Error>> {
  const plan = resetPlan(target);
  const impact = createEmptyProjectionResetImpact();

  for (const projectionId of plan) {
    const result = await countSingleProjection(db, projectionId, accountIds);
    if (result.isErr()) return err(result.error);
    assignProjectionResetImpact(impact, projectionId, result.value);
  }

  return ok(impact);
}

export async function resetProjections(
  db: DataSession,
  target: ProjectionId,
  accountIds?: number[]
): Promise<Result<ProjectionResetImpact, Error>> {
  return db.executeInTransaction(async (txDb) => {
    const plan = resetPlan(target);
    const impact = createEmptyProjectionResetImpact();

    for (const projectionId of plan) {
      const result = await resetSingleProjection(txDb, projectionId, accountIds);
      if (result.isErr()) return err(result.error);
      assignProjectionResetImpact(impact, projectionId, result.value);
    }

    return ok(impact);
  });
}

function countSingleProjection(
  db: DataSession,
  projectionId: ProjectionId,
  accountIds?: number[]
): Promise<Result<ProjectionResetImpact[ProjectionIdToImpactKey<typeof projectionId>], Error>> {
  switch (projectionId) {
    case 'asset-review': {
      const adapter = buildAssetReviewResetPorts(db);
      return adapter.countResetImpact(accountIds);
    }
    case 'balances': {
      const adapter = buildBalancesResetPorts(db);
      return adapter.countResetImpact(accountIds);
    }
    case 'links': {
      const adapter = buildLinksResetPorts(db);
      return adapter.countResetImpact(accountIds);
    }
    case 'processed-transactions': {
      const adapter = buildProcessedTransactionsResetPorts(db);
      return adapter.countResetImpact(accountIds);
    }
  }
}

function resetSingleProjection(
  db: DataSession,
  projectionId: ProjectionId,
  accountIds?: number[]
): Promise<Result<ProjectionResetImpact[ProjectionIdToImpactKey<typeof projectionId>], Error>> {
  switch (projectionId) {
    case 'asset-review': {
      const adapter = buildAssetReviewResetPorts(db);
      return adapter.reset(accountIds);
    }
    case 'balances': {
      const adapter = buildBalancesResetPorts(db);
      return adapter.reset(accountIds);
    }
    case 'links': {
      const adapter = buildLinksResetPorts(db);
      return adapter.reset(accountIds);
    }
    case 'processed-transactions': {
      const adapter = buildProcessedTransactionsResetPorts(db);
      return adapter.reset(accountIds);
    }
  }
}

type ProjectionIdToImpactKey<T extends ProjectionId> = T extends 'asset-review'
  ? 'assetReview'
  : T extends 'processed-transactions'
    ? 'processedTransactions'
    : T;

function createEmptyProjectionResetImpact(): ProjectionResetImpact {
  return {
    processedTransactions: { transactions: 0 },
    assetReview: { assets: 0 },
    balances: { scopes: 0, assetRows: 0 },
    links: { links: 0 },
  };
}

function assignProjectionResetImpact(
  impact: ProjectionResetImpact,
  projectionId: ProjectionId,
  projectionImpact:
    | ProjectionResetImpact['assetReview']
    | ProjectionResetImpact['balances']
    | ProjectionResetImpact['links']
    | ProjectionResetImpact['processedTransactions']
): void {
  switch (projectionId) {
    case 'asset-review':
      impact.assetReview = projectionImpact as ProjectionResetImpact['assetReview'];
      return;
    case 'balances':
      impact.balances = projectionImpact as ProjectionResetImpact['balances'];
      return;
    case 'links':
      impact.links = projectionImpact as ProjectionResetImpact['links'];
      return;
    case 'processed-transactions':
      impact.processedTransactions = projectionImpact as ProjectionResetImpact['processedTransactions'];
  }
}
