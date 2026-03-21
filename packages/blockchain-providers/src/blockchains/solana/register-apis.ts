import type { ProviderFactory } from '../../contracts/index.js';

import { heliusFactory } from './providers/helius/helius.api-client.js';
import { solanaRpcFactory } from './providers/solana-rpc/solana-rpc.api-client.js';
import { solscanFactory } from './providers/solscan/solscan.api-client.js';

export const solanaProviderFactories: ProviderFactory[] = [heliusFactory, solanaRpcFactory, solscanFactory];
