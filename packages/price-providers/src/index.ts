/**
 * @exitbook/price-providers
 *
 * Multi-provider cryptocurrency price fetching with automatic failover
 */

// Shared types and interfaces
export type {
  AssetType,
  IPriceProvider,
  PriceQuery,
  PriceData,
  ProviderMetadata,
  ProviderCapabilities,
  ProviderRateLimit,
  ProviderManagerConfig,
} from './core/types.js';

// Provider manager
export { PriceProviderManager } from './core/provider-manager.js';

// Shared factory - recommended way to create providers
export { createPriceProviders, getAvailableProviderNames, createPriceProviderManager } from './core/factory.js';
export type { ProviderFactoryConfig, ProviderName, PriceProviderManagerFactoryConfig } from './core/factory.js';
// Events
export type { PriceProviderEvent } from './events.js';

// Error types
export { CoinNotFoundError, PriceDataUnavailableError } from './core/errors.js';

// Manual price entry service
export { ManualPriceService, saveManualPrice, saveManualFxRate } from './services/manual-price-service.js';
export type { ManualPriceEntry, ManualFxRateEntry } from './services/manual-price-service.js';
