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

// Provider registry
export { PriceProviderRegistry } from './shared/registry/provider-registry.js';
export { PriceProvider } from './shared/registry/decorators.js';

// Base provider
export { BasePriceProvider } from './shared/base-provider.js';

// Provider manager
// TODO: Implement PriceProviderManager
// export { PriceProviderManager } from './shared/provider-manager.js';

// CoinGecko provider
// TODO: Implement CoinGeckoProvider
// export { CoinGeckoProvider } from './coingecko/provider.js';
