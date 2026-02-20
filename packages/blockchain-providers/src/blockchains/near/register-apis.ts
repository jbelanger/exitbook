import type { ProviderFactory } from '../../core/types/index.js';

import { nearblocksFactory } from './providers/nearblocks/nearblocks.api-client.js';

export const nearProviderFactories: ProviderFactory[] = [nearblocksFactory];
