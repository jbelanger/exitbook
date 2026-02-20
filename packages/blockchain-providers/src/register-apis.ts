import { bitcoinProviderFactories } from './blockchains/bitcoin/register-apis.js';
import { cardanoProviderFactories } from './blockchains/cardano/register-apis.js';
import { cosmosProviderFactories } from './blockchains/cosmos/register-apis.js';
import { evmProviderFactories } from './blockchains/evm/register-apis.js';
import { nearProviderFactories } from './blockchains/near/register-apis.js';
import { solanaProviderFactories } from './blockchains/solana/register-apis.js';
import { substrateProviderFactories } from './blockchains/substrate/register-apis.js';
import { xrpProviderFactories } from './blockchains/xrp/register-apis.js';
import type { ProviderFactory } from './core/types/index.js';

export {
  bitcoinProviderFactories,
  cardanoProviderFactories,
  cosmosProviderFactories,
  evmProviderFactories,
  nearProviderFactories,
  solanaProviderFactories,
  substrateProviderFactories,
  xrpProviderFactories,
};

/** All registered provider factories across all blockchains */
export const allProviderFactories: ProviderFactory[] = [
  ...bitcoinProviderFactories,
  ...cardanoProviderFactories,
  ...cosmosProviderFactories,
  ...evmProviderFactories,
  ...nearProviderFactories,
  ...solanaProviderFactories,
  ...substrateProviderFactories,
  ...xrpProviderFactories,
];
