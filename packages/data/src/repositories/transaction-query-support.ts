import type { Selectable } from '@exitbook/sqlite';

import type { TransactionsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { chunkItems, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';

export interface TransactionQueryParams {
  accountId?: number | undefined;
  accountIds?: number[] | undefined;
  includeExcluded?: boolean | undefined;
  platformKey?: string | undefined;
  profileId?: number | undefined;
  since?: number | undefined;
}

interface WhereCapable<TQuery> {
  where(...args: unknown[]): TQuery;
}

function applyCommonTransactionFilters<TQuery extends WhereCapable<TQuery>>(
  query: TQuery,
  filters: TransactionQueryParams
): TQuery {
  let nextQuery = query;

  if (filters.profileId !== undefined) {
    nextQuery = nextQuery.where('accounts.profile_id', '=', filters.profileId);
  }

  if (filters.platformKey) {
    nextQuery = nextQuery.where('transactions.platform_key', '=', filters.platformKey);
  }

  if (filters.since) {
    const sinceDate = new Date(filters.since * 1000).toISOString();
    nextQuery = nextQuery.where('transactions.transaction_datetime', '>=', sinceDate as unknown as string);
  }

  if (!filters.includeExcluded) {
    nextQuery = nextQuery.where('transactions.excluded_from_accounting', '=', false);
  }

  return nextQuery;
}

function applyAccountFilter<TQuery extends WhereCapable<TQuery>>(
  query: TQuery,
  accountId: number | undefined,
  accountIds: number[] | undefined
): TQuery {
  if (accountId !== undefined) {
    return query.where('transactions.account_id', '=', accountId);
  }

  if (accountIds !== undefined && accountIds.length > 0) {
    return query.where('transactions.account_id', 'in', accountIds);
  }

  return query;
}

function hasEmptyExplicitAccountScope(filters: TransactionQueryParams): boolean {
  return filters.accountId === undefined && filters.accountIds !== undefined && filters.accountIds.length === 0;
}

export async function findTransactionRows(
  db: KyselyDB,
  filters: TransactionQueryParams
): Promise<Selectable<TransactionsTable>[]> {
  if (hasEmptyExplicitAccountScope(filters)) {
    return [];
  }

  if (
    filters.accountId === undefined &&
    filters.accountIds !== undefined &&
    filters.accountIds.length > SQLITE_SAFE_IN_BATCH_SIZE
  ) {
    const rows: Selectable<TransactionsTable>[] = [];

    for (const accountIdBatch of chunkItems(filters.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
      const batchQuery = applyAccountFilter(
        applyCommonTransactionFilters(
          db
            .selectFrom('transactions')
            .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
            .selectAll('transactions'),
          filters
        ),
        undefined,
        accountIdBatch
      );

      rows.push(...(await batchQuery.orderBy('transactions.transaction_datetime', 'asc').execute()));
    }

    rows.sort((left, right) => left.transaction_datetime.localeCompare(right.transaction_datetime));
    return rows;
  }

  const query = applyAccountFilter(
    applyCommonTransactionFilters(
      db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .selectAll('transactions'),
      filters
    ),
    filters.accountId,
    filters.accountIds
  );

  return query.orderBy('transactions.transaction_datetime', 'asc').execute();
}

export async function countTransactionRows(db: KyselyDB, filters: TransactionQueryParams): Promise<number> {
  if (hasEmptyExplicitAccountScope(filters)) {
    return 0;
  }

  if (
    filters.accountId === undefined &&
    filters.accountIds !== undefined &&
    filters.accountIds.length > SQLITE_SAFE_IN_BATCH_SIZE
  ) {
    let totalCount = 0;

    for (const accountIdBatch of chunkItems(filters.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
      const batchQuery = applyAccountFilter(
        applyCommonTransactionFilters(
          db
            .selectFrom('transactions')
            .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
            .select(({ fn }) => [fn.count<number>('transactions.id').as('count')]),
          filters
        ),
        undefined,
        accountIdBatch
      );

      const result = await batchQuery.executeTakeFirst();
      totalCount += result?.count ?? 0;
    }

    return totalCount;
  }

  const query = applyAccountFilter(
    applyCommonTransactionFilters(
      db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .select(({ fn }) => [fn.count<number>('transactions.id').as('count')]),
      filters
    ),
    filters.accountId,
    filters.accountIds
  );

  const result = await query.executeTakeFirst();
  return result?.count ?? 0;
}
