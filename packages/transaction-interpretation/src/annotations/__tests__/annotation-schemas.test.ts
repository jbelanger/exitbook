import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { computeAnnotationFingerprint } from '../annotation-fingerprint.js';
import { TransactionAnnotationSchema } from '../annotation-schemas.js';

function buildCandidate(derivedFromTxIds: readonly number[] = [101]): unknown {
  const txFingerprint = 'tx-schema-test';
  const annotationFingerprint = assertOk(
    computeAnnotationFingerprint({
      kind: 'bridge_participant',
      tier: 'asserted',
      txFingerprint,
      target: { scope: 'transaction' },
      protocolRef: { id: 'wormhole' },
      role: 'source',
    })
  );

  return {
    annotationFingerprint,
    accountId: 10,
    transactionId: 101,
    txFingerprint,
    kind: 'bridge_participant',
    tier: 'asserted',
    target: { scope: 'transaction' },
    protocolRef: { id: 'wormhole' },
    role: 'source',
    detectorId: 'bridge.detector',
    derivedFromTxIds,
    provenanceInputs: ['processor'],
  };
}

describe('TransactionAnnotationSchema', () => {
  it('accepts a non-empty derivedFromTxIds set', () => {
    const result = TransactionAnnotationSchema.safeParse(buildCandidate([101]));

    expect(result.success).toBe(true);
  });

  it('rejects empty derivedFromTxIds', () => {
    const result = TransactionAnnotationSchema.safeParse(buildCandidate([]));

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'derivedFromTxIds')).toBe(true);
  });
});
