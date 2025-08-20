import { ProviderRegistry, type ProviderMetadata, type ProviderFactory } from './provider-registry.js';
import type { IBlockchainProvider } from '../../core/types';

/**
 * Decorator to register a provider class with the registry
 */
export function RegisterProvider(metadata: ProviderMetadata) {
  return function <TConfig, T extends new (...args: any[]) => IBlockchainProvider<TConfig>>(
    constructor: T
  ): T {
    // Create factory that instantiates the provider class
    const factory: ProviderFactory<TConfig> = {
      metadata,
      create: (config: TConfig) => new constructor(config)
    };
    
    // Register the factory
    ProviderRegistry.register(factory);
    
    return constructor;
  };
}