import type { EvmChainConfig, CosmosChainConfig } from '@exitbook/blockchain-providers';

/**
 * Test addresses for Bitcoin blockchain tests
 */
export const BITCOIN_ADDRESSES = {
  user: 'bc1quser1111111111111111111111111111111',
  derived1: 'bc1qderived1111111111111111111111111111',
  derived2: 'bc1qderived2222222222222222222222222222',
  external: 'bc1qexternal111111111111111111111111111',
  anotherExternal: 'bc1qanother222222222222222222222222222',
} as const;

/**
 * Test addresses for EVM blockchain tests (Ethereum, Avalanche, etc.)
 */
export const EVM_ADDRESSES = {
  user: '0xabc',
  external: '0xdef',
  another: '0xghi',
  token: '0xtoken',
} as const;

/**
 * Test addresses for Solana blockchain tests
 */
export const SOLANA_ADDRESSES = {
  user: 'user1111111111111111111111111111111111111111',
  external: 'external222222222222222222222222222222222222',
  contract: 'contract333333333333333333333333333333333333',
  tokenAccount: 'token4444444444444444444444444444444444444444',
} as const;

/**
 * Test addresses for Cosmos blockchain tests (Injective, Osmosis, etc.)
 */
export const COSMOS_ADDRESSES = {
  // Injective addresses (inj1 prefix)
  injective: {
    user: 'inj1user000000000000000000000000000000000',
    external: 'inj1external0000000000000000000000000000',
    contract: 'inj1contract0000000000000000000000000000',
  },
  // Osmosis addresses (osmo prefix)
  osmosis: {
    user: 'osmo1user00000000000000000000000000000000',
    external: 'osmo1external000000000000000000000000000',
  },
} as const;

/**
 * Common EVM chain configurations for tests
 */
export const EVM_CHAIN_CONFIGS = {
  ethereum: {
    chainId: 1,
    chainName: 'ethereum',
    nativeCurrency: 'ETH',
    nativeDecimals: 18,
  } satisfies EvmChainConfig,

  avalanche: {
    chainId: 43114,
    chainName: 'avalanche',
    nativeCurrency: 'AVAX',
    nativeDecimals: 18,
  } satisfies EvmChainConfig,

  polygon: {
    chainId: 137,
    chainName: 'polygon',
    nativeCurrency: 'MATIC',
    nativeDecimals: 18,
  } satisfies EvmChainConfig,

  base: {
    chainId: 8453,
    chainName: 'base',
    nativeCurrency: 'ETH',
    nativeDecimals: 18,
  } satisfies EvmChainConfig,
} as const;

/**
 * Common Cosmos chain configurations for tests
 */
export const COSMOS_CHAIN_CONFIGS = {
  injective: {
    bech32Prefix: 'inj',
    chainId: 'injective-1',
    chainName: 'injective',
    displayName: 'Injective Protocol',
    nativeCurrency: 'INJ',
    nativeDecimals: 18,
    nativeDenom: 'inj',
  } satisfies CosmosChainConfig,

  osmosis: {
    bech32Prefix: 'osmo',
    chainId: 'osmosis-1',
    chainName: 'osmosis',
    displayName: 'Osmosis',
    nativeCurrency: 'OSMO',
    nativeDecimals: 6,
    nativeDenom: 'uosmo',
  } satisfies CosmosChainConfig,
} as const;

/**
 * Common test timestamps (in milliseconds)
 */
export const TEST_TIMESTAMPS = {
  now: Date.now(),
  jan2024: 1704067200000, // 2024-01-01 00:00:00 UTC
  feb2024: 1706745600000, // 2024-02-01 00:00:00 UTC
  mar2024: 1709251200000, // 2024-03-01 00:00:00 UTC
} as const;

/**
 * Common mock transaction values for EVM
 */
export const MOCK_EVM_TRANSACTIONS = {
  normal: {
    hash: '0x123',
    from: EVM_ADDRESSES.user,
    to: EVM_ADDRESSES.external,
    value: '1000000000000000000', // 1 ETH in wei
  },
  internal: {
    hash: '0x123',
    from: EVM_ADDRESSES.external,
    to: EVM_ADDRESSES.another,
    value: '500000000000000000', // 0.5 ETH in wei
  },
  token: {
    hash: '0x456',
    from: EVM_ADDRESSES.user,
    to: EVM_ADDRESSES.external,
    tokenAddress: EVM_ADDRESSES.token,
    value: '1000000', // 1 USDC (6 decimals)
  },
} as const;
