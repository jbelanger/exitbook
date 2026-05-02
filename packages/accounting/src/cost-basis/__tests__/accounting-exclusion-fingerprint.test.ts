import { describe, expect, it } from 'vitest';

import { buildAccountingExclusionFingerprint } from '../accounting-exclusion-fingerprint.js';

describe('buildAccountingExclusionFingerprint', () => {
  it('returns a stable empty exclusion fingerprint', () => {
    expect(buildAccountingExclusionFingerprint({ excludedAssetIds: [] })).toBe('accounting-exclusions:none');
  });

  it('is insensitive to ordering and duplicate exclusion inputs', () => {
    const left = buildAccountingExclusionFingerprint({
      excludedAssetIds: ['asset:b', 'asset:a', 'asset:a'],
      excludedPostingFingerprints: ['posting:2', 'posting:1', 'posting:1'],
    });
    const right = buildAccountingExclusionFingerprint({
      excludedAssetIds: ['asset:a', 'asset:b'],
      excludedPostingFingerprints: ['posting:1', 'posting:2'],
    });

    expect(left).toBe(right);
  });

  it('changes when excluded posting membership changes under the same excluded assets', () => {
    const first = buildAccountingExclusionFingerprint({
      excludedAssetIds: ['asset:spam'],
      excludedPostingFingerprints: ['posting:spam:1'],
    });
    const second = buildAccountingExclusionFingerprint({
      excludedAssetIds: ['asset:spam'],
      excludedPostingFingerprints: ['posting:spam:2'],
    });

    expect(first).not.toBe(second);
  });
});
