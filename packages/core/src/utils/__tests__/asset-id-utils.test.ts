import { describe, expect, it } from 'vitest';

import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  buildExchangeAssetId,
  buildFiatAssetId,
  buildUnknownAssetId,
  parseAssetId,
} from '../asset-id-utils.js';

describe('buildBlockchainNativeAssetId', () => {
  it('builds assetId for native blockchain assets', () => {
    const result = buildBlockchainNativeAssetId('bitcoin');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('blockchain:bitcoin:native');
  });

  it('normalizes chain name to lowercase', () => {
    const result = buildBlockchainNativeAssetId('Ethereum');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('blockchain:ethereum:native');
  });

  it('returns error for empty chain name', () => {
    const result = buildBlockchainNativeAssetId('');
    expect(result.isErr()).toBe(true);
  });
});

describe('buildBlockchainTokenAssetId', () => {
  it('builds assetId for ERC-20 tokens', () => {
    const result = buildBlockchainTokenAssetId('ethereum', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });

  it('builds assetId for SPL tokens (preserves case)', () => {
    const result = buildBlockchainTokenAssetId('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('blockchain:solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  it('normalizes hex addresses to lowercase', () => {
    const result = buildBlockchainTokenAssetId('Ethereum', '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });

  it('preserves case for non-hex references (IBC denoms)', () => {
    const result = buildBlockchainTokenAssetId(
      'cosmos',
      'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(
      'blockchain:cosmos:ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
    );
  });

  it('returns error for empty chain name', () => {
    const result = buildBlockchainTokenAssetId('', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(result.isErr()).toBe(true);
  });

  it('returns error for empty token reference', () => {
    const result = buildBlockchainTokenAssetId('ethereum', '');
    expect(result.isErr()).toBe(true);
  });
});

describe('buildExchangeAssetId', () => {
  it('builds assetId for exchange assets', () => {
    const result = buildExchangeAssetId('kraken', 'BTC');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('exchange:kraken:btc');
  });

  it('normalizes to lowercase', () => {
    const result = buildExchangeAssetId('Kraken', 'USDC');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('exchange:kraken:usdc');
  });

  it('returns error for empty exchange name', () => {
    const result = buildExchangeAssetId('', 'BTC');
    expect(result.isErr()).toBe(true);
  });

  it('returns error for empty currency code', () => {
    const result = buildExchangeAssetId('kraken', '');
    expect(result.isErr()).toBe(true);
  });
});

describe('buildFiatAssetId', () => {
  it('builds assetId for fiat currencies', () => {
    const result = buildFiatAssetId('USD');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('fiat:usd');
  });

  it('normalizes to lowercase', () => {
    const result = buildFiatAssetId('EUR');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('fiat:eur');
  });

  it('returns error for empty currency code', () => {
    const result = buildFiatAssetId('');
    expect(result.isErr()).toBe(true);
  });
});

describe('buildUnknownAssetId', () => {
  it('builds fallback assetId when token reference is missing', () => {
    const result = buildUnknownAssetId('ethereum', 'USDC');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('blockchain:ethereum:unknown:usdc');
  });

  it('normalizes to lowercase', () => {
    const result = buildUnknownAssetId('Ethereum', 'USDC');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('blockchain:ethereum:unknown:usdc');
  });

  it('returns error for empty chain name', () => {
    const result = buildUnknownAssetId('', 'USDC');
    expect(result.isErr()).toBe(true);
  });

  it('returns error for empty symbol', () => {
    const result = buildUnknownAssetId('ethereum', '');
    expect(result.isErr()).toBe(true);
  });
});

describe('parseAssetId', () => {
  it('parses blockchain native assetId', () => {
    const result = parseAssetId('blockchain:ethereum:native');
    expect(result.isOk()).toBe(true);
    const parsed = result._unsafeUnwrap();
    expect(parsed).toEqual({
      namespace: 'blockchain',
      chain: 'ethereum',
      ref: 'native',
    });
  });

  it('parses blockchain token assetId', () => {
    const result = parseAssetId('blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(result.isOk()).toBe(true);
    const parsed = result._unsafeUnwrap();
    expect(parsed).toEqual({
      namespace: 'blockchain',
      chain: 'ethereum',
      ref: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    });
  });

  it('parses unknown assetId with multiple colons', () => {
    const result = parseAssetId('blockchain:ethereum:unknown:usdc');
    expect(result.isOk()).toBe(true);
    const parsed = result._unsafeUnwrap();
    expect(parsed).toEqual({
      namespace: 'blockchain',
      chain: 'ethereum',
      ref: 'unknown:usdc',
    });
  });

  it('parses exchange assetId', () => {
    const result = parseAssetId('exchange:kraken:btc');
    expect(result.isOk()).toBe(true);
    const parsed = result._unsafeUnwrap();
    expect(parsed).toEqual({
      namespace: 'exchange',
      exchange: 'kraken',
      currencyCode: 'btc',
    });
  });

  it('parses fiat assetId', () => {
    const result = parseAssetId('fiat:usd');
    expect(result.isOk()).toBe(true);
    const parsed = result._unsafeUnwrap();
    expect(parsed).toEqual({
      namespace: 'fiat',
      currencyCode: 'usd',
    });
  });

  it('returns error for invalid format', () => {
    const result = parseAssetId('invalid');
    expect(result.isErr()).toBe(true);
  });

  it('returns error for unknown namespace', () => {
    const result = parseAssetId('unknown:something:else');
    expect(result.isErr()).toBe(true);
  });

  it('returns error for incomplete blockchain assetId', () => {
    const result = parseAssetId('blockchain:ethereum');
    expect(result.isErr()).toBe(true);
  });

  it('returns error for incomplete exchange assetId', () => {
    const result = parseAssetId('exchange:kraken');
    expect(result.isErr()).toBe(true);
  });
});
