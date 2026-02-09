/**
 * Database schema for provider stats database
 *
 * Separate database from main transactions.db to persist provider health
 * and circuit breaker state across CLI runs
 */

import type { ColumnType } from 'kysely';

/**
 * Provider stats table — one row per (blockchain, provider_name) pair
 */
export interface ProviderStatsTable {
  id: ColumnType<number, never, never>;
  blockchain: string;
  provider_name: string;

  // Health metrics
  avg_response_time: ColumnType<number, number | undefined, number>;
  error_rate: ColumnType<number, number | undefined, number>;
  consecutive_failures: ColumnType<number, number | undefined, number>;
  is_healthy: ColumnType<number, number | undefined, number>; // SQLite boolean (0/1)
  last_error: string | null;
  last_checked: ColumnType<number, number | undefined, number>; // epoch ms

  // Circuit breaker state
  failure_count: ColumnType<number, number | undefined, number>;
  last_failure_time: ColumnType<number, number | undefined, number>; // epoch ms
  last_success_time: ColumnType<number, number | undefined, number>; // epoch ms

  // Lifetime counters
  total_successes: ColumnType<number, number | undefined, number>;
  total_failures: ColumnType<number, number | undefined, number>;

  created_at: string;
  updated_at: string | null;
}

/**
 * Complete database schema
 */
export interface ProviderStatsDatabase {
  provider_stats: ProviderStatsTable;
}
