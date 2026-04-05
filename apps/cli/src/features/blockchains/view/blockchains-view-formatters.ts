import type { BlockchainViewItem, ProviderViewItem } from '../blockchains-view-model.js';

export interface BlockchainKeyStatusDisplay {
  color: 'dim' | 'green' | 'yellow';
  icon: string;
  label: string;
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

export function formatBlockchainLayer(layer?: string): string {
  return layer ? `L${layer}` : '—';
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
