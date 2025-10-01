import type { IBlockchainProvider } from '../types.js';

import { type ProviderFactory, type ProviderMetadata, ProviderRegistry } from './provider-registry.js';

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
): <T extends new (...args: unknown[]) => IBlockchainProvider>(constructor: T) => T {
  return function <T extends new (...args: unknown[]) => IBlockchainProvider>(constructor: T): T {
    // Determine which chains to register for
    const chains = metadata.supportedChains || [metadata.blockchain];

    // Register the provider for each supported chain
    for (const chain of chains) {
      const factory: ProviderFactory = {
        create: (config: unknown) => new constructor(config),
        metadata: {
          ...metadata,
          blockchain: chain, // Set the current chain
        },
      };

      // Register the factory for this chain
      ProviderRegistry.register(factory);
    }

    return constructor;
  };
}
