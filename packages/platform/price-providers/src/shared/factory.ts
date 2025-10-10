/**
 * Factory for creating all price providers
 *
 * Centralized provider creation with environment variable support
 */

import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';

import { createCoinGeckoProvider } from '../coingecko/provider.ts';

import type { IPriceProvider } from './types/index.js';

const logger = getLogger('PriceProviderFactory');

/**
 * Configuration for individual providers
 */
export interface ProviderFactoryConfig {
  coingecko?: {
    apiKey?: string | undefined;
    databasePath?: string | undefined;
    enabled?: boolean | undefined;
    useProApi?: boolean | undefined;
  };
  // Future providers:
  // coinmarketcap?: { ... };
  // binance?: { ... };
}

/**
 * Create all enabled price providers
 *
 * Providers are enabled if:
 * - Not explicitly disabled in config
 * - API key is available (if required)
 *
 * Example usage:
 * ```typescript
 * // Use environment variables
 * const providers = await createPriceProviders();
 *
 * // Override with config
 * const providers = await createPriceProviders({
 *   coingecko: { apiKey: 'my-key', useProApi: true }
 * });
 *
 * // Disable specific provider
 * const providers = await createPriceProviders({
 *   coingecko: { enabled: false }
 * });
 * ```
 */
export async function createPriceProviders(config: ProviderFactoryConfig = {}): Promise<IPriceProvider[]> {
  const providers: IPriceProvider[] = [];

  // CoinGecko Provider
  const coingeckoConfig = config.coingecko;
  if (coingeckoConfig?.enabled !== false) {
    const apiKey = coingeckoConfig?.apiKey || process.env.COINGECKO_API_KEY;
    const useProApi = coingeckoConfig?.useProApi || process.env.COINGECKO_USE_PRO_API === 'true';
    const databasePath = coingeckoConfig?.databasePath;

    const result = await createCoinGeckoProvider({
      apiKey,
      databasePath,
      useProApi,
    });

    if (result.isOk()) {
      providers.push(result.value);
      logger.info(`CoinGecko provider registered (Pro API: ${useProApi})`);
    } else {
      logger.warn(`Failed to create CoinGecko provider: ${result.error.message}`);
    }
  } else {
    logger.debug('CoinGecko provider disabled via config');
  }

  // Future providers can be added here:
  //
  // // CoinMarketCap Provider
  // if (config.coinmarketcap?.enabled !== false) {
  //   const result = await createCoinMarketCapProvider({ ... });
  //   if (result.isOk()) {
  //     providers.push(result.value);
  //   }
  // }

  if (providers.length === 0) {
    logger.warn('No price providers were successfully created. Price fetching will not be available.');
  } else {
    logger.info(
      `Successfully created ${providers.length} price provider(s): ${providers.map((p) => p.getMetadata().name).join(', ')}`
    );
  }

  return providers;
}

/**
 * Create a single provider by name
 *
 * Useful for dynamic provider selection or testing
 */
export async function createPriceProviderByName(
  name: string,
  config: Record<string, unknown> = {}
): Promise<Result<IPriceProvider, Error>> {
  switch (name.toLowerCase()) {
    case 'coingecko':
      return createCoinGeckoProvider(config as Parameters<typeof createCoinGeckoProvider>[0]);

    // Future providers:
    // case 'coinmarketcap':
    //   return createCoinMarketCapProvider(config);

    default:
      return {
        isErr: () => true,
        isOk: () => false,
      } as Result<IPriceProvider, Error>;
  }
}

/**
 * Get list of available provider names
 */
export function getAvailableProviderNames(): string[] {
  return [
    'coingecko',
    // Future: 'coinmarketcap', 'binance', etc.
  ];
}
