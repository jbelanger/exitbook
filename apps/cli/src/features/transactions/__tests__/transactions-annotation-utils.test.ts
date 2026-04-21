import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
import { describe, expect, it } from 'vitest';

import {
  buildAnnotationsByTransactionId,
  filterTransactionsByAnnotationFilters,
  filterTransactionViewItemsByAnnotationFilters,
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
          annotations: [createAnnotation({ transactionId: 1, kind: 'bridge_participant', tier: 'asserted' })],
        },
        {
          id: 2,
          annotations: [createAnnotation({ transactionId: 2, kind: 'wrap', tier: 'asserted' })],
        },
      ],
      { annotationKind: 'wrap' }
    );

    expect(filtered.map((item) => item.id)).toEqual([2]);
  });
});
