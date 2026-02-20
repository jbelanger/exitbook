import type { ProviderFactory } from '../../core/types/index.js';

import { subscanFactory } from './providers/subscan/subscan.api-client.js';
import { taostatsFactory } from './providers/taostats/taostats.api-client.js';

export const substrateProviderFactories: ProviderFactory[] = [subscanFactory, taostatsFactory];
