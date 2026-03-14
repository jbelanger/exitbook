import { describe, expect, it } from 'vitest';

import { getThetaChainConfig, THETA_CHAINS } from '../chain-registry.js';

describe('theta/chain-registry', () => {
  it('loads theta family config with dual native assets', () => {
    expect(THETA_CHAINS['theta']).toEqual({
      chainName: 'theta',
      explorerUrls: ['https://explorer.thetatoken.org'],
      nativeAssets: [
        { decimals: 18, role: 'gas', symbol: 'TFUEL' },
        { decimals: 18, role: 'primary', symbol: 'THETA' },
      ],
      providerHints: {
        coingecko: {
          chainIdentifier: 361,
          tokenRefFormat: 'evm-contract',
        },
      },
      transactionTypes: ['normal'],
    });
  });

  it('returns configs by Theta chain name', () => {
    expect(getThetaChainConfig('theta')).toBe(THETA_CHAINS['theta']);
    expect(getThetaChainConfig('ethereum')).toBeUndefined();
  });
});
