// Trigger provider registration before any exports
// This ensures all providers are registered when the package is imported
import './core/blockchain/registry/register-apis.js';
import './core/blockchain/registry/register-mappers.js';

export * from './blockchain/bitcoin/index.ts';
export * from './blockchain/cosmos/index.ts';
export * from './blockchain/evm/index.ts';
export * from './blockchain/solana/index.ts';
export * from './blockchain/substrate/index.ts';

export * from './core/blockchain/blockchain-provider-manager.ts';
