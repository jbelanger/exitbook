import { registerBitcoinChains } from './bitcoin/register.js';
import { registerCardanoChain } from './cardano/register.js';
import { registerCosmosChains } from './cosmos/register.js';
import { registerEvmChains } from './evm/register.js';
import { registerNearChain } from './near/register.js';
import { registerSolanaChain } from './solana/register.js';
import { registerSubstrateChains } from './substrate/register.js';

export function registerAllBlockchains(): void {
  registerEvmChains();
  registerBitcoinChains();
  registerCosmosChains();
  registerSubstrateChains();
  registerSolanaChain();
  registerNearChain();
  registerCardanoChain();
}
