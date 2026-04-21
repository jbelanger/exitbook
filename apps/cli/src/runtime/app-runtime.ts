import path from 'node:path';

import { loadBlockchainExplorerConfig, type BlockchainExplorersConfig } from '@exitbook/blockchain-providers';
import { ok, type Result } from '@exitbook/foundation';
import { AdapterRegistry, allExchangeAdapters, createBlockchainAdapters } from '@exitbook/ingestion/adapters';
import type { INearBatchSource } from '@exitbook/ingestion/ports';
import type { PriceProviderConfig } from '@exitbook/price-providers';

import { getDataDir } from './data-dir.js';

export interface CliAdapterRegistryOptions {
  nearBatchSource?: INearBatchSource | undefined;
}

export type CliAdapterRegistryFactory = (options?: CliAdapterRegistryOptions) => AdapterRegistry;

export interface CliAppRuntime {
  dataDir: string;
  databasePath: string;
  adapterRegistry: AdapterRegistry;
  createAdapterRegistry: CliAdapterRegistryFactory;
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

export function createCliAdapterRegistry(options: CliAdapterRegistryOptions = {}): AdapterRegistry {
  return new AdapterRegistry(
    createBlockchainAdapters({ nearBatchSource: options.nearBatchSource }),
    allExchangeAdapters
  );
}

export function createCliAppRuntime(): CliAppRuntime {
  const dataDir = getDataDir();
  const createAdapterRegistry: CliAdapterRegistryFactory = (options = {}) => createCliAdapterRegistry(options);
  const adapterRegistry = createAdapterRegistry();

  return {
    dataDir,
    databasePath: path.join(dataDir, 'transactions.db'),
    adapterRegistry,
    createAdapterRegistry,
    priceProviderConfig: buildPriceProviderConfigFromEnv(),
    blockchainExplorerConfigPath: resolveCliBlockchainExplorerConfigPath(),
  };
}
