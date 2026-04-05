import type {
  HealthStatus,
  ProviderAggregateStats,
  ProviderBlockchainItem,
  ProviderViewItem,
} from '../providers-view-model.js';

export interface ProviderHealthDisplay {
  color: 'dim' | 'green' | 'yellow' | 'red';
  icon: string;
  label: string;
}

export function getProviderHealthDisplay(status: HealthStatus): ProviderHealthDisplay {
  switch (status) {
    case 'healthy':
      return { icon: '✓', color: 'green', label: 'healthy' };
    case 'degraded':
      return { icon: '⚠', color: 'yellow', label: 'degraded' };
    case 'unhealthy':
      return { icon: '✗', color: 'red', label: 'unhealthy' };
    case 'no-stats':
      return { icon: '·', color: 'dim', label: 'no stats' };
  }
}

export function buildProvidersFilterLabel(filters: {
  blockchainFilter?: string | undefined;
  healthFilter?: string | undefined;
  missingApiKeyFilter?: boolean | undefined;
}): string {
  const parts: string[] = [];

  if (filters.blockchainFilter) {
    parts.push(filters.blockchainFilter);
  }

  if (filters.healthFilter) {
    parts.push(filters.healthFilter);
  }

  if (filters.missingApiKeyFilter) {
    parts.push('missing API key');
  }

  return parts.length > 0 ? ` (${parts.join(' · ')})` : '';
}

export function buildProviderHealthParts(counts: {
  degraded: number;
  healthy: number;
  noStats: number;
  unhealthy: number;
}): { color: ProviderHealthDisplay['color']; count: number; label: string }[] {
  const parts: { color: ProviderHealthDisplay['color']; count: number; label: string }[] = [];

  if (counts.healthy > 0) parts.push({ count: counts.healthy, label: 'healthy', color: 'green' });
  if (counts.degraded > 0) parts.push({ count: counts.degraded, label: 'degraded', color: 'yellow' });
  if (counts.unhealthy > 0) parts.push({ count: counts.unhealthy, label: 'unhealthy', color: 'red' });
  if (counts.noStats > 0) parts.push({ count: counts.noStats, label: 'no stats', color: 'dim' });

  return parts;
}

export function formatProviderChainCount(count: number): string {
  return `${count} ${count === 1 ? 'chain' : 'chains'}`;
}

export function formatProviderAverageResponse(stats?: ProviderAggregateStats): string {
  return stats ? `${stats.avgResponseTime}ms` : '—';
}

export function formatProviderErrorRate(stats?: ProviderAggregateStats): string {
  return stats ? `${stats.errorRate}%` : '—';
}

export function formatProviderRequestCount(stats?: ProviderAggregateStats): string {
  return stats ? `${stats.totalRequests.toLocaleString()} req` : '0 req';
}

export function formatProviderApiKeyListStatus(
  provider: Pick<ProviderViewItem, 'apiKeyConfigured' | 'requiresApiKey'>
): string {
  if (!provider.requiresApiKey) {
    return '—';
  }

  return provider.apiKeyConfigured ? 'configured' : 'missing';
}

export function formatProviderApiKeyDetailStatus(
  provider: Pick<ProviderViewItem, 'apiKeyConfigured' | 'apiKeyEnvName' | 'requiresApiKey'>
): string {
  if (!provider.requiresApiKey) {
    return 'no key needed';
  }

  const suffix = provider.apiKeyConfigured ? 'configured' : 'missing';
  return provider.apiKeyEnvName ? `${provider.apiKeyEnvName} ${suffix}` : suffix;
}

export function buildProvidersEmptyStateMessage(filters: {
  blockchainFilter?: string | undefined;
  healthFilter?: string | undefined;
  missingApiKeyFilter?: boolean | undefined;
}): string {
  const fragments: string[] = [];

  if (filters.blockchainFilter) {
    fragments.push(`for blockchain ${filters.blockchainFilter}`);
  }

  if (filters.healthFilter) {
    fragments.push(`with health ${filters.healthFilter}`);
  }

  if (filters.missingApiKeyFilter) {
    fragments.push('with missing API keys');
  }

  if (fragments.length === 0) {
    return 'No providers found.';
  }

  return `No providers found ${fragments.join(' ')}.`;
}

export function formatProviderBlockchainRequestCount(blockchain: ProviderBlockchainItem): string {
  if (!blockchain.stats) {
    return '—';
  }

  return `${blockchain.stats.totalSuccesses + blockchain.stats.totalFailures} req`;
}

export function formatProviderBlockchainErrorRate(blockchain: ProviderBlockchainItem): string {
  return blockchain.stats ? `${blockchain.stats.errorRate}%` : '—';
}

export function formatProviderBlockchainAverageResponse(blockchain: ProviderBlockchainItem): string {
  return blockchain.stats ? `${blockchain.stats.avgResponseTime}ms` : '—';
}

export function getProviderBlockchainAlert(blockchain: ProviderBlockchainItem): string | undefined {
  if (!blockchain.stats) {
    return undefined;
  }

  if (blockchain.stats.errorRate >= 5) {
    return 'high error rate';
  }

  if (blockchain.stats.avgResponseTime > 500) {
    return 'slow';
  }

  return undefined;
}
