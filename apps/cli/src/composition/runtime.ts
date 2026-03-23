import { loadBlockchainExplorerConfig, type BlockchainExplorersConfig } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from '@exitbook/core';
import { AdapterRegistry, allBlockchainAdapters, allExchangeAdapters } from '@exitbook/ingestion';
import type { PriceProviderConfig } from '@exitbook/price-providers';

import { getDataDir } from '../features/shared/data-dir.js';

export interface CliAppRuntime {
  dataDir: string;
  adapterRegistry: AdapterRegistry;
  priceProviderConfig: PriceProviderConfig;
  blockchainExplorersConfig?: BlockchainExplorersConfig | undefined;
}

function buildPriceProviderConfigFromEnv(): PriceProviderConfig {
  return {
    coingecko: {
      apiKey: process.env['COINGECKO_API_KEY'],
      useProApi: process.env['COINGECKO_USE_PRO_API'] === 'true',
    },
    cryptocompare: {
      apiKey: process.env['CRYPTOCOMPARE_API_KEY'],
    },
  };
}

export function createCliAppRuntime(): Result<CliAppRuntime, Error> {
  const explorerConfigResult = loadBlockchainExplorerConfig();
  if (explorerConfigResult.isErr()) {
    return err(explorerConfigResult.error);
  }

  return ok({
    dataDir: getDataDir(),
    adapterRegistry: new AdapterRegistry(allBlockchainAdapters, allExchangeAdapters),
    priceProviderConfig: buildPriceProviderConfigFromEnv(),
    blockchainExplorersConfig: explorerConfigResult.value,
  });
}
