export interface ProviderHealth {
  averageResponseTime: number;
  consecutiveFailures: number;
  errorRate: number;
  isHealthy: boolean;
  lastChecked: number;
  lastError?: string | undefined;
}
