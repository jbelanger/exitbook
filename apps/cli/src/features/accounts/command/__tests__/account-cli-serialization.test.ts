import { describe, expect, it } from 'vitest';

import { serializeAccountForCli } from '../account-cli-serialization.js';

describe('serializeAccountForCli', () => {
  it('masks exchange api identifiers and stringifies timestamps', () => {
    expect(
      serializeAccountForCli({
        id: 7,
        accountFingerprint: 'f'.repeat(64),
        name: 'kraken-main',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'abcdefgh12345678',
        providerName: 'kraken',
        createdAt: new Date('2026-04-01T12:00:00.000Z'),
      })
    ).toEqual({
      id: 7,
      accountFingerprint: 'f'.repeat(64),
      name: 'kraken-main',
      accountType: 'exchange-api',
      platformKey: 'kraken',
      identifier: 'abcdefgh***',
      providerName: 'kraken',
      createdAt: '2026-04-01T12:00:00.000Z',
    });
  });

  it('preserves non-api identifiers while still stringifying timestamps', () => {
    expect(
      serializeAccountForCli({
        id: 8,
        accountFingerprint: 'e'.repeat(64),
        name: 'btc-wallet',
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1qexampleaddress',
        providerName: undefined,
        createdAt: new Date('2026-04-02T12:00:00.000Z'),
      })
    ).toEqual({
      id: 8,
      accountFingerprint: 'e'.repeat(64),
      name: 'btc-wallet',
      accountType: 'blockchain',
      platformKey: 'bitcoin',
      identifier: 'bc1qexampleaddress',
      providerName: undefined,
      createdAt: '2026-04-02T12:00:00.000Z',
    });
  });
});
