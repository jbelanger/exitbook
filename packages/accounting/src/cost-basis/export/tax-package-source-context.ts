import { err, ok, type Result } from '@exitbook/core';
import type { TransactionLink, Transaction } from '@exitbook/core';

import type { CostBasisContext } from '../../ports/cost-basis-persistence.js';

import type { TaxPackageSourceContext } from './tax-package-build-context.js';

export function buildIndexedTaxPackageSourceContext(
  sourceContext: CostBasisContext
): Result<TaxPackageSourceContext, Error> {
  const transactionsByIdResult = buildIndexedMap(
    sourceContext.transactions,
    (transaction) => transaction.id,
    'transaction'
  );
  if (transactionsByIdResult.isErr()) {
    return err(transactionsByIdResult.error);
  }

  const accountsByIdResult = buildIndexedMap(sourceContext.accounts, (account) => account.id, 'account');
  if (accountsByIdResult.isErr()) {
    return err(accountsByIdResult.error);
  }

  const confirmedLinksByIdResult = buildIndexedMap(
    sourceContext.confirmedLinks,
    (confirmedLink) => confirmedLink.id,
    'confirmed link'
  );
  if (confirmedLinksByIdResult.isErr()) {
    return err(confirmedLinksByIdResult.error);
  }

  return ok({
    transactionsById: transactionsByIdResult.value,
    accountsById: accountsByIdResult.value,
    confirmedLinksById: confirmedLinksByIdResult.value,
  });
}

export function requireTransactionWithAccount(
  sourceContext: TaxPackageSourceContext,
  transactionId: number,
  reference: string
): Result<Transaction, Error> {
  const transaction = sourceContext.transactionsById.get(transactionId);
  if (!transaction) {
    return err(new Error(`Missing source transaction ${transactionId} for ${reference}`));
  }

  if (!sourceContext.accountsById.has(transaction.accountId)) {
    return err(
      new Error(
        `Missing account ${transaction.accountId} for source transaction ${transactionId} referenced by ${reference}`
      )
    );
  }

  return ok(transaction);
}

export function requireConfirmedLink(
  sourceContext: TaxPackageSourceContext,
  linkId: number,
  reference: string
): Result<TransactionLink, Error> {
  const confirmedLink = sourceContext.confirmedLinksById.get(linkId);
  if (!confirmedLink) {
    return err(new Error(`Missing confirmed link ${linkId} for ${reference}`));
  }

  return ok(confirmedLink);
}

function buildIndexedMap<T>(
  values: readonly T[],
  getId: (value: T) => number,
  label: string
): Result<Map<number, T>, Error> {
  const sortedValues = [...values].sort((left, right) => getId(left) - getId(right));
  const indexedValues = new Map<number, T>();

  for (const value of sortedValues) {
    const id = getId(value);
    if (indexedValues.has(id)) {
      return err(new Error(`Duplicate ${label} id ${id} in tax-package source context`));
    }

    indexedValues.set(id, value);
  }

  return ok(indexedValues);
}
