import type { ProviderFactory } from '../../contracts/index.js';

import { thetaExplorerFactory } from './providers/theta-explorer/theta-explorer.api-client.js';
import { thetaScanFactory } from './providers/thetascan/thetascan.api-client.js';

export const thetaProviderFactories: ProviderFactory[] = [thetaExplorerFactory, thetaScanFactory];
