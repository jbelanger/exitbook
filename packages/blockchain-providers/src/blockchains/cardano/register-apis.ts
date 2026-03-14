import type { ProviderFactory } from '../../core/types/index.js';

import { blockfrostFactory } from './providers/blockfrost/blockfrost.api-client.js';

export const cardanoProviderFactories: ProviderFactory[] = [blockfrostFactory];
