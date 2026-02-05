import type { ProviderEvent } from '@exitbook/blockchain-providers';
import type { RequestMetric } from '@exitbook/http';

const VELOCITY_WINDOW_MS = 5000; // 5 seconds

/**
 * State tracked for each provider
 */
export interface ProviderState {
  name: string;
  status: 'rate_limited' | 'circuit_open' | 'active' | 'idle';
  statusDisplay: string; // e.g., "⚠ WAIT 334ms" or "🟢 ACTIVE"
  latencyMs: number;
  requestsPerSecond: number;
  throttleCount: number;
  rateLimitResumeAt?: number | undefined; // Timestamp when rate limit ends
}

/**
 * Aggregates provider state from events and instrumentation metrics.
 * Builds provider table rows for dashboard display.
 */
export class ProviderStateAggregator {
  private providerStates = new Map<string, ProviderStateData>();

  /**
   * Track provider event to update internal state.
   */
  trackEvent(event: ProviderEvent): void {
    // Extract provider name based on event type
    let provider: string;
    if ('provider' in event) {
      provider = event.provider;
    } else if (event.type === 'provider.failover') {
      provider = event.to;
    } else if (event.type === 'provider.selection') {
      provider = event.selected;
    } else {
      return;
    }

    const state = this.getOrCreateState(provider);

    switch (event.type) {
      case 'provider.rate_limited':
        state.throttleCount += 1;
        state.rateLimitResumeAt = Date.now() + (event.retryAfterMs ?? 0);
        break;

      case 'provider.circuit_open':
        state.circuitOpen = true;
        break;

      case 'provider.request.succeeded':
        // Clear rate limit and circuit state on successful request
        state.rateLimitResumeAt = undefined;
        state.circuitOpen = false;
        break;
    }
  }

  /**
   * Get provider rows sorted by req/s (most active first).
   * Filters by service type (e.g., 'blockchain' for Phase 1, 'metadata' for Phase 2).
   */
  getProviderRows(metrics: RequestMetric[], serviceFilter: 'blockchain' | 'metadata'): ProviderState[] {
    // Find all unique providers in metrics for this service
    const activeProviders = new Set<string>();
    for (const metric of metrics) {
      if (metric.service === serviceFilter) {
        activeProviders.add(metric.provider);
      }
    }

    // Build rows for each provider
    const rows: ProviderState[] = [];
    for (const provider of activeProviders) {
      const state = this.getOrCreateState(provider);
      const latency = this.calculateLatency(metrics, provider);
      const reqPerSecond = this.calculateProviderVelocity(metrics, provider, serviceFilter);

      // Determine status
      const { status, statusDisplay } = this.determineStatus(state, reqPerSecond);

      rows.push({
        name: provider,
        status,
        statusDisplay,
        latencyMs: latency,
        requestsPerSecond: reqPerSecond,
        throttleCount: state.throttleCount,
        rateLimitResumeAt: state.rateLimitResumeAt,
      });
    }

    // Sort by req/s (most active first)
    rows.sort((a, b) => b.requestsPerSecond - a.requestsPerSecond);

    return rows;
  }

  /**
   * Calculate provider velocity (req/s) for a specific service.
   * Uses a rolling 5-second window.
   */
  private calculateProviderVelocity(
    metrics: RequestMetric[],
    provider: string,
    service: 'blockchain' | 'metadata'
  ): number {
    const now = Date.now();
    const windowStart = now - VELOCITY_WINDOW_MS;

    const recentRequests = metrics.filter(
      (m) => m.timestamp >= windowStart && m.provider === provider && m.service === service
    );

    return recentRequests.length / 5; // requests per 5 seconds / 5 = req/s
  }

  /**
   * Calculate average latency from last 10 successful requests.
   * Excludes 429 (rate limit) responses.
   */
  private calculateLatency(metrics: RequestMetric[], provider: string): number {
    const successfulRequests = metrics
      .filter((m) => m.provider === provider && m.status >= 200 && m.status < 300 && m.status !== 429)
      .slice(-10); // Last 10 successful requests

    if (successfulRequests.length === 0) {
      return 0;
    }

    const totalDuration = successfulRequests.reduce((sum, m) => sum + m.durationMs, 0);
    return Math.round(totalDuration / successfulRequests.length);
  }

  /**
   * Determine provider status and display string.
   */
  private determineStatus(
    state: ProviderStateData,
    reqPerSecond: number
  ): { status: ProviderState['status']; statusDisplay: string } {
    // Priority 1: Rate limited (show countdown)
    if (state.rateLimitResumeAt) {
      const remainingMs = state.rateLimitResumeAt - Date.now();
      if (remainingMs > 0) {
        return {
          status: 'rate_limited',
          statusDisplay: `⚠ WAIT ${remainingMs}ms`,
        };
      }
      // Timer reached 0, clear it
      state.rateLimitResumeAt = undefined;
    }

    // Priority 2: Circuit open
    if (state.circuitOpen) {
      return {
        status: 'circuit_open',
        statusDisplay: '🔴 CIRCUIT',
      };
    }

    // Priority 3: Active (req/s > 10)
    if (reqPerSecond > 10) {
      return {
        status: 'active',
        statusDisplay: '🟢 ACTIVE',
      };
    }

    // Default: Idle
    return {
      status: 'idle',
      statusDisplay: '⚪ IDLE',
    };
  }

  /**
   * Get or create state for a provider.
   */
  private getOrCreateState(provider: string): ProviderStateData {
    let state = this.providerStates.get(provider);
    if (!state) {
      state = {
        throttleCount: 0,
        rateLimitResumeAt: undefined,
        circuitOpen: false,
      };
      this.providerStates.set(provider, state);
    }
    return state;
  }
}

/**
 * Internal state data tracked per provider.
 */
interface ProviderStateData {
  throttleCount: number;
  rateLimitResumeAt?: number | undefined;
  circuitOpen: boolean;
}
