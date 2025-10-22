// Shared types and utilities for view commands

import type { AssetMovement, UniversalTransaction } from '@exitbook/core';

/**
 * Common filter options across view subcommands.
 */
export interface CommonViewFilters {
  source?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Base result structure for view commands (JSON output).
 */
export interface ViewCommandResult<T> {
  data: T;
  meta: {
    count: number;
    filters?: Record<string, unknown> | undefined;
    hasMore: boolean;
    limit: number;
    offset: number;
  };
}

/**
 * Parse ISO date string to Date object.
 */
export function parseDate(dateStr: string): Date {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  return date;
}

/**
 * Build metadata object for view command results.
 */
export function buildViewMeta(
  count: number,
  offset: number,
  limit: number,
  totalCount: number,
  filters?: Record<string, unknown>
): ViewCommandResult<unknown>['meta'] {
  return {
    count,
    offset,
    limit,
    hasMore: offset + count < totalCount,
    filters,
  };
}

/**
 * Get all movements (inflows and outflows) from a transaction's movements.
 * Handles optional arrays with null coalescing.
 */
export function getAllMovements(movements: UniversalTransaction['movements']): AssetMovement[] {
  return [...(movements.inflows ?? []), ...(movements.outflows ?? [])];
}
