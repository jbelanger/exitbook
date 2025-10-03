import type { IRawDataMapper } from '../raw-data-mappers.ts';
import type { IBlockchainProvider } from '../types.js';

import {
  type ProviderConfig,
  type ProviderFactory,
  type ProviderMetadata,
  ProviderRegistry,
} from './provider-registry.js';

const transactionMapperMap = new Map<string, new () => IRawDataMapper<unknown, unknown>>();

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

/**
 * Decorator to register a mapper with a specific provider ID
 */
export function RegisterTransactionMapper(providerId: string) {
  return function (constructor: new () => IRawDataMapper<unknown, unknown>) {
    if (transactionMapperMap.has(providerId)) {
      console.warn(`Mapper already registered for providerId: ${providerId}`);
    }
    transactionMapperMap.set(providerId, constructor);
  };
}

/**
 * Factory for creating mapper instances based on provider ID
 */
export class TransactionMapperFactory {
  /**
   * Clear all registered mappers (mainly for testing)
   */
  static clear(): void {
    transactionMapperMap.clear();
  }

  /**
   * Create a mapper instance for the given provider ID
   */
  static create(providerId: string): IRawDataMapper<unknown, unknown> | undefined {
    const MapperClass = transactionMapperMap.get(providerId);
    return MapperClass ? new MapperClass() : undefined;
  }

  /**
   * Get all registered provider IDs
   */
  static getRegisteredProviderIds(): string[] {
    return Array.from(transactionMapperMap.keys());
  }

  /**
   * Check if a mapper is registered for the given provider ID
   */
  static isRegistered(providerId: string): boolean {
    return transactionMapperMap.has(providerId);
  }
}
