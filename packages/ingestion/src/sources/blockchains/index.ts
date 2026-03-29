import type { INearBatchSource } from '../../ports/near-batch-source.js';
import type { BlockchainAdapter } from '../../shared/types/blockchain-adapter.js';

import { bitcoinAdapters } from './bitcoin/register.js';
import { cardanoAdapters } from './cardano/register.js';
import { cosmosAdapters } from './cosmos/register.js';
import { evmAdapters } from './evm/register.js';
import { createNearAdapters } from './near/register.js';
import { solanaAdapters } from './solana/register.js';
import { substrateAdapters } from './substrate/register.js';
import { thetaAdapters } from './theta/register.js';
import { xrpAdapters } from './xrp/register.js';

export function createBlockchainAdapters(
  options: {
    nearBatchSource?: INearBatchSource | undefined;
  } = {}
): BlockchainAdapter[] {
  return [
    ...evmAdapters,
    ...bitcoinAdapters,
    ...cosmosAdapters,
    ...substrateAdapters,
    ...solanaAdapters,
    ...createNearAdapters({ nearBatchSource: options.nearBatchSource }),
    ...cardanoAdapters,
    ...thetaAdapters,
    ...xrpAdapters,
  ];
}

export const allBlockchainAdapters = createBlockchainAdapters();
