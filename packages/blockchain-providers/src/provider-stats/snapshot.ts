import type { ProviderStatsRow } from './persistence/utils.js';

export interface ProviderStatsSnapshot {
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

export function toProviderStatsSnapshot(row: ProviderStatsRow): ProviderStatsSnapshot {
  return {
    blockchain: row.blockchain,
    providerName: row.provider_name,
    avgResponseTime: row.avg_response_time,
    errorRate: row.error_rate,
    consecutiveFailures: row.consecutive_failures,
    isHealthy: row.is_healthy === 1,
    ...(row.last_error !== null && { lastError: row.last_error }),
    lastChecked: row.last_checked,
    failureCount: row.failure_count,
    lastFailureTime: row.last_failure_time,
    lastSuccessTime: row.last_success_time,
    totalSuccesses: row.total_successes,
    totalFailures: row.total_failures,
  };
}
