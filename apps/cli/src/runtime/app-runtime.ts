import path from 'node:path';

import { loadBlockchainExplorerConfig, type BlockchainExplorersConfig } from '@exitbook/blockchain-providers';
import { ok, type Result } from '@exitbook/foundation';
import { AdapterRegistry, allBlockchainAdapters, allExchangeAdapters } from '@exitbook/ingestion/adapters';
import type { PriceProviderConfig } from '@exitbook/price-providers';

import { getDataDir } from './data-dir.js';

export interface CliAppRuntime {
  dataDir: string;
  databasePath: string;
  adapterRegistry: AdapterRegistry;
  priceProviderConfig: PriceProviderConfig;
  blockchainExplorerConfigPath?: string | undefined;
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

export function loadCliBlockchainExplorersConfig(
  appRuntime: Pick<CliAppRuntime, 'blockchainExplorerConfigPath' | 'blockchainExplorersConfig'>
): Result<BlockchainExplorersConfig | undefined, Error> {
  const configuredExplorers = appRuntime.blockchainExplorersConfig;
  if (configuredExplorers !== undefined) {
    return ok(configuredExplorers as BlockchainExplorersConfig | undefined);
  }

  return loadBlockchainExplorerConfig(
    appRuntime.blockchainExplorerConfigPath ?? resolveCliBlockchainExplorerConfigPath()
  );
}

export function createCliAppRuntime(): CliAppRuntime {
  const dataDir = getDataDir();

  return {
    dataDir,
    databasePath: path.join(dataDir, 'transactions.db'),
    adapterRegistry: new AdapterRegistry(allBlockchainAdapters, allExchangeAdapters),
    priceProviderConfig: buildPriceProviderConfigFromEnv(),
    blockchainExplorerConfigPath: resolveCliBlockchainExplorerConfigPath(),
  };
}
