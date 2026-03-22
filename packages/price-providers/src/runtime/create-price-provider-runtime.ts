import path from 'node:path';

import type { EventBus } from '@exitbook/events';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { PriceProviderEvent } from '../contracts/events.js';
import type { ManualFxRateEntry, ManualPriceEntry } from '../contracts/manual-prices.js';
import type { PriceData, PriceQuery, ProviderManagerConfig } from '../contracts/types.js';
import { ManualPriceService } from '../price-cache/manual/service.js';

import type { PriceProviderManager } from './manager/provider-manager.js';
import { createPriceProviderManager } from './registry/manager-bootstrap.js';
import type { ProviderFactoryConfig } from './registry/provider-bootstrap.js';

export interface ToggleablePriceProviderConfig {
  enabled?: boolean | undefined;
}

export interface CoinGeckoPriceProviderConfig extends ToggleablePriceProviderConfig {
  apiKey?: string | undefined;
  useProApi?: boolean | undefined;
}

export interface CryptoComparePriceProviderConfig extends ToggleablePriceProviderConfig {
  apiKey?: string | undefined;
}

export interface PriceProviderConfig {
  'bank-of-canada'?: ToggleablePriceProviderConfig | undefined;
  binance?: ToggleablePriceProviderConfig | undefined;
  coingecko?: CoinGeckoPriceProviderConfig | undefined;
  cryptocompare?: CryptoComparePriceProviderConfig | undefined;
  ecb?: ToggleablePriceProviderConfig | undefined;
  frankfurter?: ToggleablePriceProviderConfig | undefined;
}

export interface PriceProviderRuntimeBehaviorOptions {
  cacheTtlSeconds?: number | undefined;
  defaultCurrency?: string | undefined;
  maxConsecutiveFailures?: number | undefined;
}

export interface PriceProviderRuntimeOptions {
  dataDir: string;
  eventBus?: EventBus<PriceProviderEvent> | undefined;
  instrumentation?: InstrumentationCollector | undefined;
  behavior?: PriceProviderRuntimeBehaviorOptions | undefined;
  providers?: PriceProviderConfig | undefined;
}

export interface IPriceProviderRuntime {
  fetchPrice(this: void, query: PriceQuery): Promise<Result<PriceData, Error>>;
  setManualFxRate(this: void, entry: ManualFxRateEntry): Promise<Result<void, Error>>;
  setManualPrice(this: void, entry: ManualPriceEntry): Promise<Result<void, Error>>;
  cleanup(this: void): Promise<Result<void, Error>>;
}

const DEFAULT_MANAGER_CONFIG: Partial<ProviderManagerConfig> = {
  defaultCurrency: 'USD',
  maxConsecutiveFailures: 3,
  cacheTtlSeconds: 3600,
};

function buildProviderFactoryConfig(options: PriceProviderRuntimeOptions, databasePath: string): ProviderFactoryConfig {
  const providerConfig: ProviderFactoryConfig = {
    databasePath,
    eventBus: options.eventBus,
    instrumentation: options.instrumentation,
  };

  if (options.providers?.['bank-of-canada'] !== undefined) {
    providerConfig['bank-of-canada'] = options.providers['bank-of-canada'];
  }
  if (options.providers?.binance !== undefined) {
    providerConfig.binance = options.providers.binance;
  }
  if (options.providers?.coingecko !== undefined) {
    providerConfig.coingecko = options.providers.coingecko;
  }
  if (options.providers?.cryptocompare !== undefined) {
    providerConfig.cryptocompare = options.providers.cryptocompare;
  }
  if (options.providers?.ecb !== undefined) {
    providerConfig.ecb = options.providers.ecb;
  }
  if (options.providers?.frankfurter !== undefined) {
    providerConfig.frankfurter = options.providers.frankfurter;
  }

  return providerConfig;
}

function buildManagerConfig(options: PriceProviderRuntimeOptions): Partial<ProviderManagerConfig> {
  const managerConfig: Partial<ProviderManagerConfig> = {
    ...DEFAULT_MANAGER_CONFIG,
  };

  if (options.behavior?.cacheTtlSeconds !== undefined) {
    managerConfig.cacheTtlSeconds = options.behavior.cacheTtlSeconds;
  }
  if (options.behavior?.defaultCurrency !== undefined) {
    managerConfig.defaultCurrency = options.behavior.defaultCurrency;
  }
  if (options.behavior?.maxConsecutiveFailures !== undefined) {
    managerConfig.maxConsecutiveFailures = options.behavior.maxConsecutiveFailures;
  }

  return managerConfig;
}

export async function createPriceProviderRuntime(
  options: PriceProviderRuntimeOptions
): Promise<Result<IPriceProviderRuntime, Error>> {
  const databasePath = path.join(options.dataDir, 'prices.db');
  const manualPriceService = new ManualPriceService(databasePath);

  let priceProviderManager: PriceProviderManager | undefined;
  let managerInitialization: Promise<Result<PriceProviderManager, Error>> | undefined;

  const providerManagerConfig = {
    providers: buildProviderFactoryConfig(options, databasePath),
    manager: buildManagerConfig(options),
  };

  const ensurePriceProviderManager = async (): Promise<Result<PriceProviderManager, Error>> => {
    if (priceProviderManager) {
      return ok(priceProviderManager);
    }

    if (!managerInitialization) {
      managerInitialization = createPriceProviderManager(providerManagerConfig).then((managerResult) => {
        if (managerResult.isErr()) {
          managerInitialization = undefined;
          return err(managerResult.error);
        }

        priceProviderManager = managerResult.value;
        return ok(managerResult.value);
      });
    }

    return managerInitialization;
  };

  return ok({
    async fetchPrice(this: void, query) {
      const managerResult = await ensurePriceProviderManager();
      if (managerResult.isErr()) {
        return err(managerResult.error);
      }

      const priceResult = await managerResult.value.fetchPrice(query);
      if (priceResult.isErr()) {
        return err(priceResult.error);
      }

      return ok(priceResult.value.data);
    },
    async setManualFxRate(this: void, entry) {
      return manualPriceService.saveFxRate(entry);
    },
    async setManualPrice(this: void, entry) {
      return manualPriceService.savePrice(entry);
    },
    async cleanup(this: void) {
      const cleanupErrors: Error[] = [];

      try {
        await manualPriceService.destroy();
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
      }

      if (priceProviderManager) {
        try {
          await priceProviderManager.destroy();
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }

      if (cleanupErrors.length > 0) {
        return err(new AggregateError(cleanupErrors, 'Failed to cleanup price provider runtime'));
      }

      return ok(undefined);
    },
  });
}
