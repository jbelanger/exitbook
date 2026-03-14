import type { Currency } from '@exitbook/core';

import type { BitcoinChainConfig } from '../chain-config.interface.js';

// Re-export core test helpers for convenient single-import in bitcoin tests
export {
  createMockHttpClient,
  expectErr,
  expectOk,
  injectMockHttpClient,
  resetMockHttpClient,
  type MockHttpClient,
} from '../../../core/utils/test-utils.js';

// ── Mock chain configs ──────────────────────────────────────────────

export const mockBitcoinChainConfig: BitcoinChainConfig = {
  chainName: 'bitcoin',
  displayName: 'Bitcoin',
  nativeCurrency: 'BTC' as Currency,
  nativeDecimals: 8,
};
