import type { ProviderInfo } from '../contracts/registry.js';
import { createProviderRegistry } from '../initialize.js';

export interface BlockchainProviderDescriptor extends ProviderInfo {
  apiKeyEnvName?: string | undefined;
}

export function listBlockchainProviders(): BlockchainProviderDescriptor[] {
  const registry = createProviderRegistry();

  return registry.getAllProviders().map((provider) => ({
    ...provider,
    apiKeyEnvName: registry.getMetadata(provider.blockchain, provider.name)?.apiKeyEnvName ?? undefined,
  }));
}
