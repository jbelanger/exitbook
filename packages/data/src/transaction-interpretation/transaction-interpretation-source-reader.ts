import type { Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import type {
  ITransactionInterpretationSourceReader,
  InterpretationAccountContext,
  LoadProfileInterpretationScopeInput,
  LoadTransactionForInterpretationInput,
  ProfileInterpretationScope,
} from '@exitbook/transaction-interpretation';

import type { AccountRepository } from '../repositories/account-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';

export class TransactionInterpretationSourceReader implements ITransactionInterpretationSourceReader {
  readonly #accounts: AccountRepository;
  readonly #transactions: TransactionRepository;

  constructor(transactions: TransactionRepository, accounts: AccountRepository) {
    this.#transactions = transactions;
    this.#accounts = accounts;
  }

  async loadTransactionForInterpretation(
    input: LoadTransactionForInterpretationInput
  ): Promise<Result<Transaction | undefined, Error>> {
    const transactionResult = await this.#transactions.findById(input.transactionId);
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }

    const transaction = transactionResult.value;
    if (transaction === undefined) {
      return transactionResult;
    }

    if (transaction.accountId !== input.accountId) {
      return err(
        new Error(
          `Transaction ${input.transactionId} belongs to account ${transaction.accountId}, expected ${input.accountId}`
        )
      );
    }

    return transactionResult;
  }

  async loadProfileInterpretationScope(
    input: LoadProfileInterpretationScopeInput
  ): Promise<Result<ProfileInterpretationScope, Error>> {
    const transactionsResult = await this.#transactions.findAll({ profileId: input.profileId });
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    const accountsResult = await this.#accounts.findAll({ profileId: input.profileId });
    if (accountsResult.isErr()) {
      return err(accountsResult.error);
    }

    const accounts: InterpretationAccountContext[] = accountsResult.value.map((account) => ({
      accountId: account.id,
      identifier: account.identifier,
      profileId: account.profileId,
    }));

    return ok({
      transactions: transactionsResult.value,
      accounts,
    });
  }
}
