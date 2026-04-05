import { render } from 'ink-testing-library';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ProviderViewItem } from '../../providers-view-model.js';
import { ProvidersViewApp } from '../providers-view-components.jsx';
import { createProvidersViewState } from '../providers-view-state.js';

vi.mock('../../../../ui/shared/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../ui/shared/index.js')>(
    '../../../../ui/shared/index.js'
  );

  return {
    ...actual,
    FixedHeightDetail: ({ rows }: { rows: ReactNode[] }) => <>{rows}</>,
  };
});

const mockOnQuit = () => {
  /* empty */
};

function createProviderViewItem(
  overrides: Partial<ProviderViewItem> & Pick<ProviderViewItem, 'name'>
): ProviderViewItem {
  return {
    apiKeyConfigured: overrides.apiKeyConfigured,
    apiKeyEnvName: overrides.apiKeyEnvName,
    blockchains: overrides.blockchains ?? [],
    chainCount: overrides.chainCount ?? 1,
    configSource: overrides.configSource ?? 'default',
    displayName: overrides.displayName ?? overrides.name,
    healthStatus: overrides.healthStatus ?? 'healthy',
    lastError: overrides.lastError,
    lastErrorTime: overrides.lastErrorTime,
    name: overrides.name,
    rateLimit: overrides.rateLimit ?? '5/sec',
    requiresApiKey: overrides.requiresApiKey ?? false,
    stats: overrides.stats,
  };
}

describe('ProvidersViewApp', () => {
  it('renders filtered empty explorer messaging', () => {
    const state = createProvidersViewState([], { missingApiKeyFilter: true });

    const frame = render(
      <ProvidersViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    ).lastFrame();

    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('Providers (missing API key) 0 total');
    expect(frame).toContain('No providers found with missing API keys.');
    expect(frame).not.toContain('No usage data. Run an import');
  });

  it('renders the detail panel with the static-detail fields instead of command hints', () => {
    const state = createProvidersViewState(
      [
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
        }),
      ],
      {}
    );

    const frame = render(
      <ProvidersViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    ).lastFrame();

    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('▸ Alchemy degraded');
    expect(frame).toContain('Name: alchemy');
    expect(frame).toContain('Chains: 2 chains');
    expect(frame).toContain('Health: degraded');
    expect(frame).toContain('Total requests: 256 req');
    expect(frame).toContain('Avg response: 240ms');
    expect(frame).toContain('Error rate: 3.1%');
    expect(frame).toContain('Config: 5/sec (default)');
    expect(frame).toContain('API key: ALCHEMY_API_KEY configured');
    expect(frame).toContain('Last error: 429 Too Many Requests');
    expect(frame).toContain('Blockchains');
    expect(frame).toContain('ethereum');
    expect(frame).toContain('polygon');
    expect(frame).not.toContain('No usage data. Run an import');
    expect(frame).not.toContain('exitbook accounts add example-wallet');
  });

  it('keeps no-stats detail on the same browse contract without import hints', () => {
    const state = createProvidersViewState(
      [
        createProviderViewItem({
          name: 'blockstream.info',
          displayName: 'Blockstream.info',
          healthStatus: 'no-stats',
          blockchains: [
            {
              name: 'bitcoin',
              capabilities: ['txs', 'balance'],
              rateLimit: '5/sec',
              configSource: 'default',
            },
          ],
        }),
      ],
      {}
    );

    const frame = render(
      <ProvidersViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    ).lastFrame();

    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('▸ Blockstream.info no stats');
    expect(frame).toContain('Health: no stats');
    expect(frame).toContain('Total requests: 0 req');
    expect(frame).toContain('API key: no key needed');
    expect(frame).toContain('bitcoin');
    expect(frame).not.toContain('No usage data. Run an import');
    expect(frame).not.toContain('exitbook import example-wallet');
  });
});
