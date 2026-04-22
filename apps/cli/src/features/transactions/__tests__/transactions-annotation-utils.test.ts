import type { Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
import { describe, expect, it } from 'vitest';

import { createPersistedTransaction } from '../../shared/__tests__/transaction-test-utils.js';
import {
  buildAnnotationsByTransactionId,
  filterTransactionsByInterpretationFilters,
  filterTransactionViewItemsByInterpretationFilters,
  filterTransactionsByAnnotationFilters,
  filterTransactionViewItemsByAnnotationFilters,
  matchesTransactionOperationFilter,
  matchesTransactionAnnotationFilters,
} from '../transactions-annotation-utils.js';

function createAnnotation(
  overrides: Partial<TransactionAnnotation> & Pick<TransactionAnnotation, 'kind' | 'tier' | 'transactionId'>
): TransactionAnnotation {
  return {
    annotationFingerprint: `annotation-${overrides.transactionId}-${overrides.kind}-${overrides.tier}`,
    accountId: 1,
    transactionId: overrides.transactionId,
    txFingerprint: `tx-${overrides.transactionId}`,
    kind: overrides.kind,
    tier: overrides.tier,
    target: { scope: 'transaction' },
    detectorId: 'detector',
    derivedFromTxIds: [overrides.transactionId],
    provenanceInputs: ['processor'],
    ...(overrides.role === undefined ? {} : { role: overrides.role }),
    ...(overrides.protocolRef === undefined ? {} : { protocolRef: overrides.protocolRef }),
    ...(overrides.groupKey === undefined ? {} : { groupKey: overrides.groupKey }),
    ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata }),
  };
}

function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const datetime = overrides.datetime ?? '2026-03-01T12:00:00.000Z';

  return createPersistedTransaction({
    id: overrides.id ?? 1,
    accountId: overrides.accountId ?? 1,
    txFingerprint: overrides.txFingerprint ?? `tx-${overrides.id ?? 1}`,
    platformKey: overrides.platformKey ?? 'kraken',
    platformKind: overrides.platformKind ?? 'exchange',
    datetime,
    timestamp: overrides.timestamp ?? Date.parse(datetime),
    status: overrides.status ?? 'success',
    operation: overrides.operation ?? {
      category: 'trade',
      type: 'buy',
    },
    movements: overrides.movements ?? {
      inflows: [
        {
          assetId: 'asset:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
        },
      ],
      outflows: [],
    },
    fees: overrides.fees ?? [],
    from: overrides.from,
    to: overrides.to,
    blockchain: overrides.blockchain,
    diagnostics: overrides.diagnostics,
    userNotes: overrides.userNotes,
    excludedFromAccounting: overrides.excludedFromAccounting ?? false,
  });
}

describe('transactions-annotation-utils', () => {
  it('builds transaction annotation groups by transaction id', () => {
    const annotations = [
      createAnnotation({ transactionId: 1, kind: 'bridge_participant', tier: 'asserted' }),
      createAnnotation({ transactionId: 1, kind: 'bridge_participant', tier: 'heuristic' }),
      createAnnotation({ transactionId: 2, kind: 'wrap', tier: 'asserted' }),
    ];

    const grouped = buildAnnotationsByTransactionId(annotations);

    expect(grouped.get(1)).toHaveLength(2);
    expect(grouped.get(2)).toHaveLength(1);
  });

  it('matches kind and tier against the same annotation row', () => {
    const annotations = [
      createAnnotation({ transactionId: 1, kind: 'bridge_participant', tier: 'heuristic' }),
      createAnnotation({ transactionId: 1, kind: 'wrap', tier: 'asserted' }),
    ];

    expect(
      matchesTransactionAnnotationFilters(annotations, {
        annotationKind: 'bridge_participant',
        annotationTier: 'heuristic',
      })
    ).toBe(true);

    expect(
      matchesTransactionAnnotationFilters(annotations, {
        annotationKind: 'bridge_participant',
        annotationTier: 'asserted',
      })
    ).toBe(false);
  });

  it('filters raw transactions by annotation kind and tier', () => {
    const annotations = buildAnnotationsByTransactionId([
      createAnnotation({ transactionId: 1, kind: 'bridge_participant', tier: 'asserted' }),
      createAnnotation({ transactionId: 2, kind: 'asset_migration_participant', tier: 'heuristic' }),
    ]);

    const filtered = filterTransactionsByAnnotationFilters([{ id: 1 }, { id: 2 }, { id: 3 }], annotations, {
      annotationKind: 'asset_migration_participant',
      annotationTier: 'heuristic',
    });

    expect(filtered).toEqual([{ id: 2 }]);
  });

  it('filters view items by annotation filters using attached annotations', () => {
    const filtered = filterTransactionViewItemsByAnnotationFilters(
      [
        {
          id: 1,
          operationGroup: 'trade',
          operationLabel: 'trade/buy',
          annotations: [createAnnotation({ transactionId: 1, kind: 'bridge_participant', tier: 'asserted' })],
        },
        {
          id: 2,
          operationGroup: 'transfer',
          operationLabel: 'wrap',
          annotations: [createAnnotation({ transactionId: 2, kind: 'wrap', tier: 'asserted' })],
        },
      ],
      { annotationKind: 'wrap' }
    );

    expect(filtered.map((item) => item.id)).toEqual([2]);
  });

  it('matches derived operation groups from fallback operation data', () => {
    expect(
      matchesTransactionOperationFilter(
        createTransaction({
          operation: { category: 'trade', type: 'buy' },
        }),
        [],
        'trade'
      )
    ).toBe(true);
    expect(
      matchesTransactionOperationFilter(
        createTransaction({
          operation: { category: 'trade', type: 'buy' },
        }),
        [],
        'withdrawal'
      )
    ).toBe(false);
  });

  it('matches exact interpreted labels from annotations', () => {
    const transaction = createTransaction({
      id: 10,
      operation: { category: 'transfer', type: 'withdrawal' },
    });
    const annotations = [createAnnotation({ transactionId: 10, kind: 'bridge_participant', tier: 'asserted' })];

    expect(matchesTransactionOperationFilter(transaction, annotations, 'bridge/send')).toBe(true);
    expect(matchesTransactionOperationFilter(transaction, annotations, 'bridge/receive')).toBe(false);
  });

  it('filters raw transactions by interpreted operation filters', () => {
    const first = createTransaction({ id: 1, operation: { category: 'trade', type: 'buy' } });
    const second = createTransaction({ id: 2, operation: { category: 'transfer', type: 'withdrawal' } });
    const annotations = buildAnnotationsByTransactionId([
      createAnnotation({
        transactionId: 2,
        kind: 'bridge_participant',
        tier: 'asserted',
        role: 'source',
      }),
    ]);

    const filtered = filterTransactionsByInterpretationFilters([first, second], annotations, {
      operationFilter: 'bridge/send',
    });

    expect(filtered.map((item) => item.id)).toEqual([2]);
  });

  it('filters view items by interpreted operation filters', () => {
    const filtered = filterTransactionViewItemsByInterpretationFilters(
      [
        {
          id: 1,
          operationGroup: 'trade',
          operationLabel: 'trade/buy',
          annotations: [],
        },
        {
          id: 2,
          operationGroup: 'transfer',
          operationLabel: 'bridge/send',
          annotations: [createAnnotation({ transactionId: 2, kind: 'bridge_participant', tier: 'asserted' })],
        },
      ],
      { operationFilter: 'send' }
    );

    expect(filtered.map((item) => item.id)).toEqual([2]);
  });
});
