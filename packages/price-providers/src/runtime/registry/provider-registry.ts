import type { Result } from '@exitbook/foundation';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { IPriceProvider } from '../../contracts/types.js';
import type { PricesDB } from '../../price-cache/persistence/database.js';
import { createBankOfCanadaProvider } from '../../providers/bank-of-canada/provider.js';
import { createBinanceProvider } from '../../providers/binance/provider.js';
import { createCoinGeckoProvider } from '../../providers/coingecko/provider.js';
import { createCryptoCompareProvider } from '../../providers/cryptocompare/provider.js';
import { createECBProvider } from '../../providers/ecb/provider.js';
import { createFrankfurterProvider } from '../../providers/frankfurter/provider.js';

export interface PriceProviderDescriptor {
  displayName: string;
  name: string;
  requiresApiKey: boolean;
  supportedAssetTypes: ('crypto' | 'fiat')[];
}

export type ProviderFactory = (
  db: PricesDB,
  config: unknown,
  instrumentation?: InstrumentationCollector
) => Result<IPriceProvider, Error>;

interface PriceProviderRegistration {
  createProvider: ProviderFactory;
  descriptor: PriceProviderDescriptor;
}

export const PRICE_PROVIDER_REGISTRY = {
  'bank-of-canada': {
    createProvider: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
      createBankOfCanadaProvider(db, config, instrumentation),
    descriptor: {
      displayName: 'Bank of Canada',
      name: 'bank-of-canada',
      requiresApiKey: false,
      supportedAssetTypes: ['fiat'],
    },
  },
  binance: {
    createProvider: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
      createBinanceProvider(db, config as Parameters<typeof createBinanceProvider>[1], instrumentation),
    descriptor: {
      displayName: 'Binance',
      name: 'binance',
      requiresApiKey: false,
      supportedAssetTypes: ['crypto'],
    },
  },
  coingecko: {
    createProvider: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
      createCoinGeckoProvider(db, config as Parameters<typeof createCoinGeckoProvider>[1], instrumentation),
    descriptor: {
      displayName: 'CoinGecko',
      name: 'coingecko',
      requiresApiKey: false,
      supportedAssetTypes: ['crypto'],
    },
  },
  cryptocompare: {
    createProvider: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
      createCryptoCompareProvider(db, config as Parameters<typeof createCryptoCompareProvider>[1], instrumentation),
    descriptor: {
      displayName: 'CryptoCompare',
      name: 'cryptocompare',
      requiresApiKey: false,
      supportedAssetTypes: ['crypto'],
    },
  },
  ecb: {
    createProvider: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
      createECBProvider(db, config, instrumentation),
    descriptor: {
      displayName: 'European Central Bank',
      name: 'ecb',
      requiresApiKey: false,
      supportedAssetTypes: ['fiat'],
    },
  },
  frankfurter: {
    createProvider: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
      createFrankfurterProvider(db, config, instrumentation),
    descriptor: {
      displayName: 'Frankfurter (ECB)',
      name: 'frankfurter',
      requiresApiKey: false,
      supportedAssetTypes: ['fiat'],
    },
  },
} as const satisfies Record<string, PriceProviderRegistration>;

export type ProviderName = keyof typeof PRICE_PROVIDER_REGISTRY;

export function getAvailableProviderNames(): ProviderName[] {
  return Object.keys(PRICE_PROVIDER_REGISTRY) as ProviderName[];
}

export function getPriceProviderFactory(name: ProviderName): ProviderFactory {
  return PRICE_PROVIDER_REGISTRY[name].createProvider;
}

export function listRegisteredPriceProviders(): PriceProviderDescriptor[] {
  return getAvailableProviderNames().map((name) => ({ ...PRICE_PROVIDER_REGISTRY[name].descriptor }));
}
