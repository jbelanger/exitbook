import { describe, expect, expectTypeOf, it } from 'vitest';

import { BITCOIN_CHAINS, getBitcoinChainConfig, type BitcoinChainName } from '../blockchains/bitcoin/index.js';
import {
  COSMOS_CHAINS,
  getAllCosmosChainNames,
  getCosmosChainConfig,
  isCosmosChainSupported,
  type CosmosChainName,
} from '../blockchains/cosmos/index.js';
import { EVM_CHAINS, getEvmChainConfig, type EvmChainName } from '../blockchains/evm/index.js';

type Assert<T extends true> = T;
type IsLiteralUnion<T extends string> = string extends T ? false : true;

type _BitcoinChainNameStaysLiteral = Assert<IsLiteralUnion<BitcoinChainName>>;
type _CosmosChainNameStaysLiteral = Assert<IsLiteralUnion<CosmosChainName>>;
type _EvmChainNameStaysLiteral = Assert<IsLiteralUnion<EvmChainName>>;

describe('chain registry typing', () => {
  it('keeps literal key unions at registry boundaries', () => {
    expectTypeOf<BitcoinChainName>().toEqualTypeOf<keyof typeof BITCOIN_CHAINS>();
    expectTypeOf<CosmosChainName>().toEqualTypeOf<keyof typeof COSMOS_CHAINS>();
    expectTypeOf<EvmChainName>().toEqualTypeOf<keyof typeof EVM_CHAINS>();
  });

  it('exposes typed lookup helpers without widening the registry', () => {
    expect(getBitcoinChainConfig('bitcoin')).toEqual(BITCOIN_CHAINS['bitcoin']);
    expect(getCosmosChainConfig('injective')).toEqual(COSMOS_CHAINS['injective']);
    expect(getEvmChainConfig('ethereum')).toEqual(EVM_CHAINS['ethereum']);
    expect(getBitcoinChainConfig('not-a-chain')).toBeUndefined();
    expect(getCosmosChainConfig('not-a-chain')).toBeUndefined();
    expect(getEvmChainConfig('not-a-chain')).toBeUndefined();
  });

  it('keeps cosmos helper contracts aligned with the union type', () => {
    expect(getAllCosmosChainNames()).toContain('injective');
    expect(isCosmosChainSupported('injective')).toBe(true);
    expect(isCosmosChainSupported('not-a-chain')).toBe(false);
    expectTypeOf(getAllCosmosChainNames()).toEqualTypeOf<CosmosChainName[]>();
  });
});
