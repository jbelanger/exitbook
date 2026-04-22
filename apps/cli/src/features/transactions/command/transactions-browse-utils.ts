// Utilities and types for transactions browse filters

import type { Transaction } from '@exitbook/core';
import { err, identifiersMatch, ok, type Result } from '@exitbook/foundation';
import type { AnnotationKind, AnnotationTier } from '@exitbook/transaction-interpretation';

import { buildDefinedFilters, parseDate } from '../../../cli/view-utils.js';
import type { CommonViewFilters } from '../../../cli/view-utils.js';
import { getTransactionPriceStatus } from '../transaction-view-projection.js';
import type { ExportFormat } from '../transactions-export-model.js';
import type { TransactionsViewFilters } from '../transactions-view-model.js';

import {
  buildAccountPathSegment,
  buildTransactionsAccountFilters,
  type ResolvedTransactionsAccountFilter,
} from './transactions-account-filter.js';

/**
 * Parameters shared across transactions browse surfaces.
 */
export interface TransactionsBrowseFilters extends CommonViewFilters {
  account?: string | undefined;
  annotationKind?: AnnotationKind | undefined;
  annotationTier?: AnnotationTier | undefined;
  platform?: string | undefined;
  assetSymbol?: string | undefined;
  assetId?: string | undefined;
  address?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  operationFilter?: string | undefined;
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

  if (params.address) {
    filtered = filtered.filter(
      (tx) => identifiersMatch(tx.from, params.address) || identifiersMatch(tx.to, params.address)
    );
  }

  if (params.from) {
    filtered = filtered.filter((tx) => identifiersMatch(tx.from, params.from));
  }

  if (params.to) {
    filtered = filtered.filter((tx) => identifiersMatch(tx.to, params.to));
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
  params: Pick<
    TransactionsBrowseFilters,
    | 'account'
    | 'address'
    | 'annotationKind'
    | 'annotationTier'
    | 'assetId'
    | 'assetSymbol'
    | 'from'
    | 'noPrice'
    | 'operationFilter'
    | 'platform'
    | 'to'
  >
): TransactionsViewFilters {
  return {
    accountFilter: params.account,
    annotationKindFilter: params.annotationKind,
    annotationTierFilter: params.annotationTier,
    platformFilter: params.platform,
    assetFilter: params.assetSymbol,
    assetIdFilter: params.assetId,
    addressFilter: params.address,
    fromFilter: params.from,
    toFilter: params.to,
    operationFilter: params.operationFilter,
    noPriceFilter: params.noPrice,
  };
}

export function buildTransactionsJsonFilters(
  params: Pick<
    TransactionsBrowseFilters,
    | 'account'
    | 'address'
    | 'annotationKind'
    | 'annotationTier'
    | 'assetId'
    | 'assetSymbol'
    | 'from'
    | 'noPrice'
    | 'operationFilter'
    | 'platform'
    | 'since'
    | 'to'
    | 'until'
  >
): Record<string, unknown> | undefined {
  return buildDefinedFilters({
    account: params.account,
    platform: params.platform,
    asset: params.assetSymbol,
    assetId: params.assetId,
    address: params.address,
    from: params.from,
    to: params.to,
    annotationKind: params.annotationKind,
    annotationTier: params.annotationTier,
    since: params.since,
    until: params.until,
    operationType: params.operationFilter,
    noPrice: params.noPrice ? true : undefined,
  });
}

/**
 * Generate a default output path for inline export based on active filters and format.
 */
export function generateDefaultPath(
  filters: TransactionsViewFilters,
  format: ExportFormat,
  accountFilter?: Pick<ResolvedTransactionsAccountFilter, 'selector'>
): string {
  const parts: string[] = [];
  const accountPathSegment = buildAccountPathSegment(accountFilter);
  if (accountPathSegment) {
    parts.push(accountPathSegment);
  }
  if (filters.platformFilter) parts.push(filters.platformFilter);
  if (filters.assetIdFilter) parts.push(sanitizePathSegment(filters.assetIdFilter));
  if (filters.assetFilter) parts.push(filters.assetFilter.toLowerCase());
  if (filters.addressFilter) parts.push(`addr-${sanitizePathSegment(filters.addressFilter)}`);
  if (filters.fromFilter) parts.push(`from-${sanitizePathSegment(filters.fromFilter)}`);
  if (filters.toFilter) parts.push(`to-${sanitizePathSegment(filters.toFilter)}`);
  if (filters.annotationKindFilter) parts.push(`annotation-${sanitizePathSegment(filters.annotationKindFilter)}`);
  if (filters.annotationTierFilter) parts.push(`tier-${sanitizePathSegment(filters.annotationTierFilter)}`);
  parts.push('transactions');
  const extension = format === 'json' ? '.json' : '.csv';
  return `data/${parts.join('-')}${extension}`;
}

export function buildTransactionsJsonFiltersWithResolvedAccount(
  params: Pick<
    TransactionsBrowseFilters,
    | 'account'
    | 'address'
    | 'annotationKind'
    | 'annotationTier'
    | 'assetId'
    | 'assetSymbol'
    | 'from'
    | 'noPrice'
    | 'operationFilter'
    | 'platform'
    | 'since'
    | 'to'
    | 'until'
  >,
  accountFilter: Pick<ResolvedTransactionsAccountFilter, 'selector'> | undefined
): Record<string, unknown> | undefined {
  return buildDefinedFilters({
    ...buildTransactionsAccountFilters(accountFilter),
    platform: params.platform,
    asset: params.assetSymbol,
    assetId: params.assetId,
    address: params.address,
    from: params.from,
    to: params.to,
    annotationKind: params.annotationKind,
    annotationTier: params.annotationTier,
    since: params.since,
    until: params.until,
    operationType: params.operationFilter,
    noPrice: params.noPrice ? true : undefined,
  });
}

function sanitizePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
