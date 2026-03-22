import type { ProviderInfo } from '../contracts/registry.js';
import { createProviderRegistry } from '../initialize.js';

export interface ProviderCatalogEntry extends ProviderInfo {
  apiKeyEnvVar?: string | undefined;
}

export function listBlockchainProviders(): ProviderCatalogEntry[] {
  const registry = createProviderRegistry();

  return registry.getAllProviders().map((provider) => ({
    ...provider,
    apiKeyEnvVar: registry.getMetadata(provider.blockchain, provider.name)?.apiKeyEnvVar ?? undefined,
  }));
}
