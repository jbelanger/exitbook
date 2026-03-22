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
} from './contracts/types.js';

// Provider manager
export { PriceProviderManager } from './runtime/manager/provider-manager.js';

// Shared factory - recommended way to create providers
export { createPriceProviders, getAvailableProviderNames } from './runtime/registry/provider-bootstrap.js';
export { createPriceProviderManager } from './runtime/registry/manager-bootstrap.js';
export type { ProviderFactoryConfig } from './runtime/registry/provider-bootstrap.js';
export type { ProviderName } from './runtime/registry/provider-registry.js';
export type { PriceProviderManagerFactoryConfig } from './runtime/registry/manager-bootstrap.js';
export { createDefaultPriceProviderManager } from './defaults/create-default-price-provider-manager.js';
export type { DefaultPriceProviderManagerOptions } from './defaults/create-default-price-provider-manager.js';
export { createManualPriceService } from './price-cache/manual/create-manual-price-service.js';
export { readPriceCacheFreshness } from './price-cache/freshness.js';
// Events
export type { PriceProviderEvent } from './contracts/events.js';

// Error types
export { CoinNotFoundError, PriceDataUnavailableError } from './contracts/errors.js';

// Manual price entry service
export { ManualPriceService } from './price-cache/manual/service.js';
export type { ManualPriceEntry, ManualFxRateEntry } from './price-cache/manual/service.js';
