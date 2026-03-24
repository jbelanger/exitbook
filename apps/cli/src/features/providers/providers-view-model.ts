export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'no-stats';

export interface ProviderBlockchainItem {
  name: string;
  capabilities: string[];
  rateLimit?: string | undefined;
  configSource: 'default' | 'override';

  stats?:
    | {
        avgResponseTime: number;
        errorRate: number;
        isHealthy: boolean;
        totalFailures: number;
        totalSuccesses: number;
      }
    | undefined;
}

export interface ProviderAggregateStats {
  totalRequests: number;
  avgResponseTime: number;
  errorRate: number;
  lastChecked: number;
}

export interface ProviderViewItem {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string | undefined;
  apiKeyConfigured?: boolean | undefined;
  blockchains: ProviderBlockchainItem[];
  chainCount: number;
  healthStatus: HealthStatus;
  stats?: ProviderAggregateStats | undefined;
  rateLimit?: string | undefined;
  configSource: 'default' | 'override';
  lastError?: string | undefined;
  lastErrorTime?: number | undefined;
}
