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
});
