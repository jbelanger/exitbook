import type { ProviderHealth } from '@exitbook/blockchain-providers';
import type { CircuitStatus, RequestMetric } from '@exitbook/http';

const VELOCITY_WINDOW_MS = 5000; // 5 seconds

/**
 * Provider row data for dashboard display.
 */
export interface ProviderRow {
  name: string;
  status: 'ACTIVE' | 'IDLE';
  circuitState?: CircuitStatus | undefined;
  latencyMs?: number | undefined;
  requestsPerSecond: number;
  throttles: number;
  requestsByStatus: Map<number, number>; // status code -> count
}

/**
 * Aggregated provider metrics for dashboard.
 */
export interface ProviderMetrics {
  overallVelocity: number;
  providers: ProviderRow[]; // Alphabetically sorted
}

/**
 * Calculate provider metrics from instrumentation data (pure function).
 */
export function calculateProviderMetrics(
  metrics: RequestMetric[],
  throttles: Map<string, number>,
  providerHealth: Map<string, ProviderHealth & { circuitState: CircuitStatus }>
): ProviderMetrics {
  const now = Date.now();
  const windowStart = now - VELOCITY_WINDOW_MS;

  // Calculate overall velocity (all requests in last 5 seconds)
  const recentRequests = metrics.filter((m) => m.timestamp >= windowStart);
  const overallVelocity = recentRequests.length / 5;

  // Find all unique providers from metrics and health/throttle state
  const providerNames = new Set<string>();
  for (const metric of metrics) {
    providerNames.add(metric.provider);
  }
  for (const provider of providerHealth.keys()) {
    providerNames.add(provider);
  }
  for (const provider of throttles.keys()) {
    providerNames.add(provider);
  }

  // Build provider rows
  const providers: ProviderRow[] = [];
  for (const provider of providerNames) {
    const providerMetrics = metrics.filter((m) => m.provider === provider);
    const recentProviderMetrics = providerMetrics.filter((m) => m.timestamp >= windowStart);

    // Calculate velocity
    const requestsPerSecond = recentProviderMetrics.length / 5;

    // Calculate latency (average of last 10 successful requests, excluding 429s)
    const successfulRequests = providerMetrics
      .filter((m) => m.status >= 200 && m.status < 300 && m.status !== 429)
      .slice(-10);

    const latencyMs =
      successfulRequests.length > 0
        ? Math.round(successfulRequests.reduce((sum, m) => sum + m.durationMs, 0) / successfulRequests.length)
        : undefined;

    // Group requests by status code
    const requestsByStatus = new Map<number, number>();
    for (const metric of providerMetrics) {
      const count = requestsByStatus.get(metric.status) ?? 0;
      requestsByStatus.set(metric.status, count + 1);
    }

    // Determine status
    const status = requestsPerSecond > 0 ? 'ACTIVE' : 'IDLE';

    // Get circuit state from provider health
    const health = providerHealth.get(provider);
    const circuitState = health?.circuitState;

    providers.push({
      name: provider,
      status,
      circuitState,
      latencyMs,
      requestsPerSecond,
      throttles: throttles.get(provider) ?? 0,
      requestsByStatus,
    });
  }

  // Sort alphabetically
  providers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    overallVelocity,
    providers,
  };
}

/**
 * Format request breakdown by status code (e.g., "1,186 (200), 14 (429)").
 */
export function formatRequestBreakdown(requestsByStatus: Map<number, number>): string {
  if (requestsByStatus.size === 0) {
    return '—';
  }

  // Sort by status code (200, 429, 500, etc.)
  const sorted = Array.from(requestsByStatus.entries()).sort(([a], [b]) => {
    // Prioritize common status codes
    const priority = (code: number) => {
      if (code === 200) return 0;
      if (code === 429) return 1;
      if (code >= 500) return 2;
      return 3;
    };
    return priority(a) - priority(b) || a - b;
  });

  return sorted.map(([status, count]) => `${count.toLocaleString()} (${status})`).join(', ');
}
