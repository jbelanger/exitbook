import type {
  Account,
  AssetReviewSummary,
  BalanceSnapshot,
  BalanceSnapshotAsset,
  ImportSession,
  Transaction,
} from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

export interface BalanceTransactionQuery {
  accountIds: number[];
  includeExcluded?: boolean | undefined;
}

export interface BalancePorts {
  findById(id: number): Promise<Result<Account | undefined, Error>>;
  findChildAccounts(parentAccountId: number): Promise<Result<Account[], Error>>;
  replaceSnapshot(params: { assets: BalanceSnapshotAsset[]; snapshot: BalanceSnapshot }): Promise<Result<void, Error>>;
  markBuilding(scopeAccountId: number): Promise<Result<void, Error>>;
  markFailed(scopeAccountId: number): Promise<Result<void, Error>>;
  markFresh(scopeAccountId: number): Promise<Result<void, Error>>;
  findByAccountIds(accountIds: number[]): Promise<Result<ImportSession[], Error>>;
  findAssetReviewSummariesByAssetIds(
    profileId: number,
    assetIds: string[]
  ): Promise<Result<Map<string, AssetReviewSummary>, Error>>;
  findTransactionsByAccountIds(params: BalanceTransactionQuery): Promise<Result<Transaction[], Error>>;
}
