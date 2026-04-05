import type { BlockchainViewItem, ProviderViewItem } from '../blockchains-view-model.js';

export interface BlockchainKeyStatusDisplay {
  color: 'dim' | 'green' | 'yellow';
  icon: string;
  label: string;
}

export interface BlockchainDetailField {
  label: string;
  value: string;
}

export interface BlockchainTitleParts {
  category: string;
  displayName: string;
  key: string;
  layerLabel?: string | undefined;
}

export function buildCategoryParts(counts: Record<string, number>): { count: number; label: string }[] {
  const order = ['evm', 'substrate', 'utxo', 'solana', 'cosmos'];
  const parts: { count: number; label: string }[] = [];

  for (const category of order) {
    const count = counts[category];
    if (count && count > 0) {
      parts.push({ label: category, count });
    }
  }

  for (const [category, count] of Object.entries(counts)) {
    if (!order.includes(category) && count > 0) {
      parts.push({ label: category, count });
    }
  }

  return parts;
}

export function buildBlockchainsFilterLabel(filters: {
  categoryFilter?: string | undefined;
  requiresApiKeyFilter?: boolean | undefined;
}): string {
  if (filters.categoryFilter && filters.requiresApiKeyFilter) {
    return ` (${filters.categoryFilter} · requires API key)`;
  }

  if (filters.categoryFilter) {
    return ` (${filters.categoryFilter})`;
  }

  if (filters.requiresApiKeyFilter) {
    return ' (requires API key)';
  }

  return '';
}

export function buildBlockchainsEmptyStateMessage(filters: {
  categoryFilter?: string | undefined;
  requiresApiKeyFilter?: boolean | undefined;
}): string {
  if (filters.categoryFilter && filters.requiresApiKeyFilter) {
    return `No blockchains found for category ${filters.categoryFilter} that require API keys.`;
  }

  if (filters.categoryFilter) {
    return `No blockchains found for category ${filters.categoryFilter}.`;
  }

  if (filters.requiresApiKeyFilter) {
    return 'No blockchains found that require API keys.';
  }

  return 'No blockchains found.';
}

export function formatBlockchainLayer(layer?: string): string {
  return layer ? `L${layer}` : '—';
}

export function buildBlockchainTitleParts(
  blockchain: Pick<BlockchainViewItem, 'category' | 'displayName' | 'layer' | 'name'>
): BlockchainTitleParts {
  return {
    category: blockchain.category,
    displayName: blockchain.displayName,
    key: blockchain.name,
    layerLabel: blockchain.layer ? formatBlockchainLayer(blockchain.layer) : undefined,
  };
}

export function buildBlockchainDetailFields(
  blockchain: BlockchainViewItem,
  options: {
    includeRepeatedTitleFields?: boolean | undefined;
  } = {}
): BlockchainDetailField[] {
  const fields: BlockchainDetailField[] = [];

  if (options.includeRepeatedTitleFields) {
    fields.push({ label: 'Key', value: blockchain.name }, { label: 'Category', value: blockchain.category });

    if (blockchain.layer) {
      fields.push({ label: 'Layer', value: formatBlockchainLayer(blockchain.layer) });
    }
  }

  fields.push(
    { label: 'Providers', value: String(blockchain.providerCount) },
    { label: 'API keys', value: getBlockchainKeyStatusDisplay(blockchain.keyStatus, blockchain.missingKeyCount).label },
    { label: 'Example address', value: blockchain.exampleAddress }
  );

  return fields;
}

export function formatProviderCount(count: number): string {
  return `${count} provider${count === 1 ? '' : 's'}`;
}

export function getBlockchainKeyStatusDisplay(
  status: BlockchainViewItem['keyStatus'],
  missingCount: number
): BlockchainKeyStatusDisplay {
  switch (status) {
    case 'all-configured':
      return { icon: '✓', color: 'green', label: 'all configured' };
    case 'some-missing':
      return { icon: '⚠', color: 'yellow', label: `${missingCount} missing` };
    case 'none-needed':
      return { icon: '⊘', color: 'dim', label: 'none needed' };
  }
}

export function formatProviderCapabilities(provider: ProviderViewItem): string {
  return provider.capabilities.join(' · ');
}

export function formatProviderApiKeyStatus(provider: ProviderViewItem): string {
  if (!provider.requiresApiKey) {
    return 'no key needed';
  }

  if (!provider.apiKeyEnvName) {
    return provider.apiKeyConfigured ? 'configured' : 'missing';
  }

  return `${provider.apiKeyEnvName} ${provider.apiKeyConfigured ? 'configured' : 'missing'}`;
}
