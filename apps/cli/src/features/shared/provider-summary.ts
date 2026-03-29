import { type BlockchainProviderDescriptor } from '@exitbook/blockchain-providers';

export interface ProviderSummary {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  apiKeyEnvName?: string | undefined;
  capabilities: string[];
  rateLimit?: string | undefined;
}

export function providerToSummary(provider: BlockchainProviderDescriptor): ProviderSummary {
  const capabilities = Array.from(
    new Set(
      provider.capabilities.supportedOperations.map((operation) => {
        if (operation.includes('Balance')) return 'balance';
        if (operation.includes('Transaction')) return 'txs';
        if (operation.includes('Withdrawal')) return 'withdrawals';
        if (operation.includes('Token')) return 'tokens';
        return operation;
      })
    )
  );

  const summary: ProviderSummary = {
    name: provider.name,
    displayName: provider.displayName,
    requiresApiKey: provider.requiresApiKey,
    capabilities,
  };

  if (provider.defaultConfig?.rateLimit) {
    const rateLimit = provider.defaultConfig.rateLimit;
    summary.rateLimit = `${rateLimit.requestsPerSecond}/sec`;
  }

  if (provider.requiresApiKey && provider.apiKeyEnvName) {
    summary.apiKeyEnvName = provider.apiKeyEnvName;
  }

  return summary;
}
