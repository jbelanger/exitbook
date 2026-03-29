import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { BlockchainsViewApp } from '../blockchains-view-components.jsx';
import { createBlockchainsViewState } from '../blockchains-view-state.js';

const mockOnQuit = () => {
  /* empty */
};

describe('BlockchainsViewApp', () => {
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
