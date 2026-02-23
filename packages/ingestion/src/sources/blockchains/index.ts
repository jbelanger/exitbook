import { bitcoinAdapters } from './bitcoin/register.js';
import { cardanoAdapter } from './cardano/register.js';
import { cosmosAdapters } from './cosmos/register.js';
import { evmAdapters } from './evm/register.js';
import { nearAdapter } from './near/register.js';
import { solanaAdapter } from './solana/register.js';
import { substrateAdapters } from './substrate/register.js';
import { xrpAdapters } from './xrp/register.js';

export const allBlockchainAdapters = [
  ...evmAdapters,
  ...bitcoinAdapters,
  ...cosmosAdapters,
  ...substrateAdapters,
  solanaAdapter,
  nearAdapter,
  cardanoAdapter,
  ...xrpAdapters,
];
