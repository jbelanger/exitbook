import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { BlockchainsViewApp } from '../blockchains-view-components.jsx';
import { createBlockchainsViewState } from '../blockchains-view-state.js';

const mockOnQuit = () => {
  /* empty */
};

describe('BlockchainsViewApp', () => {
  it('renders the detail panel with the static-detail fields instead of command hints', () => {
    const state = createBlockchainsViewState(
      [
        {
          name: 'ethereum',
          displayName: 'Ethereum',
          category: 'evm',
          layer: '1',
          providers: [
            {
              name: 'alchemy',
              displayName: 'Alchemy',
              requiresApiKey: true,
              apiKeyEnvName: 'ALCHEMY_API_KEY',
              apiKeyConfigured: true,
              capabilities: ['txs', 'balance', 'tokens'],
              rateLimit: '10/sec',
            },
            {
              name: 'etherscan',
              displayName: 'Etherscan',
              requiresApiKey: false,
              capabilities: ['txs', 'balance'],
              rateLimit: '5/sec',
            },
          ],
          providerCount: 2,
          keyStatus: 'all-configured',
          missingKeyCount: 0,
          exampleAddress: '0x742d35Cc...',
        },
      ],
      {},
      2
    );

    const frame = render(
      <BlockchainsViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    ).lastFrame();

    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('▸ Ethereum ethereum evm L1');
    expect(frame).toContain('Providers: 2');
    expect(frame).toContain('API keys: all configured');
    expect(frame).toContain('Example address: 0x742d35Cc...');
    expect(frame).toContain('Providers');
    expect(frame).toContain('Alchemy');
    expect(frame).toContain('ALCHEMY_API_KEY configured');
    expect(frame).not.toContain('Example: exitbook accounts add');
    expect(frame).not.toContain('exitbook import main-wallet');
  });

  it('keeps a stable frame height when provider detail content changes', () => {
    const stateWithProviders = createBlockchainsViewState(
      [
        {
          name: 'ethereum',
          displayName: 'Ethereum',
          category: 'evm',
          layer: '1',
          providers: [
            {
              name: 'alchemy',
              displayName: 'Alchemy',
              requiresApiKey: true,
              apiKeyEnvName: 'ALCHEMY_API_KEY',
              apiKeyConfigured: true,
              capabilities: ['txs', 'balance'],
              rateLimit: '10/sec',
            },
            {
              name: 'etherscan',
              displayName: 'Etherscan',
              requiresApiKey: true,
              apiKeyEnvName: 'ETHERSCAN_API_KEY',
              apiKeyConfigured: false,
              capabilities: ['txs'],
              rateLimit: '5/sec',
            },
            {
              name: 'routescan',
              displayName: 'RouteScan',
              requiresApiKey: false,
              capabilities: ['txs', 'balance'],
            },
          ],
          providerCount: 3,
          keyStatus: 'some-missing',
          missingKeyCount: 1,
          exampleAddress: '0xabc',
        },
        {
          name: 'solana',
          displayName: 'Solana',
          category: 'solana',
          providers: [],
          providerCount: 0,
          keyStatus: 'none-needed',
          missingKeyCount: 0,
          exampleAddress: 'So11111111111111111111111111111111111111112',
        },
      ],
      {},
      3
    );
    stateWithProviders.selectedIndex = 0;

    const populatedFrame = render(
      <BlockchainsViewApp
        initialState={stateWithProviders}
        onQuit={mockOnQuit}
      />
    ).lastFrame();

    const stateWithoutProviders = createBlockchainsViewState([...stateWithProviders.blockchains], {}, 3);
    stateWithoutProviders.selectedIndex = 1;

    const emptyFrame = render(
      <BlockchainsViewApp
        initialState={stateWithoutProviders}
        onQuit={mockOnQuit}
      />
    ).lastFrame();

    expect(populatedFrame?.split('\n').length).toBe(emptyFrame?.split('\n').length);
  });
});
