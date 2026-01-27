import type { RequestMetric } from '@exitbook/http';

const VELOCITY_WINDOW_MS = 5000; // 5 seconds

/**
 * Tracks request velocity (req/s) from instrumentation metrics.
 * Uses a rolling 5-second window for velocity calculations.
 */
export class VelocityTracker {
  /**
   * Calculate overall requests per second from all metrics.
   * Uses a rolling 5-second window.
   */
  getRequestsPerSecond(metrics: RequestMetric[]): number {
    const now = Date.now();
    const windowStart = now - VELOCITY_WINDOW_MS;

    const recentRequests = metrics.filter((m) => m.timestamp >= windowStart);

    return recentRequests.length / 5; // requests per 5 seconds / 5 = req/s
  }

  /**
   * Calculate per-provider requests per second.
   * Uses a rolling 5-second window.
   */
  getProviderVelocity(metrics: RequestMetric[], provider: string): number {
    const now = Date.now();
    const windowStart = now - VELOCITY_WINDOW_MS;

    const recentRequests = metrics.filter((m) => m.timestamp >= windowStart && m.provider === provider);

    return recentRequests.length / 5; // requests per 5 seconds / 5 = req/s
  }

  /**
   * Get per-provider velocity for a specific service type.
   * Filters by both provider and service type (e.g., 'blockchain', 'metadata').
   */
  getProviderVelocityByService(
    metrics: RequestMetric[],
    provider: string,
    service: 'blockchain' | 'exchange' | 'price' | 'metadata'
  ): number {
    const now = Date.now();
    const windowStart = now - VELOCITY_WINDOW_MS;

    const recentRequests = metrics.filter(
      (m) => m.timestamp >= windowStart && m.provider === provider && m.service === service
    );

    return recentRequests.length / 5; // requests per 5 seconds / 5 = req/s
  }
}
