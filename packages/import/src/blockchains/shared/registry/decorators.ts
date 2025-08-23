import type { IBlockchainProvider } from "../types.ts";
import {
  ProviderRegistry,
  type ProviderFactory,
  type ProviderMetadata,
} from "./provider-registry.ts";

/**
 * Decorator to register a provider class with the registry
 */
export function RegisterProvider(metadata: ProviderMetadata) {
  return function <T extends new (...args: unknown[]) => IBlockchainProvider>(
    constructor: T,
  ): T {
    // Create factory that instantiates the provider class
    const factory: ProviderFactory = {
      metadata,
      create: (config: unknown) => new constructor(config),
    };

    // Register the factory
    ProviderRegistry.register(factory);

    return constructor;
  };
}
