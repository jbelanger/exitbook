// Universal blockchain provider interface for multi-provider resilience
// This interface abstracts any blockchain data source (APIs, RPC nodes, indexers)



export interface RateLimitConfig {
  requestsPerSecond: number;
  requestsPerMinute?: number;
  requestsPerHour?: number;
  burstLimit?: number;
}

export interface ProviderHealth {
  isHealthy: boolean;
  lastChecked: number;
  consecutiveFailures: number;
  averageResponseTime: number;
  errorRate: number;
  lastError?: string;
  rateLimitEvents: number;           // Total rate limit events encountered
  rateLimitRate: number;             // Percentage of requests that were rate limited (0-1)
  lastRateLimitTime?: number;        // Timestamp of last rate limit event
}
