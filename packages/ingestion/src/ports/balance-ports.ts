import type { Account, ImportSession, Result, UniversalTransactionData, VerificationMetadata } from '@exitbook/core';

export interface IBalanceAccountLookup {
  findById(id: number): Promise<Result<Account | undefined, Error>>;
  findChildAccounts(parentAccountId: number): Promise<Result<Account[], Error>>;
}

export interface IBalanceAccountUpdater {
  updateVerification(
    accountId: number,
    update: { lastBalanceCheckAt: Date; verificationMetadata: VerificationMetadata }
  ): Promise<Result<void, Error>>;
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
  accountUpdater: IBalanceAccountUpdater;
  importSessionLookup: IBalanceImportSessionLookup;
  transactionSource: IBalanceTransactionSource;
}
