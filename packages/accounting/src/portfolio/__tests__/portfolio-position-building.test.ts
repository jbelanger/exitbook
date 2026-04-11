import { describe, expect, it } from 'vitest';

import { buildTransaction, createFeeMovement } from '../../__tests__/test-utils.js';
import { buildAccountAssetBalances } from '../portfolio-position-building.js';

describe('buildAccountAssetBalances', () => {
  it('uses shared balance impact semantics for embedded and separate fees', () => {
    const transactions = [
      buildTransaction({
        id: 1,
        accountId: 7,
        datetime: '2025-01-01T00:00:00.000Z',
        platformKey: 'kraken',
        category: 'transfer',
        type: 'withdrawal',
        outflows: [{ assetId: 'asset:btc', assetSymbol: 'BTC', amount: '1' }],
        fees: [createFeeMovement('network', 'on-chain', 'BTC', '0.001', undefined, 'USD', 'asset:btc')],
      }),
      buildTransaction({
        id: 2,
        accountId: 7,
        datetime: '2025-01-02T00:00:00.000Z',
        platformKey: 'kraken',
        category: 'transfer',
        type: 'deposit',
        inflows: [{ assetId: 'asset:btc', assetSymbol: 'BTC', amount: '0.25' }],
      }),
      buildTransaction({
        id: 3,
        accountId: 7,
        datetime: '2025-01-03T00:00:00.000Z',
        platformKey: 'kraken',
        category: 'trade',
        type: 'sell',
        outflows: [{ assetId: 'asset:usdt', assetSymbol: 'USDT', amount: '100' }],
        fees: [createFeeMovement('platform', 'balance', 'BTC', '0.01', undefined, 'USD', 'asset:btc')],
      }),
    ];

    const breakdown = buildAccountAssetBalances(
      transactions,
      new Map([[7, { accountType: 'exchange-api', platformKey: 'kraken' }]])
    );

    expect(breakdown.get('asset:btc')).toEqual([
      {
        accountId: 7,
        platformKey: 'kraken',
        accountType: 'exchange-api',
        quantity: '-0.76000000',
      },
    ]);
    expect(breakdown.get('asset:usdt')).toEqual([
      {
        accountId: 7,
        platformKey: 'kraken',
        accountType: 'exchange-api',
        quantity: '-100.00000000',
      },
    ]);
  });
});
