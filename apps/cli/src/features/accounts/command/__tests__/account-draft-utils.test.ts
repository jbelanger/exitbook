import { err } from '@exitbook/foundation';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';
import { describe, expect, it, vi } from 'vitest';

import { buildCreateAccountInput } from '../account-draft-utils.js';

function createRegistry(overrides: Partial<AdapterRegistry> = {}): AdapterRegistry {
  return {
    getAllBlockchains: vi.fn().mockReturnValue(['bitcoin', 'ethereum', 'solana']),
    getAllExchanges: vi.fn().mockReturnValue(['coinbase', 'kraken', 'kucoin']),
    getBlockchain: vi.fn().mockReturnValue(err(new Error('Unknown blockchain: fakechain'))),
    getExchange: vi.fn().mockReturnValue(err(new Error('Unknown exchange: fakeex'))),
    ...overrides,
  } as unknown as AdapterRegistry;
}

describe('buildCreateAccountInput', () => {
  it('suggests the blockchain catalog when the blockchain is unknown', () => {
    const result = buildCreateAccountInput(
      'wallet-main',
      1,
      {
        blockchain: 'fakechain',
        address: 'abc',
      },
      createRegistry()
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe(
        "Unknown blockchain: fakechain. Run 'exitbook blockchains view' to see supported blockchains."
      );
    }
  });

  it('lists supported exchanges when the exchange is unknown', () => {
    const result = buildCreateAccountInput(
      'exchange-main',
      1,
      {
        exchange: 'fakeex',
        csvDir: './exports/fakeex',
      },
      createRegistry()
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Unknown exchange: fakeex. Supported exchanges: coinbase, kraken, kucoin');
    }
  });
});
