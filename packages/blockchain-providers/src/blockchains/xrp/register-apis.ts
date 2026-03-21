import type { ProviderFactory } from '../../contracts/index.js';

import { xrplRpcFactory } from './providers/xrpl-rpc/xrpl-rpc.api-client.js';

export const xrpProviderFactories: ProviderFactory[] = [xrplRpcFactory];
