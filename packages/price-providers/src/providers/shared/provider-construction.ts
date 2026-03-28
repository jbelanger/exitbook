import { ok, wrapError, type Result } from '@exitbook/foundation';
import type { HttpClient } from '@exitbook/http';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { PricesDB } from '../../price-cache/persistence/database.js';
import { createPriceQueries, type PriceQueries } from '../../price-cache/persistence/queries.js';
import { createProviderHttpClient, type ProviderRateLimitConfig } from '../../runtime/http/provider-http-client.js';

interface ProviderHttpConfig {
  apiKey?: string | undefined;
  apiKeyHeader?: string | undefined;
  baseUrl: string;
  instrumentation?: InstrumentationCollector | undefined;
  providerName: string;
  rateLimit: ProviderRateLimitConfig;
}

interface CommonProviderConstructionDeps {
  httpClient: HttpClient;
  priceQueries: PriceQueries;
}

interface BuildPriceProviderParams<TProvider, TAdditionalDeps extends object> {
  buildAdditionalDeps?: ((db: PricesDB) => TAdditionalDeps) | undefined;
  buildProvider: (deps: CommonProviderConstructionDeps & TAdditionalDeps) => TProvider;
  creationError: string;
  db: PricesDB;
  http: ProviderHttpConfig;
}

export function buildPriceProvider<TProvider, TAdditionalDeps extends object = Record<string, never>>(
  params: BuildPriceProviderParams<TProvider, TAdditionalDeps>
): Result<TProvider, Error> {
  try {
    const httpClient = createProviderHttpClient({
      apiKey: params.http.apiKey,
      apiKeyHeader: params.http.apiKeyHeader,
      baseUrl: params.http.baseUrl,
      instrumentation: params.http.instrumentation,
      providerName: params.http.providerName,
      rateLimit: params.http.rateLimit,
    });
    const priceQueries = createPriceQueries(params.db);
    const additionalDeps = params.buildAdditionalDeps?.(params.db) ?? ({} as TAdditionalDeps);

    return ok(
      params.buildProvider({
        ...additionalDeps,
        httpClient,
        priceQueries,
      })
    );
  } catch (error) {
    return wrapError(error, params.creationError);
  }
}
