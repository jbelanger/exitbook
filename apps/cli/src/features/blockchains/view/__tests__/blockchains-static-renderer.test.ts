import { describe, expect, it } from 'vitest';

import type { BlockchainViewItem } from '../../blockchains-view-model.js';
import { buildBlockchainStaticDetail, buildBlockchainsStaticList } from '../blockchains-static-renderer.js';
import { createBlockchainsViewState } from '../blockchains-view-state.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

function createBlockchainViewItem(overrides: Partial<BlockchainViewItem> = {}): BlockchainViewItem {
  return {
    name: overrides.name ?? 'bitcoin',
    displayName: overrides.displayName ?? 'Bitcoin',
    category: overrides.category ?? 'utxo',
    layer: overrides.layer ?? '1',
    providers: overrides.providers ?? [],
    providerCount: overrides.providerCount ?? 0,
    keyStatus: overrides.keyStatus ?? 'none-needed',
    missingKeyCount: overrides.missingKeyCount ?? 0,
    exampleAddress: overrides.exampleAddress ?? 'bc1q...',
  };
}

describe('buildBlockchainsStaticList', () => {
  it('renders a compact static blockchain table', () => {
    const output = buildBlockchainsStaticList(
      createBlockchainsViewState(
        [
          createBlockchainViewItem({
            name: 'bitcoin',
            displayName: 'Bitcoin',
            category: 'utxo',
            providerCount: 1,
            keyStatus: 'none-needed',
          }),
          createBlockchainViewItem({
            name: 'ethereum',
            displayName: 'Ethereum',
            category: 'evm',
            providerCount: 2,
            keyStatus: 'all-configured',
          }),
        ],
        {},
        3,
        { utxo: 1, evm: 1 }
      )
    );

    expect(stripAnsi(output)).toContain('Blockchains 2 total · 1 evm · 1 utxo · 3 providers');
    expect(stripAnsi(output)).toContain('NAME');
    expect(stripAnsi(output)).toContain('KEY');
    expect(stripAnsi(output)).toContain('CATEGORY');
    expect(stripAnsi(output)).toContain('API KEYS');
    expect(stripAnsi(output)).toContain('Bitcoin');
    expect(stripAnsi(output)).toContain('bitcoin');
    expect(stripAnsi(output)).toContain('none needed');
    expect(stripAnsi(output)).toContain('Ethereum');
    expect(stripAnsi(output)).toContain('all configured');
    expect(stripAnsi(output)).not.toContain('q/esc quit');
  });

  it('renders a filtered empty state without TUI chrome', () => {
    const output = buildBlockchainsStaticList(createBlockchainsViewState([], { categoryFilter: 'evm' }, 0, {}));

    expect(stripAnsi(output)).toContain('Blockchains (evm) 0 total · 0 providers');
    expect(stripAnsi(output)).toContain('No blockchains found for category evm.');
    expect(stripAnsi(output)).not.toContain('NAME');
  });

  it('renders an API-key filtered empty state with the shared browse message', () => {
    const output = buildBlockchainsStaticList(createBlockchainsViewState([], { requiresApiKeyFilter: true }, 0, {}));

    expect(stripAnsi(output)).toContain('Blockchains (requires API key) 0 total · 0 providers');
    expect(stripAnsi(output)).toContain('No blockchains found that require API keys.');
    expect(stripAnsi(output)).not.toContain('No blockchains registered.');
  });
});

describe('buildBlockchainStaticDetail', () => {
  it('renders a compact blockchain detail card', () => {
    const output = buildBlockchainStaticDetail(
      createBlockchainViewItem({
        name: 'ethereum',
        displayName: 'Ethereum',
        category: 'evm',
        layer: '1',
        providerCount: 2,
        keyStatus: 'some-missing',
        missingKeyCount: 1,
        exampleAddress: '0x742d35Cc...',
        providers: [
          {
            name: 'alchemy',
            displayName: 'Alchemy',
            requiresApiKey: true,
            apiKeyEnvName: 'ALCHEMY_API_KEY',
            apiKeyConfigured: true,
            capabilities: ['balance', 'txs', 'tokens'],
            rateLimit: '5/sec',
          },
          {
            name: 'etherscan',
            displayName: 'Etherscan',
            requiresApiKey: false,
            capabilities: ['balance', 'txs'],
            rateLimit: '5/sec',
          },
        ],
      })
    );

    expect(stripAnsi(output)).toContain('Ethereum ethereum evm L1');
    expect(stripAnsi(output)).toContain('Key: ethereum');
    expect(stripAnsi(output)).toContain('Category: evm');
    expect(stripAnsi(output)).toContain('Layer: L1');
    expect(stripAnsi(output)).toContain('Providers: 2');
    expect(stripAnsi(output)).toContain('API keys: 1 missing');
    expect(stripAnsi(output)).toContain('Example address: 0x742d35Cc...');
    expect(stripAnsi(output)).toContain('Providers');
    expect(stripAnsi(output)).toContain('Alchemy');
    expect(stripAnsi(output)).toContain('ALCHEMY_API_KEY configured');
    expect(stripAnsi(output)).toContain('Etherscan');
    expect(stripAnsi(output)).toContain('no key needed');
    expect(stripAnsi(output)).not.toContain('q/esc quit');
  });
});
