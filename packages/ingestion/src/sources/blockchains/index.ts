import { bitcoinAdapters } from './bitcoin/register.js';
import { cardanoAdapters } from './cardano/register.js';
import { cosmosAdapters } from './cosmos/register.js';
import { evmAdapters } from './evm/register.js';
import { nearAdapters } from './near/register.js';
import { solanaAdapters } from './solana/register.js';
import { substrateAdapters } from './substrate/register.js';
import { thetaAdapters } from './theta/register.js';
import { xrpAdapters } from './xrp/register.js';

export const allBlockchainAdapters = [
  ...evmAdapters,
  ...bitcoinAdapters,
  ...cosmosAdapters,
  ...substrateAdapters,
  ...solanaAdapters,
  ...nearAdapters,
  ...cardanoAdapters,
  ...thetaAdapters,
  ...xrpAdapters,
];
