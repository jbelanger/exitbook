import type { PriceAtTxTime, Transaction, TransactionDraft } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import { buildTransactionItems } from '../portfolio-history-utils.js';

function createPriceAtTxTime(amount: string, datetime: string): PriceAtTxTime {
  return {
    price: {
      amount: parseDecimal(amount),
      currency: 'USD' as Currency,
    },
    source: 'test',
    fetchedAt: new Date(datetime),
    granularity: 'exact',
  };
}

function createTransaction(params: {
  datetime: string;
  fees?: TransactionDraft['fees'] | undefined;
  id: number;
  inflows?: TransactionDraft['movements']['inflows'] | undefined;
  outflows?: TransactionDraft['movements']['outflows'] | undefined;
}): Transaction {
  return createPersistedTransaction({
    id: params.id,
    accountId: 1,
    txFingerprint: `portfolio-history-test-${params.id}`,
    datetime: params.datetime,
    timestamp: Date.parse(params.datetime),
    platformKey: 'solana',
    platformKind: 'blockchain',
    status: 'success',
    operation: { category: 'transfer', type: 'withdrawal' },
    movements: {
      inflows: params.inflows,
      outflows: params.outflows,
    },
    fees: params.fees,
    from: 'wallet-a',
    to: 'wallet-b',
    diagnostics: [],
    userNotes: [],
  });
}

describe('buildTransactionItems', () => {
  it('does not double count on-chain fees for asset amount or fiat value', () => {
    const items = buildTransactionItems(
      [
        createTransaction({
          id: 1,
          datetime: '2025-01-01T00:00:00.000Z',
          outflows: [
            {
              assetId: 'asset:sol',
              assetSymbol: 'SOL' as Currency,
              grossAmount: parseDecimal('1'),
              netAmount: parseDecimal('0.999'),
              priceAtTxTime: createPriceAtTxTime('100', '2025-01-01T00:00:00.000Z'),
            },
          ],
          fees: [
            {
              assetId: 'asset:sol',
              assetSymbol: 'SOL' as Currency,
              amount: parseDecimal('0.001'),
              scope: 'network',
              settlement: 'on-chain',
              priceAtTxTime: createPriceAtTxTime('200', '2025-01-01T00:00:00.000Z'),
            },
          ],
        }),
      ],
      'asset:sol'
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      assetAmount: '1.00000000',
      assetDirection: 'out',
      fiatValue: '100.00',
      transferDirection: 'to',
      transferPeer: 'wallet-b',
    });
  });
});
