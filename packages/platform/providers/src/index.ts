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

// Re-export initialization utilities
export { initializeProviders } from './initialize.js';

// Re-export core blockchain infrastructure
export * from './core/blockchain/blockchain-provider-manager.ts';
export * from './core/blockchain/normalizer.ts';
export * from './core/blockchain/registry/index.ts';
export * from './core/blockchain/blockchain-normalizer.interface.ts';

// Re-export blockchain providers
export * from './blockchain/bitcoin/index.ts';
export * from './blockchain/cosmos/index.ts';
export * from './blockchain/evm/index.ts';
export * from './blockchain/solana/index.ts';
export * from './blockchain/substrate/index.ts';
