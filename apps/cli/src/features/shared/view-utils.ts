// Shared types and utilities for view commands

import type { AssetMovement, UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

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
export function parseDate(dateStr: string): Result<Date, Error> {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return err(new Error(`Invalid date format: ${dateStr}`));
  }
  return ok(date);
}

/**
 * Format a Date object to YYYY-MM-DD string.
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? 'N/A';
}

/**
 * Format a Date object to YYYY-MM-DD HH:MM:SS string.
 */
export function formatDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').split('.')[0] ?? 'N/A';
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
export function getAllMovements(movements: UniversalTransactionData['movements']): AssetMovement[] {
  return [...(movements.inflows ?? []), ...(movements.outflows ?? [])];
}
