import type { IBlockchainProvider } from '../types.js';

import { type ProviderFactory, type ProviderMetadata, ProviderRegistry } from './provider-registry.js';

/**
 * Decorator to register an API client class with the registry
 */
export function RegisterApiClient(
  metadata: ProviderMetadata
): <T extends new (...args: unknown[]) => IBlockchainProvider>(constructor: T) => T {
  return function <T extends new (...args: unknown[]) => IBlockchainProvider>(constructor: T): T {
    // Create factory that instantiates the provider class
    const factory: ProviderFactory = {
      create: (config: unknown) => new constructor(config),
      metadata,
    };

    // Register the factory
    ProviderRegistry.register(factory);

    return constructor;
  };
}
