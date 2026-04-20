import type { Account } from '@exitbook/core';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
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
    id: 1,
    profileId: 1,
    name: 'kraken-main',
    parentAccountId: undefined,
    accountType: 'exchange-api',
    platformKey: 'kraken',
    identifier: 'old-key',
    accountFingerprint: '0'.repeat(64),
    providerName: undefined,
    credentials: {
      apiKey: 'old-key',
      apiSecret: 'old-secret',
    },
    lastCursor: undefined,
    metadata: undefined,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: undefined,
    ...overrides,
  };
}

function createUtxoBlockchainAdapter(
  options: {
    isExtendedPublicKey?: boolean;
    normalizedAddress?: string;
  } = {}
) {
  return {
    blockchain: 'bitcoin',
    chainModel: 'utxo',
    normalizeAddress: vi.fn().mockReturnValue(ok(options.normalizedAddress ?? 'xpub6C-test')),
    isExtendedPublicKey: vi.fn().mockReturnValue(options.isExtendedPublicKey ?? true),
    deriveAddressesFromXpub: vi.fn(),
    createImporter: vi.fn(),
    createProcessor: vi.fn(),
  };
}

function createAccountBasedBlockchainAdapter(options: { normalizedAddress?: string } = {}) {
  return {
    blockchain: 'ethereum',
    chainModel: 'account-based',
    normalizeAddress: vi.fn().mockReturnValue(ok(options.normalizedAddress ?? '0xabc')),
    createImporter: vi.fn(),
    createProcessor: vi.fn(),
  };
}

