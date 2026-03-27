import path from 'node:path';

import { loadBlockchainExplorerConfig, type BlockchainExplorersConfig } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from '@exitbook/foundation';
import { AdapterRegistry, allBlockchainAdapters, allExchangeAdapters } from '@exitbook/ingestion/adapters';
import type { PriceProviderConfig } from '@exitbook/price-providers';

import { getDataDir } from '../features/shared/data-dir.js';

export interface CliAppRuntime {
  dataDir: string;
  databasePath: string;
  adapterRegistry: AdapterRegistry;
  priceProviderConfig: PriceProviderConfig;
  blockchainExplorersConfig?: BlockchainExplorersConfig | undefined;
}

export function buildPriceProviderConfigFromEnv(): PriceProviderConfig {
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

function resolveCliBlockchainExplorerConfigPath(): string {
  const configuredPath = process.env['BLOCKCHAIN_EXPLORERS_CONFIG'];
  if (configuredPath) {
    return path.resolve(process.cwd(), configuredPath);
  }

  return path.join(process.cwd(), 'config/blockchain-explorers.json');
}

export function createCliAppRuntime(): Result<CliAppRuntime, Error> {
  const explorerConfigResult = loadBlockchainExplorerConfig(resolveCliBlockchainExplorerConfigPath());
  if (explorerConfigResult.isErr()) {
    return err(explorerConfigResult.error);
  }

  const dataDir = getDataDir();

  return ok({
    dataDir,
    databasePath: path.join(dataDir, 'transactions.db'),
    adapterRegistry: new AdapterRegistry(allBlockchainAdapters, allExchangeAdapters),
    priceProviderConfig: buildPriceProviderConfigFromEnv(),
    blockchainExplorersConfig: explorerConfigResult.value,
  });
}
