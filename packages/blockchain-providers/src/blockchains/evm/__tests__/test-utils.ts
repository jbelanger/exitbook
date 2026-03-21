import type { Currency } from '@exitbook/core';

import type { EvmChainConfig } from '../chain-config.interface.js';

// Re-export core test helpers for convenient single-import in EVM tests
export {
  createMockHttpClient,
  expectErr,
  expectOk,
  injectMockHttpClient,
  resetMockHttpClient,
  type MockHttpClient,
} from '../../../test-support/provider-test-utils.js';

// ── Mock chain configs ──────────────────────────────────────────────

export const mockEthereumChainConfig: EvmChainConfig = {
  chainId: 1,
  chainName: 'ethereum',
  nativeCurrency: 'ETH' as Currency,
  nativeDecimals: 18,
  explorerUrls: ['https://etherscan.io'],
  transactionTypes: ['normal', 'internal', 'token', 'beacon_withdrawal'],
};

export const mockAvalancheChainConfig: EvmChainConfig = {
  chainId: 43114,
  chainName: 'avalanche',
  nativeCurrency: 'AVAX' as Currency,
  nativeDecimals: 18,
  explorerUrls: ['https://snowtrace.io'],
  transactionTypes: ['normal', 'token'],
};

export const mockPolygonChainConfig: EvmChainConfig = {
  chainId: 137,
  chainName: 'polygon',
  nativeCurrency: 'MATIC' as Currency,
  nativeDecimals: 18,
  explorerUrls: ['https://polygonscan.com'],
  transactionTypes: ['normal', 'internal', 'token'],
};
