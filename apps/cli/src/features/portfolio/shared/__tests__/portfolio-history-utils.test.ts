import type { PriceAtTxTime, Transaction, TransactionDraft } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
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

function createAnnotation(
  overrides: Partial<TransactionAnnotation> & Pick<TransactionAnnotation, 'kind' | 'tier'>
): TransactionAnnotation {
  return {
    annotationFingerprint: 'annotation:test',
    accountId: 1,
    transactionId: 1,
    txFingerprint: 'portfolio-history-test-1',
    kind: overrides.kind,
    tier: overrides.tier,
    target: overrides.target ?? { scope: 'transaction' },
    detectorId: 'detector',
    derivedFromTxIds: [1],
    provenanceInputs: ['diagnostic'],
    ...(overrides.role === undefined ? {} : { role: overrides.role }),
    ...(overrides.groupKey === undefined ? {} : { groupKey: overrides.groupKey }),
    ...(overrides.protocolRef === undefined ? {} : { protocolRef: overrides.protocolRef }),
    ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata }),
  };
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
      operationGroup: 'transfer',
      operationLabel: 'transfer/withdrawal',
      transferDirection: 'to',
      transferPeer: 'wallet-b',
    });
  });

  it('prefers persisted interpretation labels over stored operation strings', () => {
    const transaction = createTransaction({
      id: 1,
      datetime: '2025-01-01T00:00:00.000Z',
      outflows: [
        {
          assetId: 'asset:sol',
          assetSymbol: 'SOL' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
          priceAtTxTime: createPriceAtTxTime('100', '2025-01-01T00:00:00.000Z'),
        },
      ],
    });

    const items = buildTransactionItems([transaction], 'asset:sol', [
      createAnnotation({ kind: 'bridge_participant', tier: 'asserted', role: 'source' }),
    ]);

    expect(items[0]).toMatchObject({
      operationGroup: 'transfer',
      operationLabel: 'bridge/send',
      transferDirection: 'to',
    });
  });
});
