import { describe, expect, it } from 'vitest';

import type { ProviderViewItem } from '../../providers-view-model.js';
import { buildProviderStaticDetail, buildProvidersStaticList } from '../providers-static-renderer.js';
import { createProvidersViewState } from '../providers-view-state.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

function createProviderViewItem(
  overrides: Partial<ProviderViewItem> & Pick<ProviderViewItem, 'name'>
): ProviderViewItem {
  return {
    displayName: overrides.displayName ?? overrides.name,
    requiresApiKey: overrides.requiresApiKey ?? false,
    apiKeyEnvName: overrides.apiKeyEnvName,
    apiKeyConfigured: overrides.apiKeyConfigured,
    blockchains: overrides.blockchains ?? [],
    chainCount: overrides.chainCount ?? 1,
    healthStatus: overrides.healthStatus ?? 'healthy',
    stats: overrides.stats,
    rateLimit: overrides.rateLimit ?? '5/sec',
    configSource: overrides.configSource ?? 'default',
    lastError: overrides.lastError,
    lastErrorTime: overrides.lastErrorTime,
    name: overrides.name,
  };
}

describe('buildProvidersStaticList', () => {
  it('renders a compact provider table', () => {
    const output = buildProvidersStaticList(
      createProvidersViewState(
        [
          createProviderViewItem({
            name: 'alchemy',
            requiresApiKey: true,
            apiKeyConfigured: true,
            chainCount: 2,
            stats: {
              totalRequests: 100,
              avgResponseTime: 120,
              errorRate: 0.4,
              lastChecked: 1_700_000_000,
            },
          }),
          createProviderViewItem({
            name: 'blockstream.info',
            displayName: 'Blockstream.info',
            chainCount: 1,
            healthStatus: 'no-stats',
          }),
        ],
        {},
        { healthy: 1, degraded: 0, unhealthy: 0, noStats: 1 }
      )
    );

    expect(stripAnsi(output)).toContain('Providers 2 total · 1 healthy · 1 no stats · 1 require API key');
    expect(stripAnsi(output)).toContain('NAME');
    expect(stripAnsi(output)).toContain('CHAINS');
    expect(stripAnsi(output)).toContain('HEALTH');
    expect(stripAnsi(output)).toContain('API KEY');
    expect(stripAnsi(output)).toContain('alchemy');
    expect(stripAnsi(output)).toContain('configured');
    expect(stripAnsi(output)).toContain('blockstream.info');
    expect(stripAnsi(output)).toContain('no stats');
  });

  it('renders a filtered empty state without TUI chrome', () => {
    const output = buildProvidersStaticList(createProvidersViewState([], { blockchainFilter: 'ethereum' }));

    expect(stripAnsi(output)).toContain('Providers (ethereum) 0 total · 0 require API key');
    expect(stripAnsi(output)).toContain('No providers found for blockchain ethereum.');
    expect(stripAnsi(output)).not.toContain('NAME');
    expect(stripAnsi(output)).not.toContain('q/esc quit');
  });
});

describe('buildProviderStaticDetail', () => {
  it('renders a compact provider detail card', () => {
    const output = buildProviderStaticDetail(
      createProviderViewItem({
        name: 'alchemy',
        displayName: 'Alchemy',
        requiresApiKey: true,
        apiKeyEnvName: 'ALCHEMY_API_KEY',
        apiKeyConfigured: true,
        chainCount: 2,
        healthStatus: 'degraded',
        stats: {
          totalRequests: 256,
          avgResponseTime: 240,
          errorRate: 3.1,
          lastChecked: 1_700_000_000,
        },
        blockchains: [
          {
            name: 'ethereum',
            capabilities: ['txs', 'balance', 'tokens'],
            rateLimit: '5/sec',
            configSource: 'default',
            stats: {
              totalSuccesses: 140,
              totalFailures: 2,
              avgResponseTime: 145,
              errorRate: 1.4,
              isHealthy: true,
            },
          },
          {
            name: 'polygon',
            capabilities: ['txs', 'balance'],
            rateLimit: '5/sec',
            configSource: 'override',
            stats: {
              totalSuccesses: 100,
              totalFailures: 14,
              avgResponseTime: 540,
              errorRate: 12.3,
              isHealthy: false,
            },
          },
        ],
        lastError: '429 Too Many Requests',
        lastErrorTime: Date.now() - 60_000,
      })
    );

    expect(stripAnsi(output)).toContain('Alchemy degraded');
    expect(stripAnsi(output)).toContain('Name: alchemy');
    expect(stripAnsi(output)).toContain('Chains: 2 chains');
    expect(stripAnsi(output)).toContain('Health: degraded');
    expect(stripAnsi(output)).toContain('Total requests: 256 req');
    expect(stripAnsi(output)).toContain('Avg response: 240ms');
    expect(stripAnsi(output)).toContain('Error rate: 3.1%');
    expect(stripAnsi(output)).toContain('Config: 5/sec (default)');
    expect(stripAnsi(output)).toContain('API key: ALCHEMY_API_KEY configured');
    expect(stripAnsi(output)).toContain('Last error: 429 Too Many Requests');
    expect(stripAnsi(output)).toContain('Blockchains');
    expect(stripAnsi(output)).toContain('ethereum');
    expect(stripAnsi(output)).toContain('polygon');
    expect(stripAnsi(output)).toContain('high error rate');
  });
});