function createExchangeAdapter(
  options: {
    exchange?: string;
    supportsApi?: boolean;
    supportsCsv?: boolean;
  } = {}
) {
  return {
    exchange: options.exchange ?? 'kraken',
    capabilities: {
      supportsApi: options.supportsApi ?? true,
      supportsCsv: options.supportsCsv ?? true,
    },
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

    expect(assertErr(result).message).toBe(
      "Unknown blockchain: fakechain. Run 'exitbook blockchains list' to see supported blockchains."
    );
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

    expect(assertErr(result).message).toBe('Unknown exchange: fakeex. Supported exchanges: coinbase, kraken, kucoin');
  });

  it('normalizes csv directories when building exchange-csv drafts', () => {
    const result = buildCreateAccountInput(
      'kucoin-csv',
      1,
      {
        exchange: 'kucoin',
        csvDir: './exports/kucoin///',
      },
      createRegistry({
        getExchange: vi.fn().mockReturnValue(
          ok(
            createExchangeAdapter({
              exchange: 'kucoin',
              supportsApi: false,
              supportsCsv: true,
            })
          )
        ),
      })
    );

    expect(assertOk(result)).toEqual({
      profileId: 1,
      name: 'kucoin-csv',
      accountType: 'exchange-csv',
      platformKey: 'kucoin',
      identifier: 'exports/kucoin',
      credentials: undefined,
    });
  });

  it('stores provider credentials on exchange-csv accounts when supplied', () => {
    const result = buildCreateAccountInput(
      'kucoin-csv',
      1,
      {
        exchange: 'kucoin',
        csvDir: './exports/kucoin/',
        apiKey: 'csv-key',
        apiSecret: 'csv-secret',
        apiPassphrase: 'csv-passphrase',
      },
      createRegistry({
        getExchange: vi.fn().mockReturnValue(
          ok(
            createExchangeAdapter({
              exchange: 'kucoin',
              supportsApi: false,
              supportsCsv: true,
            })
          )
        ),
      })
    );

    expect(assertOk(result)).toEqual({
      profileId: 1,
      name: 'kucoin-csv',
      accountType: 'exchange-csv',
      platformKey: 'kucoin',
      identifier: 'exports/kucoin',
      credentials: {
        apiKey: 'csv-key',
        apiSecret: 'csv-secret',
        apiPassphrase: 'csv-passphrase',
      },
    });
  });

  it('rejects csv drafts for exchanges without csv support', () => {
    const result = buildCreateAccountInput(
      'coinbase-csv',
      1,
      {
        exchange: 'coinbase',
        csvDir: './exports/coinbase',
      },
      createRegistry({
        getExchange: vi.fn().mockReturnValue(
          ok(
            createExchangeAdapter({
              exchange: 'coinbase',
              supportsApi: true,
              supportsCsv: false,
            })
          )
        ),
      })
    );

    expect(assertErr(result).message).toBe('Exchange "coinbase" does not support CSV import');
  });

  it('rejects api drafts when credentials are missing for api-only exchanges', () => {
    const result = buildCreateAccountInput(
      'kraken-api',
      1,
      {
        exchange: 'kraken',
      },
      createRegistry({
        getExchange: vi.fn().mockReturnValue(
          ok(
            createExchangeAdapter({
              exchange: 'kraken',
              supportsApi: true,
              supportsCsv: false,
            })
          )
        ),
      })
    );

    expect(assertErr(result).message).toBe('--api-key and --api-secret are required for exchange API accounts');
  });

  it('rejects passphrase-only exchange credentials', () => {
    const result = buildCreateAccountInput(
      'kraken-api',
      1,
      {
        exchange: 'kraken',
        apiPassphrase: 'secret-passphrase',
      },
      createRegistry({
        getExchange: vi.fn().mockReturnValue(ok(createExchangeAdapter({ exchange: 'kraken' }))),
      })
    );

    expect(assertErr(result).message).toBe('--api-passphrase requires --api-key and --api-secret');
  });

  it('rejects xpub gap for non-xpub blockchain accounts', () => {
    const result = buildCreateAccountInput(
      'eth-main',
      1,
      {
        blockchain: 'ethereum',
        address: '0xAbC',
        xpubGap: 25,
      },
      createRegistry({
        getBlockchain: vi.fn().mockReturnValue(ok(createAccountBasedBlockchainAdapter({ normalizedAddress: '0xabc' }))),
      })
    );

    expect(assertErr(result).message).toBe('--xpub-gap can only be used with extended public keys (xpubs)');
  });

  it('builds xpub metadata for utxo extended public keys', () => {
    const result = buildCreateAccountInput(
      'btc-xpub',
      1,
      {
        blockchain: 'bitcoin',
        address: 'xpub6C...',
        xpubGap: 40,
      },
      createRegistry({
        getBlockchain: vi.fn().mockReturnValue(
          ok(
            createUtxoBlockchainAdapter({
              normalizedAddress: 'xpub6C-normalized',
              isExtendedPublicKey: true,
            })
          )
        ),
      })
    );

    expect(assertOk(result)).toEqual({
      profileId: 1,
      name: 'btc-xpub',
      accountType: 'blockchain',
      platformKey: 'bitcoin',
      identifier: 'xpub6C-normalized',
      providerName: undefined,
      metadata: {
        xpub: {
          gapLimit: 40,
          lastDerivedAt: 0,
          derivedCount: 0,
        },
      },
    });
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

    expect(assertOk(result)).toEqual({
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

    expect(assertOk(result)).toEqual({
      name: 'kraken-primary',
      identifier: 'new-key',
      credentials: {
        apiKey: 'new-key',
        apiSecret: 'new-secret',
      },
      resetCursor: true,
    });
  });

  it('preserves an existing passphrase when only the api secret changes', () => {
    const result = buildUpdateAccountInput(
      createAccount({
        accountType: 'exchange-api',
        platformKey: 'kraken',
        credentials: {
          apiKey: 'old-key',
          apiSecret: 'old-secret',
          apiPassphrase: 'keep-me',
        },
      }),
      {
        apiSecret: 'new-secret',
      },
      createRegistry()
    );

    expect(assertOk(result)).toEqual({
      identifier: 'old-key',
      credentials: {
        apiKey: 'old-key',
        apiSecret: 'new-secret',
        apiPassphrase: 'keep-me',
      },
      resetCursor: false,
    });
  });

  it('rejects exchange API updates that leave credentials unchanged', () => {
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
        apiKey: 'old-key',
        apiSecret: 'old-secret',
      },
      createRegistry()
    );

    expect(assertErr(result).message).toBe('No account property changes were provided');
  });

  it('normalizes updated csv directories and resets the cursor when the location changes', () => {
    const result = buildUpdateAccountInput(
      createAccount({
        accountType: 'exchange-csv',
        platformKey: 'kucoin',
        identifier: 'exports/kucoin',
        credentials: {
          apiKey: 'old-key',
          apiSecret: 'old-secret',
        },
      }),
      {
        csvDir: './exports/kucoin-archive///',
      },
      createRegistry()
    );

    expect(assertOk(result)).toEqual({
      identifier: 'exports/kucoin-archive',
      resetCursor: true,
    });
  });

  it('requires a complete credential pair after exchange-csv updates', () => {
    const result = buildUpdateAccountInput(
      createAccount({
        accountType: 'exchange-csv',
        platformKey: 'kucoin',
        identifier: 'exports/kucoin',
        credentials: undefined,
      }),
      {
        apiPassphrase: 'passphrase-only',
      },
      createRegistry()
    );

    expect(assertErr(result).message).toBe(
      'Stored exchange credentials require both apiKey and apiSecret after applying the requested changes'
    );
  });

  it('rejects xpub gap updates for non-xpub blockchain accounts', () => {
    const result = buildUpdateAccountInput(
      createAccount({
        accountType: 'blockchain',
        platformKey: 'ethereum',
        identifier: '0xabc',
        credentials: undefined,
      }),
      {
        xpubGap: 25,
      },
      createRegistry({
        getBlockchain: vi.fn().mockReturnValue(ok(createAccountBasedBlockchainAdapter({ normalizedAddress: '0xabc' }))),
      })
    );

    expect(assertErr(result).message).toBe('--xpub-gap can only be updated for extended public keys (xpubs)');
  });

  it('rejects xpub gap decreases once an xpub account is configured', () => {
    const result = buildUpdateAccountInput(
      createAccount({
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'xpub6C...',
        credentials: undefined,
        metadata: {
          xpub: {
            gapLimit: 20,
            lastDerivedAt: 123456789,
            derivedCount: 4,
          },
        },
      }),
      {
        xpubGap: 10,
      },
      createRegistry({
        getBlockchain: vi.fn().mockReturnValue(
          ok(
            createUtxoBlockchainAdapter({
              normalizedAddress: 'xpub6C...',
              isExtendedPublicKey: true,
            })
          )
        ),
      })
    );

    expect(assertErr(result).message).toBe('--xpub-gap cannot be decreased once an xpub account has been configured');
  });

  it('resets xpub materialization state when the configured gap limit changes', () => {
    const result = buildUpdateAccountInput(
      createAccount({
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'xpub6C...',
        credentials: undefined,
        metadata: {
          xpub: {
            gapLimit: 20,
            lastDerivedAt: 123456789,
            derivedCount: 4,
          },
        },
      }),
      {
        xpubGap: 40,
      },
      createRegistry({
        getBlockchain: vi.fn().mockReturnValue(
          ok(
            createUtxoBlockchainAdapter({
              normalizedAddress: 'xpub6C...',
              isExtendedPublicKey: true,
            })
          )
        ),
      })
    );

    expect(assertOk(result)).toEqual({
      metadata: {
        xpub: {
          gapLimit: 40,
          lastDerivedAt: 0,
          derivedCount: 4,
        },
      },
    });
  });
});
