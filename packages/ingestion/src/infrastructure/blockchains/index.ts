// Auto-register all blockchain configs by importing them
import './bitcoin/adapter.ts';
import './cardano/adapter.js';
import './cosmos/adapter.js';
import './evm/adapter.js';
import './near/adapter.js';
import './solana/adapter.js';
import './substrate/adapter.js';

// Export blockchain adapter utilities
export * from './shared/blockchain-adapter.js';
