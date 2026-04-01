import { buildCostBasisResetPorts } from '@exitbook/data/accounting';
import { buildIngestionPurgePorts } from '@exitbook/data/ingestion';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';

import {
  countProjectionResetImpact,
  resetProjections,
  type ProjectionResetImpact,
} from '../../../runtime/projection-reset.js';

interface ProfileRemovePreview {
  accountIds: number[];
  deleted: {
    assetReview: ProjectionResetImpact['assetReview'];
    balances: ProjectionResetImpact['balances'];
    costBasisSnapshots: { snapshots: number };
    links: ProjectionResetImpact['links'];
    processedTransactions: ProjectionResetImpact['processedTransactions'];
    profiles: number;
    purge: {
      accounts: number;
      rawData: number;
      sessions: number;
    };
  };
}

export interface ProfileRemovalImpactCounts {
  profiles: number;
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

interface ProfileRemoveResult {
  deleted: ProfileRemovalImpactCounts;
}

export function flattenProfileRemovePreview(preview: ProfileRemovePreview): ProfileRemovalImpactCounts {
  return {
    profiles: preview.deleted.profiles,
    transactions: preview.deleted.processedTransactions.transactions,
    links: preview.deleted.links.links,
    assetReviewStates: preview.deleted.assetReview.assets,
    balanceSnapshots: preview.deleted.balances.scopes,
    balanceSnapshotAssets: preview.deleted.balances.assetRows,
    costBasisSnapshots: preview.deleted.costBasisSnapshots.snapshots,
    accounts: preview.deleted.purge.accounts,
    sessions: preview.deleted.purge.sessions,
    rawData: preview.deleted.purge.rawData,
  };
}

function createEmptyProfileRemovePreview(accountIds: number[]): ProfileRemovePreview {
  return {
    accountIds,
    deleted: {
      profiles: 1,
      assetReview: { assets: 0 },
      balances: { scopes: 0, assetRows: 0 },
      costBasisSnapshots: { snapshots: 0 },
      links: { links: 0 },
      processedTransactions: { transactions: 0 },
      purge: {
        accounts: accountIds.length,
        rawData: 0,
        sessions: 0,
      },
    },
  };
}

export class ProfileRemovalService {
  constructor(private readonly db: DataSession) {}

  async preview(accountIds: number[]): Promise<Result<ProfileRemovePreview, Error>> {
    if (accountIds.length === 0) {
      return ok(createEmptyProfileRemovePreview(accountIds));
    }

    const [projectionImpactResult, costBasisResult, purgeResult] = await Promise.all([
      countProjectionResetImpact(this.db, 'processed-transactions', accountIds),
      buildCostBasisResetPorts(this.db).countResetImpact(),
      buildIngestionPurgePorts(this.db).countPurgeImpact(accountIds),
    ]);

    if (projectionImpactResult.isErr()) {
      return wrapError(projectionImpactResult.error, 'Failed to count profile removal projection impact');
    }
    if (costBasisResult.isErr()) {
      return wrapError(costBasisResult.error, 'Failed to count profile removal cost-basis impact');
    }
    if (purgeResult.isErr()) {
      return wrapError(purgeResult.error, 'Failed to count profile removal purge impact');
    }

    return ok({
      accountIds,
      deleted: {
        profiles: 1,
        assetReview: projectionImpactResult.value.assetReview,
        balances: projectionImpactResult.value.balances,
        links: projectionImpactResult.value.links,
        processedTransactions: projectionImpactResult.value.processedTransactions,
        costBasisSnapshots: costBasisResult.value,
        purge: purgeResult.value,
      },
    });
  }

  async execute(profileKey: string, accountIds: number[]): Promise<Result<ProfileRemoveResult, Error>> {
    const previewResult = await this.preview(accountIds);
    if (previewResult.isErr()) {
      return err(previewResult.error);
    }

    const removalResult = await this.db.executeInTransaction(async (txDb) => {
      if (accountIds.length > 0) {
        const projectionResetResult = await resetProjections(txDb, 'processed-transactions', accountIds);
        if (projectionResetResult.isErr()) {
          return wrapError(projectionResetResult.error, 'Failed to reset projections for profile removal');
        }

        const costBasisResetResult = await buildCostBasisResetPorts(txDb).reset();
        if (costBasisResetResult.isErr()) {
          return wrapError(costBasisResetResult.error, 'Failed to reset cost-basis snapshots for profile removal');
        }

        const purgeResult = await buildIngestionPurgePorts(txDb).purgeImportedData(accountIds);
        if (purgeResult.isErr()) {
          return wrapError(purgeResult.error, 'Failed to purge profile data for removal');
        }
      }

      const deleteProfileResult = await txDb.profiles.deleteByKey(profileKey);
      if (deleteProfileResult.isErr()) {
        return wrapError(deleteProfileResult.error, 'Failed to delete profile during removal');
      }

      return ok({
        deleted: flattenProfileRemovePreview(previewResult.value),
      });
    });

    if (removalResult.isErr()) {
      return err(removalResult.error);
    }

    return ok(removalResult.value);
  }
}
