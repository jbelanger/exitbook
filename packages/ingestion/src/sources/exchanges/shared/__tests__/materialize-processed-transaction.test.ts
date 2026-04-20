import type { Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { materializeProcessedTransaction } from '../materialize-processed-transaction.js';

const BTC = 'BTC' as Currency;
const USD = 'USD' as Currency;

describe('materializeProcessedTransaction', () => {
  it('preserves exchange identity material as sorted componentEventIds', () => {
    const transaction = materializeProcessedTransaction({
      source: 'kraken',
      timestamp: 1_700_000_000_000,
      status: 'success',
      operation: {
        category: 'trade',
        type: 'swap',
      },
      movements: {
        inflows: [{ assetId: 'exchange:kraken:btc', assetSymbol: BTC, grossAmount: '1.0' }],
        outflows: [{ assetId: 'fiat:usd', assetSymbol: USD, grossAmount: '40000' }],
      },
      fees: [],
      evidence: {
        interpretationRule: 'kraken:swap',
        providerEventIds: [' evt-b ', 'evt-a', 'evt-b'],
      },
    });

    expect(transaction.identityMaterial?.componentEventIds).toEqual(['evt-a', 'evt-b', 'evt-b']);
  });

  it('preserves optional movement roles on exchange asset movements', () => {
    const transaction = materializeProcessedTransaction({
      source: 'kraken',
      timestamp: 1_700_000_000_000,
      status: 'success',
      operation: {
        category: 'trade',
        type: 'buy',
      },
      movements: {
        inflows: [
          {
            assetId: 'exchange:kraken:fet',
            assetSymbol: 'FET' as Currency,
            grossAmount: '0.00000488',
            movementRole: 'refund_rebate',
          },
        ],
        outflows: [],
      },
      fees: [],
      evidence: {
        interpretationRule: 'kraken:buy',
        providerEventIds: ['evt-a'],
      },
    });

    expect(transaction.movements.inflows?.[0]?.movementRole).toBe('refund_rebate');
  });
});
