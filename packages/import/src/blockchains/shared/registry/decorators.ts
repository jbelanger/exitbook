import type { IBlockchainProvider } from '../types.ts';
import { type ProviderFactory, type ProviderMetadata, ProviderRegistry } from './provider-registry.ts';

/**
 * Decorator to register a provider class with the registry
 */
export function RegisterProvider(metadata: ProviderMetadata) {
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
