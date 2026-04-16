// Utilities and types for transactions browse filters

import type { Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import { buildDefinedFilters, parseDate } from '../../shared/view-utils.js';
import type { CommonViewFilters } from '../../shared/view-utils.js';
import { getTransactionPriceStatus } from '../transaction-view-projection.js';
import type { ExportFormat } from '../transactions-export-model.js';
import type { TransactionsViewFilters } from '../transactions-view-model.js';

/**
 * Parameters shared across transactions browse surfaces.
 */
export interface TransactionsBrowseFilters extends CommonViewFilters {
  platform?: string | undefined;
  assetSymbol?: string | undefined;
  assetId?: string | undefined;
  operationType?: string | undefined;
  noPrice?: boolean | undefined;
}

/**
 * Apply filters to transactions based on provided parameters.
 */
export function applyTransactionFilters(
  transactions: Transaction[],
  params: TransactionsBrowseFilters
): Result<Transaction[], Error> {
  let filtered = transactions;

  // Filter by until date
  if (params.until) {
    const untilDateResult = parseDate(params.until);
    if (untilDateResult.isErr()) {
      return err(untilDateResult.error);
    }
    const untilDate = untilDateResult.value;
    filtered = filtered.filter((tx) => new Date(tx.datetime) <= untilDate);
  }

  if (params.assetId) {
    filtered = filtered.filter((tx) => {
      const hasInflow = tx.movements.inflows?.some((movement) => movement.assetId === params.assetId);
      const hasOutflow = tx.movements.outflows?.some((movement) => movement.assetId === params.assetId);
      const hasFee = tx.fees?.some((fee) => fee.assetId === params.assetId);
      return hasInflow || hasOutflow || hasFee;
    });
  } else if (params.assetSymbol) {
    // Filter by asset symbol
    filtered = filtered.filter((tx) => {
      const hasInflow = tx.movements.inflows?.some((m) => m.assetSymbol === params.assetSymbol);
      const hasOutflow = tx.movements.outflows?.some((m) => m.assetSymbol === params.assetSymbol);
      const hasFee = tx.fees?.some((fee) => fee.assetSymbol === params.assetSymbol);
      return hasInflow || hasOutflow || hasFee;
    });
  }

  // Filter by operation type
  if (params.operationType) {
    filtered = filtered.filter((tx) => tx.operation.type === params.operationType);
  }

  // Filter by missing price data
  if (params.noPrice) {
    filtered = filtered.filter((tx) => {
      const status = getTransactionPriceStatus(tx);
      return status === 'none' || status === 'partial';
    });
  }

  return ok(filtered);
}

export function parseSinceToUnixSeconds(since: string | undefined): Result<number | undefined, Error> {
  if (!since) {
    return ok(undefined);
  }

  const sinceResult = parseDate(since);
  if (sinceResult.isErr()) {
    return err(sinceResult.error);
  }

  return ok(Math.floor(sinceResult.value.getTime() / 1000));
}

export function validateUntilDate(until: string | undefined): Result<void, Error> {
  if (!until) {
    return ok(undefined);
  }

  const untilResult = parseDate(until);
  if (untilResult.isErr()) {
    return err(untilResult.error);
  }

  return ok(undefined);
}

export function buildTransactionsViewFilters(
  params: Pick<TransactionsBrowseFilters, 'assetId' | 'assetSymbol' | 'noPrice' | 'operationType' | 'platform'>
): TransactionsViewFilters {
  return {
    platformFilter: params.platform,
    assetFilter: params.assetSymbol,
    assetIdFilter: params.assetId,
    operationTypeFilter: params.operationType,
    noPriceFilter: params.noPrice,
  };
}

export function buildTransactionsJsonFilters(
  params: Pick<
    TransactionsBrowseFilters,
    'assetId' | 'assetSymbol' | 'noPrice' | 'operationType' | 'platform' | 'since' | 'until'
  >
): Record<string, unknown> | undefined {
  return buildDefinedFilters({
    platform: params.platform,
    asset: params.assetSymbol,
    assetId: params.assetId,
    since: params.since,
    until: params.until,
    operationType: params.operationType,
    noPrice: params.noPrice ? true : undefined,
  });
}

/**
 * Generate a default output path for inline export based on active filters and format.
 */
export function generateDefaultPath(filters: TransactionsViewFilters, format: ExportFormat): string {
  const parts: string[] = [];
  if (filters.platformFilter) parts.push(filters.platformFilter);
  if (filters.assetIdFilter) parts.push(sanitizePathSegment(filters.assetIdFilter));
  if (filters.assetFilter) parts.push(filters.assetFilter.toLowerCase());
  parts.push('transactions');
  const extension = format === 'json' ? '.json' : '.csv';
  return `data/${parts.join('-')}${extension}`;
}

function sanitizePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
