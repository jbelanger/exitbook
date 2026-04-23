import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { computeSourceComponentFingerprint } from '../source-component-fingerprint.js';
import type { SourceComponentRef } from '../source-component-ref.js';

describe('computeSourceComponentFingerprint', () => {
  it('uses source activity, kind, component id, occurrence, and asset id only', () => {
    const firstRef: SourceComponentRef = {
      sourceActivityFingerprint: 'activity:1',
      componentKind: 'exchange_fill',
      componentId: 'fill:1',
      occurrence: 2,
      assetId: 'exchange:kraken:eth',
    };
    const secondRef: SourceComponentRef = {
      assetId: 'exchange:kraken:eth',
      componentId: 'fill:1',
      componentKind: 'exchange_fill',
      occurrence: 2,
      sourceActivityFingerprint: 'activity:1',
    };

    expect(assertOk(computeSourceComponentFingerprint(firstRef))).toBe(
      assertOk(computeSourceComponentFingerprint(secondRef))
    );
  });
});
