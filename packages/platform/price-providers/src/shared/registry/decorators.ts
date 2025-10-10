/**
 * Decorator for registering price providers
 *
 * This is part of the imperative shell - it manages side effects
 * (registration state) at module load time.
 */

import 'reflect-metadata';

import type { IPriceProvider, ProviderMetadata } from '../types/index.js';

import { PriceProviderRegistry } from './provider-registry.js';

const METADATA_KEY = 'price:provider:metadata';

/**
 * Class decorator to register a price provider
 *
 * Usage:
 * ```typescript
 * @PriceProvider({
 *   name: 'coingecko',
 *   displayName: 'CoinGecko',
 *   priority: 1,
 *   // ...
 * })
 * export class CoinGeckoProvider implements IPriceProvider {
 *   // ...
 * }
 * ```
 */
export function PriceProvider(metadata: ProviderMetadata) {
  return function <T extends new (...args: unknown[]) => IPriceProvider>(target: T): T {
    // Store metadata on the class
    Reflect.defineMetadata(METADATA_KEY, metadata, target);

    // Register with the global registry
    PriceProviderRegistry.register(target, metadata);

    return target;
  };
}

/**
 * Get provider metadata from a decorated class
 */
export function getProviderMetadata(target: new (...args: unknown[]) => IPriceProvider): ProviderMetadata | undefined {
  return Reflect.getMetadata(METADATA_KEY, target) as ProviderMetadata | undefined;
}
