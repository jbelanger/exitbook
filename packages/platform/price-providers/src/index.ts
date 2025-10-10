/**
 * @exitbook/price-providers
 *
 * Multi-provider cryptocurrency price fetching with automatic failover
 */

// Shared types and interfaces
export type {
  IPriceProvider,
  PriceQuery,
  PriceData,
  ProviderMetadata,
  ProviderCapabilities,
} from './shared/types/index.js';

// Provider manager
export { PriceProviderManager } from './shared/provider-manager.js';

// CoinGecko provider
export { CoinGeckoProvider } from './coingecko/provider.js';
export type { CoinGeckoConfig } from './coingecko/provider.js';

// Factory for creating providers
export { createCoinGeckoProvider } from './coingecko/factory.js';

// Database and repositories (for advanced usage)
export { createPricesDatabase, initializePricesDatabase } from './pricing/database.js';
export { ProviderRepository } from './pricing/repositories/provider-repository.js';
export { PriceRepository } from './pricing/repositories/price-repository.js';
export type { PricesDB } from './pricing/database.js';
