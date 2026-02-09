/* eslint-disable unicorn/no-null -- required for db */
/**
 * Repository for persisting blockchain provider health and circuit breaker stats
 */

import { wrapError } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { ProviderStatsDB } from '../database.js';
import type { ProviderStatsRow } from '../provider-stats-utils.js';

const STATS_COLUMNS = [
  'blockchain',
  'provider_name',
  'avg_response_time',
  'error_rate',
  'consecutive_failures',
  'is_healthy',
  'last_error',
  'last_checked',
  'failure_count',
  'last_failure_time',
  'last_success_time',
  'total_successes',
  'total_failures',
] as const;

export interface ProviderStatsInput {
  blockchain: string;
  providerName: string;

  avgResponseTime: number;
  errorRate: number;
  consecutiveFailures: number;
  isHealthy: boolean;
  lastError?: string | undefined;
  lastChecked: number;

  failureCount: number;
  lastFailureTime: number;
  lastSuccessTime: number;

  totalSuccesses: number;
  totalFailures: number;
}

/**
 * Repository for managing provider stats persistence
 */
export class ProviderStatsRepository {
  constructor(private readonly db: ProviderStatsDB) {}

  /**
   * Upsert a single provider's stats (insert or update on conflict)
   */
  async upsert(input: ProviderStatsInput): Promise<Result<void, Error>> {
    try {
      const now = new Date().toISOString();

      await this.db
        .insertInto('provider_stats')
        .values({
          blockchain: input.blockchain,
          provider_name: input.providerName,
          avg_response_time: input.avgResponseTime,
          error_rate: input.errorRate,
          consecutive_failures: input.consecutiveFailures,
          is_healthy: input.isHealthy ? 1 : 0,
          last_error: input.lastError ?? null,
          last_checked: input.lastChecked,
          failure_count: input.failureCount,
          last_failure_time: input.lastFailureTime,
          last_success_time: input.lastSuccessTime,
          total_successes: input.totalSuccesses,
          total_failures: input.totalFailures,
          created_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['blockchain', 'provider_name']).doUpdateSet({
            avg_response_time: input.avgResponseTime,
            error_rate: input.errorRate,
            consecutive_failures: input.consecutiveFailures,
            is_healthy: input.isHealthy ? 1 : 0,
            last_error: input.lastError ?? null,
            last_checked: input.lastChecked,
            failure_count: input.failureCount,
            last_failure_time: input.lastFailureTime,
            last_success_time: input.lastSuccessTime,
            total_successes: input.totalSuccesses,
            total_failures: input.totalFailures,
            updated_at: now,
          })
        )
        .execute();

      return ok();
    } catch (error) {
      return wrapError(error, `Failed to upsert provider stats for ${input.blockchain}/${input.providerName}`);
    }
  }

  /**
   * Get stats for a specific provider
   */
  async get(blockchain: string, providerName: string): Promise<Result<ProviderStatsRow | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('provider_stats')
        .select([...STATS_COLUMNS])
        .where('blockchain', '=', blockchain)
        .where('provider_name', '=', providerName)
        .executeTakeFirst();

      return ok(row);
    } catch (error) {
      return wrapError(error, `Failed to get provider stats for ${blockchain}/${providerName}`);
    }
  }

  /**
   * Get all persisted provider stats
   */
  async getAll(): Promise<Result<ProviderStatsRow[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('provider_stats')
        .select([...STATS_COLUMNS])
        .execute();

      return ok(rows);
    } catch (error) {
      return wrapError(error, 'Failed to get all provider stats');
    }
  }

  /**
   * Get stats for all providers of a specific blockchain
   */
  async getByBlockchain(blockchain: string): Promise<Result<ProviderStatsRow[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('provider_stats')
        .select([...STATS_COLUMNS])
        .where('blockchain', '=', blockchain)
        .execute();

      return ok(rows);
    } catch (error) {
      return wrapError(error, `Failed to get provider stats for blockchain ${blockchain}`);
    }
  }

  /**
   * Clear all provider stats (for testing/dev)
   */
  async clear(): Promise<Result<void, Error>> {
    try {
      await this.db.deleteFrom('provider_stats').execute();
      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to clear provider stats');
    }
  }
}
