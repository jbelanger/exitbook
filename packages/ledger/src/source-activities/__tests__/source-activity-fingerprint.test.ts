import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  computeSourceActivityFingerprint,
  type SourceActivityFingerprintInput,
} from '../source-activity-fingerprint.js';

describe('computeSourceActivityFingerprint', () => {
  it('is deterministic for blockchain source activity identity', () => {
    const input: SourceActivityFingerprintInput = {
      accountFingerprint: 'account:1',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      blockchainTransactionHash: 'tx-hash-1',
    };

    expect(assertOk(computeSourceActivityFingerprint(input))).toBe(assertOk(computeSourceActivityFingerprint(input)));
  });

  it('sorts exchange component event ids before hashing', () => {
    const first = assertOk(
      computeSourceActivityFingerprint({
        accountFingerprint: 'account:1',
        platformKey: 'kraken',
        platformKind: 'exchange',
        componentEventIds: ['b', 'a'],
      })
    );
    const second = assertOk(
      computeSourceActivityFingerprint({
        accountFingerprint: 'account:1',
        platformKey: 'kraken',
        platformKind: 'exchange',
        componentEventIds: ['a', 'b'],
      })
    );

    expect(first).toBe(second);
  });
});
