import type { Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, type Result } from '@exitbook/foundation';

import { applyTransactionFilters, type TransactionsBrowseFilters } from './transactions-browse-utils.js';

interface ReadTransactionsForCommandParams {
  assetId?: string | undefined;
  assetSymbol?: string | undefined;
  db: DataSession;
  noPrice?: boolean | undefined;
  operationType?: string | undefined;
  profileId: number;
  since?: number | undefined;
  platformKey?: string | undefined;
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
    ...(params.platformKey ? { platformKey: params.platformKey } : {}),
    ...(params.since !== undefined ? { since: params.since } : {}),
    includeExcluded: true,
  });
  if (transactionsResult.isErr()) {
    return err(new Error(`Failed to retrieve transactions: ${transactionsResult.error.message}`));
  }

  return applyTransactionFilters(transactionsResult.value, {
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    noPrice: params.noPrice,
    operationType: params.operationType,
    until: params.until,
  } satisfies TransactionsBrowseFilters);
}
