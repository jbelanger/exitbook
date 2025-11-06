// Auto-register all blockchain configs by importing them
import './bitcoin/config.js';
import './cosmos/config.js';
import './evm/config.js';
import './solana/config.js';
import './substrate/config.js';

// Export blockchain config utilities
export * from './shared/blockchain-config.js';
