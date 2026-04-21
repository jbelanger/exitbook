import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { computeAnnotationFingerprint } from '../annotation-fingerprint.js';

describe('computeAnnotationFingerprint', () => {
  it('distinguishes transaction-scoped annotations across different transactions', () => {
    const left = assertOk(
      computeAnnotationFingerprint({
        kind: 'bridge_participant',
        tier: 'asserted',
        txFingerprint: 'tx-left',
        target: { scope: 'transaction' },
        protocolRef: { id: 'wormhole' },
        role: 'source',
      })
    );
    const right = assertOk(
      computeAnnotationFingerprint({
        kind: 'bridge_participant',
        tier: 'asserted',
        txFingerprint: 'tx-right',
        target: { scope: 'transaction' },
        protocolRef: { id: 'wormhole' },
        role: 'source',
      })
    );

    expect(left).not.toBe(right);
  });

  it('canonicalizes metadata key order before hashing', () => {
    const left = assertOk(
      computeAnnotationFingerprint({
        kind: 'bridge_participant',
        tier: 'heuristic',
        txFingerprint: 'tx-same',
        target: { scope: 'transaction' },
        metadata: {
          amountSimilarity: '0.99',
          timingHours: '1.0',
        },
      })
    );
    const right = assertOk(
      computeAnnotationFingerprint({
        kind: 'bridge_participant',
        tier: 'heuristic',
        txFingerprint: 'tx-same',
        target: { scope: 'transaction' },
        metadata: {
          timingHours: '1.0',
          amountSimilarity: '0.99',
        },
      })
    );

    expect(left).toBe(right);
  });
});
