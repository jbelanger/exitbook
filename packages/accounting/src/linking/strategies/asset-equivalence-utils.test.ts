import type { Currency } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { createLinkableMovement } from '../shared/test-utils.js';

import { areLinkingAssetsEquivalent } from './asset-equivalence-utils.js';

describe('areLinkingAssetsEquivalent', () => {
  it('should return true when assetIds are identical', () => {
    const source = createLinkableMovement({ assetId: 'exchange:kraken:btc', assetSymbol: 'BTC' as Currency });
    const target = createLinkableMovement({ assetId: 'exchange:kraken:btc', assetSymbol: 'BITCOIN' as Currency });

    expect(areLinkingAssetsEquivalent(source, target)).toBe(true);
  });

  it('should return true when normalized symbols match (case insensitive)', () => {
    const source = createLinkableMovement({ assetId: 'exchange:kraken:btc', assetSymbol: 'BTC' as Currency });
    const target = createLinkableMovement({ assetId: 'blockchain:bitcoin:native', assetSymbol: 'btc' as Currency });

    expect(areLinkingAssetsEquivalent(source, target)).toBe(true);
  });

  it('should return true when symbols match with whitespace', () => {
    const source = createLinkableMovement({ assetId: 'a', assetSymbol: '  BTC ' as Currency });
    const target = createLinkableMovement({ assetId: 'b', assetSymbol: 'BTC' as Currency });

    expect(areLinkingAssetsEquivalent(source, target)).toBe(true);
  });

  it('should return false when both assetIds and symbols differ', () => {
    const source = createLinkableMovement({ assetId: 'exchange:kraken:btc', assetSymbol: 'BTC' as Currency });
    const target = createLinkableMovement({ assetId: 'exchange:kraken:eth', assetSymbol: 'ETH' as Currency });

    expect(areLinkingAssetsEquivalent(source, target)).toBe(false);
  });

  it('should return false for different symbols when assetIds differ', () => {
    const source = createLinkableMovement({
      assetId: 'exchange:kucoin:rndr',
      assetSymbol: 'RNDR' as Currency,
    });
    const target = createLinkableMovement({
      assetId: 'blockchain:ethereum:0x6de037ef',
      assetSymbol: 'RENDER' as Currency,
    });

    expect(areLinkingAssetsEquivalent(source, target)).toBe(false);
  });
});
