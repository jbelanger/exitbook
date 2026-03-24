import type { Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, type Result } from '@exitbook/foundation';

import { applyTransactionFilters, type ViewTransactionsParams } from './transactions-view-utils.js';

interface ReadTransactionsForCommandParams {
  assetSymbol?: string | undefined;
  db: DataSession;
  noPrice?: boolean | undefined;
  operationType?: string | undefined;
  since?: number | undefined;
  sourceName?: string | undefined;
  until?: string | undefined;
}

/**
 * Load transactions for CLI command surfaces, then apply shared in-memory filters.
 */
export async function readTransactionsForCommand(
  params: ReadTransactionsForCommandParams
): Promise<Result<Transaction[], Error>> {
  const transactionsResult = await params.db.transactions.findAll({
    ...(params.sourceName ? { sourceName: params.sourceName } : {}),
    ...(params.since !== undefined ? { since: params.since } : {}),
    includeExcluded: true,
  });
  if (transactionsResult.isErr()) {
    return err(new Error(`Failed to retrieve transactions: ${transactionsResult.error.message}`));
  }

  return applyTransactionFilters(transactionsResult.value, {
    assetSymbol: params.assetSymbol,
    noPrice: params.noPrice,
    operationType: params.operationType,
    until: params.until,
  } satisfies ViewTransactionsParams);
}
