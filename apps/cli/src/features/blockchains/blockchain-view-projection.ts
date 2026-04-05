import type { BlockchainViewItem, ProviderViewItem } from './blockchains-view-model.js';
import type { BlockchainCatalogItem } from './command/blockchains-catalog-utils.js';

/**
 * Transform a blockchain catalog item into a view item for TUI display.
 * Checks env vars to determine API key configuration status.
 */
export function toBlockchainViewItem(blockchain: BlockchainCatalogItem): BlockchainViewItem {
  const providers: ProviderViewItem[] = blockchain.providers.map((provider) => {
    const apiKeyConfigured =
      provider.requiresApiKey && provider.apiKeyEnvName ? !!process.env[provider.apiKeyEnvName] : undefined;

    return {
      name: provider.name,
      displayName: provider.displayName,
      requiresApiKey: provider.requiresApiKey,
      apiKeyEnvName: provider.apiKeyEnvName,
      apiKeyConfigured,
      capabilities: provider.capabilities,
      rateLimit: provider.rateLimit,
    };
  });

  const providersRequiringKey = providers.filter((provider) => provider.requiresApiKey);
  let keyStatus: BlockchainViewItem['keyStatus'];
  let missingKeyCount = 0;

  if (providersRequiringKey.length === 0) {
    keyStatus = 'none-needed';
  } else {
    missingKeyCount = providersRequiringKey.filter((provider) => provider.apiKeyConfigured === false).length;
    keyStatus = missingKeyCount === 0 ? 'all-configured' : 'some-missing';
  }

  return {
    name: blockchain.name,
    displayName: blockchain.displayName,
    category: blockchain.category,
    layer: blockchain.layer,
    providers,
    providerCount: blockchain.providerCount,
    keyStatus,
    missingKeyCount,
    exampleAddress: blockchain.exampleAddress,
  };
}
