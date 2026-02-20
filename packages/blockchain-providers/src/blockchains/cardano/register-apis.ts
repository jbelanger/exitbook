import type { ProviderFactory } from '../../core/types/index.js';

import { blockfrostFactory } from './blockfrost/blockfrost-api-client.js';

export const cardanoProviderFactories: ProviderFactory[] = [blockfrostFactory];
