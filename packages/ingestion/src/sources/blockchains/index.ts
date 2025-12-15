import { registerBitcoinChains } from './bitcoin/register.ts';
import { registerCardanoChain } from './cardano/register.ts';
import { registerCosmosChains } from './cosmos/register.ts';
import { registerEvmChains } from './evm/register.ts';
import { registerNearChain } from './near/register.ts';
import { registerSolanaChain } from './solana/register.ts';
import { registerSubstrateChains } from './substrate/register.ts';

export function registerAllBlockchains(): void {
  registerEvmChains();
  registerBitcoinChains();
  registerCosmosChains();
  registerSubstrateChains();
  registerSolanaChain();
  registerNearChain();
  registerCardanoChain();
}
