import type { Account } from '@exitbook/core';
import { err } from '@exitbook/foundation';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';
import { describe, expect, it, vi } from 'vitest';

import { buildCreateAccountInput, buildUpdateAccountInput } from '../account-draft-utils.js';

function createRegistry(overrides: Partial<AdapterRegistry> = {}): AdapterRegistry {
  return {
    getAllBlockchains: vi.fn().mockReturnValue(['bitcoin', 'ethereum', 'solana']),
    getAllExchanges: vi.fn().mockReturnValue(['coinbase', 'kraken', 'kucoin']),
    getBlockchain: vi.fn().mockReturnValue(err(new Error('Unknown blockchain: fakechain'))),
    getExchange: vi.fn().mockReturnValue(err(new Error('Unknown exchange: fakeex'))),
    ...overrides,
  } as unknown as AdapterRegistry;
}

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 1,
    profileId: overrides.profileId ?? 1,
    name: overrides.name ?? 'kraken-main',
    parentAccountId: overrides.parentAccountId,
    accountType: overrides.accountType ?? 'exchange-api',
    platformKey: overrides.platformKey ?? 'kraken',
    identifier: overrides.identifier ?? 'old-key',
    accountFingerprint: overrides.accountFingerprint ?? '0'.repeat(64),
    providerName: overrides.providerName,
    credentials: overrides.credentials ?? { apiKey: 'old-key', apiSecret: 'old-secret' },
    lastCursor: overrides.lastCursor,
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt,
  };
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

describe('buildUpdateAccountInput', () => {
  it('allows a name-only update for an exchange API account', () => {
    const result = buildUpdateAccountInput(
      createAccount({
        accountType: 'exchange-api',
        platformKey: 'kraken',
      }),
      {
        name: 'kraken-primary',
      },
      createRegistry()
    );

    expect(result.isErr()).toBe(false);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      name: 'kraken-primary',
    });
  });

  it('combines name and API credential updates for an exchange API account', () => {
    const result = buildUpdateAccountInput(
      createAccount({
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'old-key',
        credentials: {
          apiKey: 'old-key',
          apiSecret: 'old-secret',
        },
      }),
      {
        name: 'kraken-primary',
        apiKey: 'new-key',
        apiSecret: 'new-secret',
      },
      createRegistry()
    );

    expect(result.isErr()).toBe(false);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      name: 'kraken-primary',
      identifier: 'new-key',
      credentials: {
        apiKey: 'new-key',
        apiSecret: 'new-secret',
      },
      resetCursor: true,
    });
  });
});
