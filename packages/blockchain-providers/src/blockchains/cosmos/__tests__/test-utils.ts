import type { Currency } from '@exitbook/core';

import type { CosmosChainConfig } from '../chain-config.interface.js';

// Re-export core test helpers for convenient single-import in cosmos tests
export {
  createMockHttpClient,
  expectErr,
  expectOk,
  injectMockHttpClient,
  resetMockHttpClient,
  type MockHttpClient,
} from '../../../test-support/provider-test-utils.js';

// ── Mock chain configs ──────────────────────────────────────────────

export const mockCosmosHubChainConfig: CosmosChainConfig = {
  bech32Prefix: 'cosmos',
  chainId: 'cosmoshub-4',
  chainName: 'cosmoshub',
  displayName: 'Cosmos Hub',
  nativeCurrency: 'ATOM' as Currency,
  nativeDecimals: 6,
  nativeDenom: 'uatom',
  restEndpoints: ['https://lcd.cosmos.network'],
};

export const mockOsmosisChainConfig: CosmosChainConfig = {
  bech32Prefix: 'osmo',
  chainId: 'osmosis-1',
  chainName: 'osmosis',
  displayName: 'Osmosis',
  nativeCurrency: 'OSMO' as Currency,
  nativeDecimals: 6,
  nativeDenom: 'uosmo',
  restEndpoints: ['https://lcd.osmosis.zone'],
};

export const mockInjectiveChainConfig: CosmosChainConfig = {
  bech32Prefix: 'inj',
  chainId: 'injective-1',
  chainName: 'injective',
  displayName: 'Injective Protocol',
  nativeCurrency: 'INJ' as Currency,
  nativeDecimals: 18,
  nativeDenom: 'inj',
  restEndpoints: ['https://lcd.injective.network'],
};

export const mockAkashChainConfig: CosmosChainConfig = {
  bech32Prefix: 'akash',
  chainId: 'akashnet-2',
  chainName: 'akash',
  displayName: 'Akash Network',
  nativeCurrency: 'AKT' as Currency,
  nativeDecimals: 6,
  nativeDenom: 'uakt',
  restEndpoints: ['https://api.akashnet.net'],
};
