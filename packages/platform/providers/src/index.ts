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

export * from './core/blockchain/index.ts';

export * from './blockchain/bitcoin/index.ts';
export * from './blockchain/cosmos/index.ts';
export * from './blockchain/evm/index.ts';
export * from './blockchain/solana/index.ts';
export * from './blockchain/substrate/index.ts';
