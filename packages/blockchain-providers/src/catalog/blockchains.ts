import { BITCOIN_CHAINS } from '../blockchains/bitcoin/chain-registry.js';
import { CARDANO_CHAINS } from '../blockchains/cardano/chain-registry.js';
import { COSMOS_CHAINS } from '../blockchains/cosmos/chain-registry.js';
import { EVM_CHAINS } from '../blockchains/evm/chain-registry.js';
import { NEAR_CHAINS } from '../blockchains/near/chain-registry.js';
import { SOLANA_CHAINS } from '../blockchains/solana/chain-registry.js';
import { SUBSTRATE_CHAINS } from '../blockchains/substrate/chain-registry.js';
import { XRP_CHAINS } from '../blockchains/xrp/chain-registry.js';

import type { BlockchainCatalogEntry } from './types.js';

export const BLOCKCHAIN_CATALOG: Record<string, BlockchainCatalogEntry> = {
  ...BITCOIN_CHAINS,
  ...CARDANO_CHAINS,
  ...COSMOS_CHAINS,
  ...EVM_CHAINS,
  ...NEAR_CHAINS,
  ...SOLANA_CHAINS,
  ...SUBSTRATE_CHAINS,
  ...XRP_CHAINS,
};

export function getBlockchainCatalogEntry(chainName: string): BlockchainCatalogEntry | undefined {
  return BLOCKCHAIN_CATALOG[chainName];
}
