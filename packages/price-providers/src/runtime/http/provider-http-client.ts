import { HttpClient } from '@exitbook/http';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { ProviderRateLimit } from '../../contracts/types.js';

export type ProviderRateLimitConfig = ProviderRateLimit;

interface ProviderHttpClientConfig {
  additionalHeaders?: Record<string, string> | undefined;
  apiKey?: string | undefined;
  apiKeyHeader?: string | undefined;
  baseUrl: string;
  instrumentation?: InstrumentationCollector | undefined;
  providerName: string;
  rateLimit: ProviderRateLimitConfig;
  retries?: number | undefined;
  timeout?: number | undefined;
}

/**
 * Create an HTTP client configured for a price provider.
 */
export function createProviderHttpClient(config: ProviderHttpClientConfig): HttpClient {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...config.additionalHeaders,
  };

  if (config.apiKey && config.apiKeyHeader) {
    headers[config.apiKeyHeader] = config.apiKey;
  }

  return new HttpClient({
    baseUrl: config.baseUrl,
    defaultHeaders: headers,
    instrumentation: config.instrumentation,
    providerName: config.providerName,
    rateLimit: config.rateLimit,
    retries: config.retries ?? 3,
    service: 'price',
    timeout: config.timeout ?? 10000,
  });
}
