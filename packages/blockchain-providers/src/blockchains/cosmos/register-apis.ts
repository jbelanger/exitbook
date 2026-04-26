import type { ProviderFactory } from '../../contracts/index.js';

import { isCosmosAccountHistorySupported } from './chain-registry.js';
import { akashConsoleFactory } from './providers/akash-console/akash-console.api-client.js';
import { cosmosRestFactories } from './providers/cosmos-rest/cosmos-rest.api-client.js';
import { getBlockCosmosFactory } from './providers/getblock/getblock.api-client.js';
import { injectiveExplorerFactory } from './providers/injective-explorer/injective-explorer.api-client.js';

const cosmosHubProviderFactories = isCosmosAccountHistorySupported('cosmoshub') ? [getBlockCosmosFactory] : [];

export const cosmosProviderFactories: ProviderFactory[] = [
  ...cosmosHubProviderFactories,
  ...cosmosRestFactories,
  injectiveExplorerFactory,
  akashConsoleFactory,
];
