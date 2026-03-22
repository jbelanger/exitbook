import type { ProviderInfo } from '../contracts/registry.js';
import { createProviderRegistry } from '../initialize.js';

export interface BlockchainProviderDescriptor extends ProviderInfo {
  apiKeyEnvVar?: string | undefined;
}

export function listBlockchainProviders(): BlockchainProviderDescriptor[] {
  const registry = createProviderRegistry();

  return registry.getAllProviders().map((provider) => ({
    ...provider,
    apiKeyEnvVar: registry.getMetadata(provider.blockchain, provider.name)?.apiKeyEnvVar ?? undefined,
  }));
}
