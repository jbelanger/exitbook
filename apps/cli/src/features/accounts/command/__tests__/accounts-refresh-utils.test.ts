import { describe, expect, it } from 'vitest';

import {
  resolveAccountRefreshCredentials,
  sortAccountsByRefreshPriority,
  sortAssetComparisonsByStatus,
} from '../accounts-refresh-utils.js';

describe('accounts-refresh-utils', () => {
  it('sorts refresh targets by account type and account id', () => {
    const sorted = sortAccountsByRefreshPriority([
      { accountId: 9, accountType: 'exchange-csv' },
      { accountId: 2, accountType: 'exchange-api' },
      { accountId: 8, accountType: 'blockchain' },
      { accountId: 3, accountType: 'exchange-api' },
      { accountId: 1, accountType: 'blockchain' },
    ]);

    expect(sorted).toEqual([
      { accountId: 1, accountType: 'blockchain' },
      { accountId: 8, accountType: 'blockchain' },
      { accountId: 2, accountType: 'exchange-api' },
      { accountId: 3, accountType: 'exchange-api' },
      { accountId: 9, accountType: 'exchange-csv' },
    ]);
  });

  it('sorts asset comparisons by status severity and symbol', () => {
    const sorted = sortAssetComparisonsByStatus([
      { assetSymbol: 'SOL', status: 'match' },
      { assetSymbol: 'BTC', status: 'warning' },
      { assetSymbol: 'ETH', status: 'mismatch' },
      { assetSymbol: 'ADA', status: 'warning' },
    ] as never);

    expect(sorted).toEqual([
      { assetSymbol: 'ETH', status: 'mismatch' },
      { assetSymbol: 'ADA', status: 'warning' },
      { assetSymbol: 'BTC', status: 'warning' },
      { assetSymbol: 'SOL', status: 'match' },
    ]);
  });

  it('returns stored provider credentials for exchange accounts and a skip reason otherwise', () => {
    expect(
      resolveAccountRefreshCredentials({
        accountType: 'blockchain',
      } as never)
    ).toEqual({});

    expect(
      resolveAccountRefreshCredentials({
        accountType: 'exchange-api',
        credentials: {
          apiKey: 'key',
          apiSecret: 'secret',
        },
      } as never)
    ).toEqual({
      credentials: {
        apiKey: 'key',
        apiSecret: 'secret',
      },
    });

    expect(
      resolveAccountRefreshCredentials({
        accountType: 'exchange-csv',
        credentials: undefined,
      } as never)
    ).toEqual({
      skipReason: 'no stored provider credentials',
    });
  });
});
