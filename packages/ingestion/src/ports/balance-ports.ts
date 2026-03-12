import type {
  Account,
  BalanceSnapshot,
  BalanceSnapshotAsset,
  ImportSession,
  Result,
  UniversalTransactionData,
} from '@exitbook/core';

export interface IBalanceAccountLookup {
  findById(id: number): Promise<Result<Account | undefined, Error>>;
  findChildAccounts(parentAccountId: number): Promise<Result<Account[], Error>>;
}

export interface IBalanceSnapshotStore {
  replaceSnapshot(params: { assets: BalanceSnapshotAsset[]; snapshot: BalanceSnapshot }): Promise<Result<void, Error>>;
}

export interface IBalanceProjectionStateStore {
  markBuilding(scopeAccountId: number): Promise<Result<void, Error>>;
  markFailed(scopeAccountId: number): Promise<Result<void, Error>>;
  markFresh(scopeAccountId: number): Promise<Result<void, Error>>;
}

export interface IBalanceImportSessionLookup {
  findByAccountIds(accountIds: number[]): Promise<Result<ImportSession[], Error>>;
}

export interface IBalanceTransactionSource {
  findByAccountIds(params: {
    accountIds: number[];
    includeExcluded?: boolean | undefined;
  }): Promise<Result<UniversalTransactionData[], Error>>;
}

/**
 * All driven ports required by the balance verification workflow.
 * Constructed in the composition root (CLI) and injected into BalanceWorkflow.
 */
export interface BalancePorts {
  accountLookup: IBalanceAccountLookup;
  snapshotStore: IBalanceSnapshotStore;
  projectionState: IBalanceProjectionStateStore;
  importSessionLookup: IBalanceImportSessionLookup;
  transactionSource: IBalanceTransactionSource;
}
