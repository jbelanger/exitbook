import type { Result } from '@exitbook/core';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { IPriceProvider } from '../../contracts/types.js';
import type { PricesDB } from '../../persistence/database.js';
import { createBankOfCanadaProvider } from '../../providers/bank-of-canada/provider.js';
import { createBinanceProvider } from '../../providers/binance/provider.js';
import { createCoinGeckoProvider } from '../../providers/coingecko/provider.js';
import { createCryptoCompareProvider } from '../../providers/cryptocompare/provider.js';
import { createECBProvider } from '../../providers/ecb/provider.js';
import { createFrankfurterProvider } from '../../providers/frankfurter/provider.js';

export type ProviderFactory = (
  db: PricesDB,
  config: unknown,
  instrumentation?: InstrumentationCollector
) => Result<IPriceProvider, Error>;

export const PROVIDER_FACTORIES = {
  'bank-of-canada': (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createBankOfCanadaProvider(db, config, instrumentation),
  binance: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createBinanceProvider(db, config as Parameters<typeof createBinanceProvider>[1], instrumentation),
  coingecko: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createCoinGeckoProvider(db, config as Parameters<typeof createCoinGeckoProvider>[1], instrumentation),
  cryptocompare: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createCryptoCompareProvider(db, config as Parameters<typeof createCryptoCompareProvider>[1], instrumentation),
  ecb: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createECBProvider(db, config, instrumentation),
  frankfurter: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createFrankfurterProvider(db, config, instrumentation),
} as const satisfies Record<string, ProviderFactory>;

export type ProviderName = keyof typeof PROVIDER_FACTORIES;

export function getAvailableProviderNames(): ProviderName[] {
  return Object.keys(PROVIDER_FACTORIES) as ProviderName[];
}
