import type { IBlockchainProvider, ProviderConfig, ProviderFactory, ProviderMetadata } from '../types/index.js';

import { ProviderRegistry } from './provider-registry.js';

/**
 * Decorator to register an API client class with the registry
 *
 * Uses TC39 standard decorators (Stage 3).
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
): (target: new (config: ProviderConfig) => IBlockchainProvider, context: ClassDecoratorContext) => void {
  return (target, context) => {
    if (context.kind !== 'class') {
      throw new Error('RegisterApiClient can only be applied to classes');
    }

    const factory: ProviderFactory = {
      create: (config: ProviderConfig) => new target(config),
      metadata, // Store metadata as-is (preserves supportedChains)
    };

    // Register once with primary blockchain as key
    ProviderRegistry.register(factory);
  };
}
