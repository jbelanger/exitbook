import type { ProviderFactory } from '../../core/types/index.js';

import { alchemyFactory } from './providers/alchemy/alchemy.api-client.js';
import { etherscanFactory } from './providers/etherscan/etherscan.api-client.js';
import { moralisFactory } from './providers/moralis/moralis.api-client.js';
import { routescanFactory } from './providers/routescan/routescan.api-client.js';

export const evmProviderFactories: ProviderFactory[] = [
  alchemyFactory,
  etherscanFactory,
  moralisFactory,
  routescanFactory,
];
