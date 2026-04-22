import { describe, expect, it } from 'vitest';

import type { TransactionAnnotation } from '../annotation-types.js';
import { groupTransactionAnnotationsByTransactionId } from '../transaction-annotation-groups.js';

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

describe('groupTransactionAnnotationsByTransactionId', () => {
  it('groups annotations by transaction id', () => {
    const grouped = groupTransactionAnnotationsByTransactionId([
      createAnnotation({ transactionId: 1, kind: 'bridge_participant', tier: 'asserted' }),
      createAnnotation({ transactionId: 1, kind: 'bridge_participant', tier: 'heuristic' }),
      createAnnotation({ transactionId: 2, kind: 'wrap', tier: 'asserted' }),
    ]);

    expect(grouped.get(1)).toHaveLength(2);
    expect(grouped.get(2)).toHaveLength(1);
  });

  it('returns an empty map when annotations are omitted', () => {
    expect(groupTransactionAnnotationsByTransactionId(undefined).size).toBe(0);
  });
});
