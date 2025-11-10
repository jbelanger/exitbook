import type { IBlockchainProvider, ProviderConfig, ProviderFactory, ProviderMetadata } from '../types/index.js';

import { ProviderRegistry } from './provider-registry.js';

/**
 * Decorator to register an API client class with the registry
 *
 * For multi-chain providers (like EVM providers), use supportedChains:
 * @example
 * ```typescript
 * @RegisterApiClient({
 *   name: 'alchemy',
 *   blockchain: 'ethereum', // primary chain
 *   supportedChains: ['ethereum', 'avalanche', 'polygon'],
 *   ...
 * })
 * ```
 */
export function RegisterApiClient(
  metadata: ProviderMetadata
): <T extends new (config: ProviderConfig) => IBlockchainProvider>(constructor: T) => T {
  return function <T extends new (config: ProviderConfig) => IBlockchainProvider>(constructor: T): T {
    const factory: ProviderFactory = {
      create: (config: ProviderConfig) => new constructor(config),
      metadata, // Store metadata as-is (preserves supportedChains)
    };

    // Register once with primary blockchain as key
    ProviderRegistry.register(factory);

    return constructor;
  };
}
