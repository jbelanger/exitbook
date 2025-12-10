export interface RequestMetric {
  provider: string;
  service: 'blockchain' | 'exchange' | 'price';
  endpoint: string; // Path only, sanitized
  method: string;
  status: number;
  durationMs: number;
  timestamp: number;
  error?: string | undefined;
}

export interface MetricsSummary {
  total: number;
  avgDuration: number;
  byProvider: Record<string, number>;
  byService: Record<string, number>;
  byEndpoint: Record<string, EndpointMetrics>;
}

export interface EndpointMetrics {
  calls: number;
  avgDuration: number;
}

export class InstrumentationCollector {
  private metrics: RequestMetric[] = [];

  record(metric: RequestMetric): void {
    this.metrics.push(metric);
  }

  getMetrics(): RequestMetric[] {
    return this.metrics;
  }

  getSummary(): MetricsSummary {
    if (this.metrics.length === 0) {
      return {
        total: 0,
        avgDuration: 0,
        byProvider: {},
        byService: {},
        byEndpoint: {},
      };
    }

    const byProvider = this.metrics.reduce(
      (acc, m) => {
        acc[m.provider] = (acc[m.provider] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const byService = this.metrics.reduce(
      (acc, m) => {
        acc[m.service] = (acc[m.service] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const byEndpoint = this.metrics.reduce(
      (acc, m) => {
        const key = `${m.provider}:${m.endpoint}`;
        if (!acc[key]) {
          acc[key] = { calls: 0, avgDuration: 0 };
        }
        const current = acc[key];
        const totalDuration = current.avgDuration * current.calls + m.durationMs;
        current.calls += 1;
        current.avgDuration = totalDuration / current.calls;
        return acc;
      },
      {} as Record<string, EndpointMetrics>
    );

    const totalDuration = this.metrics.reduce((sum, m) => sum + m.durationMs, 0);

    return {
      total: this.metrics.length,
      avgDuration: totalDuration / this.metrics.length,
      byProvider,
      byService,
      byEndpoint,
    };
  }
}

/**
 * Sanitizes an endpoint URL by removing API keys and sensitive parameters.
 */
export function sanitizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint, 'http://placeholder.com');
    const pathname = url.pathname;

    // Replace common API key patterns
    return pathname
      .replace(/\/0x[a-f0-9]{40}/gi, '/{address}') // Ethereum addresses
      .replace(/\/[a-f0-9]{32,}/gi, '/{apiKey}') // Hex API keys
      .replace(/\/[A-Za-z0-9_-]{20,}/g, '/{apiKey}'); // Base64-like keys
  } catch {
    // If not a valid URL, just return the original
    return endpoint;
  }
}
