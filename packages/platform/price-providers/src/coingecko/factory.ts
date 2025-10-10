/**
 * Factory for creating CoinGecko provider with all dependencies
 *
 * Pure factory function - wires up dependencies for CoinGeckoProvider
 */

import { HttpClient } from '@exitbook/platform-http';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { createPricesDatabase, initializePricesDatabase } from '../pricing/database.js';
import { PriceRepository } from '../pricing/repositories/price-repository.js';
import { ProviderRepository } from '../pricing/repositories/provider-repository.js';

import type { CoinGeckoConfig } from './provider.js';
import { CoinGeckoProvider } from './provider.js';

/**
 * Configuration for CoinGecko provider factory
 */
export interface CoinGeckoProviderConfig {
  /** API key for CoinGecko (optional - uses free tier if not provided) */
  apiKey?: string | undefined;
  /** Use Pro API endpoint (requires API key) */
  useProApi?: boolean | undefined;
  /** Path to prices database file (defaults to ./data/prices.db) */
  databasePath?: string | undefined;
}

/**
 * Create a fully configured CoinGecko provider
 *
 * This factory handles:
 * - Database initialization
 * - Repository creation
 * - HTTP client configuration
 * - Provider instantiation
 */
export async function createCoinGeckoProvider(
  config: CoinGeckoProviderConfig = {}
): Promise<Result<CoinGeckoProvider, Error>> {
  try {
    // Determine base URL based on API type
    const baseUrl = config.useProApi ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';

    // Create HTTP client with CoinGecko-specific configuration
    const httpClient = new HttpClient({
      baseUrl,
      defaultHeaders: {
        Accept: 'application/json',
        ...(config.apiKey && { 'x-cg-demo-api-key': config.apiKey }),
      },
      providerName: 'CoinGecko',
      rateLimit: {
        // Free tier: 10-50 calls/minute, Pro: higher limits
        burstLimit: config.useProApi ? 100 : 30,
        requestsPerHour: config.useProApi ? 500 : 500,
        requestsPerMinute: config.useProApi ? 50 : 30,
        requestsPerSecond: config.useProApi ? 1.0 : 0.5,
      },
      retries: 3,
      timeout: 10000,
    });

    // Create database
    const dbPath = config.databasePath || './data/prices.db';
    const dbResult = createPricesDatabase(dbPath);

    if (dbResult.isErr()) {
      return err(new Error(`Failed to create prices database: ${dbResult.error.message}`));
    }

    const db = dbResult.value;

    // Run migrations
    const migrationResult = await initializePricesDatabase(db);
    if (migrationResult.isErr()) {
      return err(new Error(`Failed to run migrations: ${migrationResult.error.message}`));
    }

    // Create repositories
    const providerRepo = new ProviderRepository(db);
    const priceRepo = new PriceRepository(db);

    // Create provider config
    const providerConfig: CoinGeckoConfig = {
      apiKey: config.apiKey,
      useProApi: config.useProApi,
    };

    // Instantiate provider
    const provider = new CoinGeckoProvider(httpClient, providerRepo, priceRepo, providerConfig);

    return ok(provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new Error(`Failed to create CoinGecko provider: ${message}`));
  }
}
