import type { ProviderFactory } from '../../core/types/index.js';

import { blockchainComFactory } from './providers/blockchain-com/blockchain-com.api-client.js';
import { blockcypherFactory } from './providers/blockcypher/blockcypher.api-client.js';
import { blockstreamFactory } from './providers/blockstream/blockstream-api-client.js';
import { mempoolSpaceFactory } from './providers/mempool-space/mempool-space-api-client.js';
import { tatumBcashFactory } from './providers/tatum/tatum-bcash.api-client.js';
import { tatumBitcoinFactory } from './providers/tatum/tatum-bitcoin.api-client.js';
import { tatumDogecoinFactory } from './providers/tatum/tatum-dogecoin.api-client.js';
import { tatumLitecoinFactory } from './providers/tatum/tatum-litecoin.api-client.js';

export const bitcoinProviderFactories: ProviderFactory[] = [
  blockchainComFactory,
  blockcypherFactory,
  blockstreamFactory,
  mempoolSpaceFactory,
  tatumBcashFactory,
  tatumBitcoinFactory,
  tatumDogecoinFactory,
  tatumLitecoinFactory,
];
