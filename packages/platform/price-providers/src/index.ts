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
  ProviderRateLimit,
} from './shared/types/index.js';

// Provider manager
export { PriceProviderManager } from './shared/provider-manager.js';
export type { ProviderManagerConfig } from './shared/types/index.js';

// Shared factory - recommended way to create providers
export { createPriceProviders, getAvailableProviderNames, createPriceProviderManager } from './shared/factory.js';
export type { ProviderFactoryConfig, ProviderName, PriceProviderManagerFactoryConfig } from './shared/factory.js';

// Error types
export { CoinNotFoundError } from './shared/errors.js';
