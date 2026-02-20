import type { ProviderFactory } from '../../core/types/index.js';

import { xrplRpcFactory } from './providers/xrpl-rpc/xrpl-rpc.api-client.js';

export const xrpProviderFactories: ProviderFactory[] = [xrplRpcFactory];
