// Auto-register all blockchain configs by importing them
import './bitcoin/config.ts';
import './cosmos/config.ts';
import './evm/config.ts';
import './solana/config.ts';
import './substrate/config.ts';

// Export blockchain config utilities
export * from './shared/blockchain-config.ts';
