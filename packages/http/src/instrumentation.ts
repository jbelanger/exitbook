export interface RequestMetric {
  provider: string;
  service: 'blockchain' | 'exchange' | 'price' | 'metadata';
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

/** Maximum raw metrics retained (oldest are evicted). */
export const MAX_METRICS = 5000;

export class InstrumentationCollector {
  // Ring buffer: fixed-size pre-allocated array with wrap-around indexing
  private readonly _buffer: (RequestMetric | undefined)[];
  private readonly _capacity: number;
  private _head = 0; // Index of the oldest entry
  private _size = 0; // Number of valid entries

  // Incremental summary aggregates — updated on every record() call
  private _total = 0;
  private _totalDuration = 0;
  private _byProvider: Record<string, number> = {};
  private _byService: Record<string, number> = {};
  private _byEndpoint: Record<string, EndpointMetrics> = {};

  constructor(capacity: number = MAX_METRICS) {
    this._capacity = capacity;
    this._buffer = new Array<RequestMetric | undefined>(capacity);
  }

  record(metric: RequestMetric): void {
    if (this._size < this._capacity) {
      // Buffer not yet full — append at (head + size) % capacity
      this._buffer[(this._head + this._size) % this._capacity] = metric;
      this._size++;
    } else {
      // Buffer full — overwrite oldest slot, advance head
      this._buffer[this._head] = metric;
      this._head = (this._head + 1) % this._capacity;
    }

    // Update incremental aggregates
    this._total++;
    this._totalDuration += metric.durationMs;
    this._byProvider[metric.provider] = (this._byProvider[metric.provider] || 0) + 1;
    this._byService[metric.service] = (this._byService[metric.service] || 0) + 1;

    const epKey = `${metric.provider}:${metric.endpoint}`;
    const ep = this._byEndpoint[epKey];
    if (!ep) {
      this._byEndpoint[epKey] = { calls: 1, avgDuration: metric.durationMs };
    } else {
      const totalDuration = ep.avgDuration * ep.calls + metric.durationMs;
      ep.calls += 1;
      ep.avgDuration = totalDuration / ep.calls;
    }
  }

  /** Returns the retained raw metrics in chronological order (oldest first). */
  getMetrics(): RequestMetric[] {
    const result: RequestMetric[] = [];
    for (let i = 0; i < this._size; i++) {
      result.push(this._buffer[(this._head + i) % this._capacity] as RequestMetric);
    }
    return result;
  }

  /** Returns the most recent metric for a provider+status, without allocating. */
  getLastMetricFor(provider: string, status?: number): RequestMetric | undefined {
    // Iterate backwards from newest entry
    for (let i = this._size - 1; i >= 0; i--) {
      const m = this._buffer[(this._head + i) % this._capacity] as RequestMetric;
      if (m.provider === provider && (status === undefined || m.status === status)) {
        return m;
      }
    }
    return undefined;
  }

  /** Count recent successful requests for a provider within a time window. */
  countRecentSuccessful(provider: string, windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    let count = 0;
    // Iterate backwards from newest — once we pass the window, stop early
    for (let i = this._size - 1; i >= 0; i--) {
      const m = this._buffer[(this._head + i) % this._capacity] as RequestMetric;
      if (m.timestamp < cutoff) break;
      if (m.provider === provider && m.status >= 200 && m.status < 300) {
        count++;
      }
    }
    return count;
  }

  /** O(1) pre-computed summary from incremental aggregates. */
  getSummary(): MetricsSummary {
    if (this._total === 0) {
      return {
        total: 0,
        avgDuration: 0,
        byProvider: {},
        byService: {},
        byEndpoint: {},
      };
    }

    return {
      total: this._total,
      avgDuration: this._totalDuration / this._total,
      byProvider: { ...this._byProvider },
      byService: { ...this._byService },
      byEndpoint: Object.fromEntries(Object.entries(this._byEndpoint).map(([k, v]) => [k, { ...v }])),
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
