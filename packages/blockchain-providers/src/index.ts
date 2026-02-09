/**
 * @exitbook/blockchain-providers
 *
 * Unified package for blockchain and exchange API providers.
 *
 * IMPORTANT: Call `initializeProviders()` once at application startup
 * to register all providers before using them.
 *
 * @example
 * ```typescript
 * import { initializeProviders } from '@exitbook/blockchain-providers';
 *
 * // Initialize once at startup
 * initializeProviders();
 * ```
 */

export { initializeProviders } from './initialize.js';

export * from './core/index.js';

// Events
export type { ProviderEvent } from './events.js';

// Persistence
export * from './persistence/index.js';

export * from './blockchains/bitcoin/index.js';
export * from './blockchains/cardano/index.js';
export * from './blockchains/cosmos/index.js';
export * from './blockchains/evm/index.js';
export * from './blockchains/near/index.js';
export * from './blockchains/solana/index.js';
export * from './blockchains/substrate/index.js';
export * from './blockchains/xrp/index.js';
