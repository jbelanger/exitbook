import type { IExchangeAdapter, IBlockchainAdapter } from '@crypto/core';
import type { ExchangeConfig } from '../types.ts';
import { ExchangeAdapterRegistry } from './exchange-adapter-registry.ts';
import type { ExchangeAdapterFactory, ExchangeAdapterMetadata } from './types.ts';

/**
 * Decorator to register an exchange adapter class with the registry
 */
export function RegisterExchangeAdapter(metadata: ExchangeAdapterMetadata) {
  return function <T extends new (...args: any[]) => IExchangeAdapter | IBlockchainAdapter>(
    constructor: T
  ): T {
    // Create factory that instantiates the adapter class
    const factory: ExchangeAdapterFactory = {
      metadata,
      create: async (config: ExchangeConfig, enableOnlineVerification?: boolean, database?: any) => {
        // Different adapters have different constructor signatures
        // We need to handle this gracefully
        const args: any[] = [config];
        
        if (enableOnlineVerification !== undefined) {
          args.push(enableOnlineVerification);
        }
        
        if (database !== undefined) {
          args.push(database);
        }

        return new constructor(...args);
      }
    };

    // Register the factory
    ExchangeAdapterRegistry.register(factory);

    return constructor;
  };
}