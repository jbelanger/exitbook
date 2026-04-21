import type { Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

export interface LoadTransactionForInterpretationInput {
  accountId: number;
  transactionId: number;
}

export interface LoadProfileInterpretationScopeInput {
  profileId: number;
}

export interface InterpretationAccountContext {
  accountId: number;
  identifier: string;
  profileId: number;
}

export interface ProfileInterpretationScope {
  accounts: readonly InterpretationAccountContext[];
  transactions: readonly Transaction[];
}

/**
 * Reader port for canonical transaction facts used by interpretation
 * detectors. The runtime owns loading; detectors stay pure over explicit
 * canonical input.
 */
export interface ITransactionInterpretationSourceReader {
  loadTransactionForInterpretation(
    input: LoadTransactionForInterpretationInput
  ): Promise<Result<Transaction | undefined, Error>>;

  loadProfileInterpretationScope(
    input: LoadProfileInterpretationScopeInput
  ): Promise<Result<ProfileInterpretationScope, Error>>;
}
