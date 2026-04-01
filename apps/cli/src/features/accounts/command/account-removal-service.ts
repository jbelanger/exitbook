import { buildCostBasisResetPorts } from '@exitbook/data/accounting';
import { buildIngestionPurgePorts } from '@exitbook/data/ingestion';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';

import {
  countProjectionResetImpact,
  resetProjections,
  type ProjectionResetImpact,
} from '../../../runtime/projection-reset.js';

interface AccountRemovePreview {
  accountIds: number[];
  deleted: {
    assetReview: ProjectionResetImpact['assetReview'];
    balances: ProjectionResetImpact['balances'];
    costBasisSnapshots: { snapshots: number };
    links: ProjectionResetImpact['links'];
    processedTransactions: ProjectionResetImpact['processedTransactions'];
    purge: {
      accounts: number;
      rawData: number;
      sessions: number;
    };
  };
}

export interface AccountRemovalImpactCounts {
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

interface AccountRemoveResult {
  deleted: AccountRemovalImpactCounts;
}

export function flattenAccountRemovePreview(preview: AccountRemovePreview): AccountRemovalImpactCounts {
  return {
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

export class AccountRemovalService {
  constructor(private readonly db: DataSession) {}

  async preview(accountIds: number[]): Promise<Result<AccountRemovePreview, Error>> {
    if (accountIds.length === 0) {
      return err(new Error('No account IDs provided for removal'));
    }

    const [projectionImpactResult, costBasisResult, purgeResult] = await Promise.all([
      countProjectionResetImpact(this.db, 'processed-transactions', accountIds),
      buildCostBasisResetPorts(this.db).countResetImpact(),
      buildIngestionPurgePorts(this.db).countPurgeImpact(accountIds),
    ]);

    if (projectionImpactResult.isErr()) {
      return wrapError(projectionImpactResult.error, 'Failed to count account removal projection impact');
    }
    if (costBasisResult.isErr()) {
      return wrapError(costBasisResult.error, 'Failed to count account removal cost-basis impact');
    }
    if (purgeResult.isErr()) {
      return wrapError(purgeResult.error, 'Failed to count account removal purge impact');
    }

    return ok({
      accountIds,
      deleted: {
        assetReview: projectionImpactResult.value.assetReview,
        balances: projectionImpactResult.value.balances,
        links: projectionImpactResult.value.links,
        processedTransactions: projectionImpactResult.value.processedTransactions,
        costBasisSnapshots: costBasisResult.value,
        purge: purgeResult.value,
      },
    });
  }

  async execute(accountIds: number[]): Promise<Result<AccountRemoveResult, Error>> {
    if (accountIds.length === 0) {
      return err(new Error('No account IDs provided for removal'));
    }

    const previewResult = await this.preview(accountIds);
    if (previewResult.isErr()) {
      return err(previewResult.error);
    }

    const deleteOrder = accountIds.slice().reverse();

    const removalResult = await this.db.executeInTransaction(async (txDb) => {
      const projectionResetResult = await resetProjections(txDb, 'processed-transactions', accountIds);
      if (projectionResetResult.isErr()) {
        return wrapError(projectionResetResult.error, 'Failed to reset projections for account removal');
      }

      const costBasisResetResult = await buildCostBasisResetPorts(txDb).reset();
      if (costBasisResetResult.isErr()) {
        return wrapError(costBasisResetResult.error, 'Failed to reset cost-basis snapshots for account removal');
      }

      const purgeResult = await buildIngestionPurgePorts(txDb).purgeImportedData(deleteOrder);
      if (purgeResult.isErr()) {
        return wrapError(purgeResult.error, 'Failed to purge account data for removal');
      }

      return ok({
        deleted: flattenAccountRemovePreview(previewResult.value),
      });
    });

    if (removalResult.isErr()) {
      return err(removalResult.error);
    }

    return ok(removalResult.value);
  }
}
