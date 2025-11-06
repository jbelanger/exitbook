/**
 * @exitbook/providers
 *
 * Unified package for blockchain and exchange API providers.
 *
 * IMPORTANT: Call `initializeProviders()` once at application startup
 * to register all providers before using them.
 *
 * @example
 * ```typescript
 * import { initializeProviders } from '@exitbook/providers';
 *
 * // Initialize once at startup
 * initializeProviders();
 * ```
 */

export { initializeProviders } from './initialize.js';

export * from './shared/blockchain/index.js';

export * from './blockchain/bitcoin/index.js';
export * from './blockchain/cosmos/index.js';
export * from './blockchain/evm/index.js';
export * from './blockchain/solana/index.js';
export * from './blockchain/substrate/index.js';
