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
      sourceActivityOrigin: 'provider_event',
      sourceActivityStableKey: 'tx-hash-1',
    };

    expect(assertOk(computeSourceActivityFingerprint(input))).toBe(assertOk(computeSourceActivityFingerprint(input)));
  });

  it('uses the stable key as generic source activity identity', () => {
    const first = assertOk(
      computeSourceActivityFingerprint({
        accountFingerprint: 'account:1',
        platformKey: 'kraken',
        platformKind: 'exchange',
        sourceActivityOrigin: 'provider_event',
        sourceActivityStableKey: 'exchange-events:a:b',
      })
    );
    const second = assertOk(
      computeSourceActivityFingerprint({
        accountFingerprint: 'account:1',
        platformKey: 'kraken',
        platformKind: 'exchange',
        sourceActivityOrigin: 'provider_event',
        sourceActivityStableKey: 'exchange-events:a:b',
      })
    );

    expect(first).toBe(second);
  });
});
