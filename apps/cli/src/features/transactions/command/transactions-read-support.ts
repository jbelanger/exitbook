import type { Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';
import { ANNOTATION_KINDS, ANNOTATION_TIERS, type TransactionAnnotation } from '@exitbook/transaction-interpretation';

import { applyTransactionFilters, type TransactionsBrowseFilters } from './transactions-browse-utils.js';

interface ReadTransactionsForCommandParams {
  accountIds?: number[] | undefined;
  address?: string | undefined;
  assetId?: string | undefined;
  assetSymbol?: string | undefined;
  db: DataSession;
  from?: string | undefined;
  noPrice?: boolean | undefined;
  operationType?: string | undefined;
  profileId: number;
  since?: number | undefined;
  platformKey?: string | undefined;
  to?: string | undefined;
  until?: string | undefined;
}

/**
 * Load transactions for CLI command surfaces, then apply shared in-memory filters.
 */
export async function readTransactionsForCommand(
  params: ReadTransactionsForCommandParams
): Promise<Result<Transaction[], Error>> {
  const transactionsResult = await params.db.transactions.findAll({
    profileId: params.profileId,
    ...(params.accountIds !== undefined ? { accountIds: params.accountIds } : {}),
    ...(params.platformKey ? { platformKey: params.platformKey } : {}),
    ...(params.since !== undefined ? { since: params.since } : {}),
    includeExcluded: true,
  });
  if (transactionsResult.isErr()) {
    return err(new Error(`Failed to retrieve transactions: ${transactionsResult.error.message}`));
  }

  return applyTransactionFilters(transactionsResult.value, {
    address: params.address,
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    from: params.from,
    noPrice: params.noPrice,
    operationType: params.operationType,
    to: params.to,
    until: params.until,
  } satisfies TransactionsBrowseFilters);
}

interface ReadTransactionAnnotationsForCommandParams {
  db: DataSession;
  transactionIds: readonly number[];
}

export async function readTransactionAnnotationsForCommand(
  params: ReadTransactionAnnotationsForCommandParams
): Promise<Result<readonly TransactionAnnotation[], Error>> {
  if (params.transactionIds.length === 0) {
    return ok([]);
  }

  const annotationsResult = await params.db.transactionAnnotations.readAnnotations({
    transactionIds: params.transactionIds,
    kinds: ANNOTATION_KINDS,
    tiers: ANNOTATION_TIERS,
  });
  if (annotationsResult.isErr()) {
    return err(new Error(`Failed to retrieve transaction annotations: ${annotationsResult.error.message}`));
  }

  return annotationsResult;
}
