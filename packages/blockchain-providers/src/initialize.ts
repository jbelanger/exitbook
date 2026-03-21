import { allProviderFactories } from './register-apis.js';
import { ProviderRegistry } from './runtime/registry/provider-registry.js';

/**
 * Create a new ProviderRegistry populated with all blockchain provider factories.
 */
export function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  for (const factory of allProviderFactories) {
    registry.register(factory);
  }

  return registry;
}
