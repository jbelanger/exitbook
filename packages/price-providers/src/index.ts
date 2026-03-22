/**
 * @exitbook/price-providers
 *
 * Multi-provider cryptocurrency price fetching with automatic failover
 */

export type { PriceQuery, PriceData } from './contracts/types.js';
export { listPriceProviders, type PriceProviderDescriptor } from './catalog/list-price-providers.js';
export {
  createPriceProviderRuntime,
  type CoinGeckoPriceProviderConfig,
  type CryptoComparePriceProviderConfig,
  type PriceProviderRuntimeBehaviorOptions,
  type PriceProviderConfig,
  type IPriceProviderRuntime,
  type PriceProviderRuntimeOptions,
  type ToggleablePriceProviderConfig,
} from './runtime/create-price-provider-runtime.js';
export { readPriceCacheFreshness } from './price-cache/freshness.js';
export type { PriceProviderEvent } from './contracts/events.js';
export type { ManualPriceEntry, ManualFxRateEntry } from './contracts/manual-prices.js';
export { CoinNotFoundError, PriceDataUnavailableError } from './contracts/errors.js';
