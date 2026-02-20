import type { ProviderFactory } from '../../core/types/index.js';

import { akashConsoleFactory } from './providers/akash-console/akash-console.api-client.js';
import { cosmosRestFactories } from './providers/cosmos-rest/cosmos-rest.api-client.js';
import { injectiveExplorerFactory } from './providers/injective-explorer/injective-explorer.api-client.js';

export const cosmosProviderFactories: ProviderFactory[] = [
  ...cosmosRestFactories,
  injectiveExplorerFactory,
  akashConsoleFactory,
];
