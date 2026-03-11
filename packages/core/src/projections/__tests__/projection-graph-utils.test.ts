import { describe, expect, it } from 'vitest';

import { cascadeInvalidation, rebuildPlan, resetPlan } from '../projection-graph-utils.js';

describe('cascadeInvalidation', () => {
  it('returns downstream dependents of processed-transactions', () => {
    expect(cascadeInvalidation('processed-transactions')).toEqual(['asset-review', 'links']);
  });

  it('returns empty for links (no downstream)', () => {
    expect(cascadeInvalidation('links')).toEqual([]);
  });

  it('returns empty for asset-review (no downstream)', () => {
    expect(cascadeInvalidation('asset-review')).toEqual([]);
  });
});

describe('rebuildPlan', () => {
  it('returns upstream dependencies for links', () => {
    expect(rebuildPlan('links')).toEqual(['processed-transactions']);
  });

  it('returns upstream dependencies for asset-review', () => {
    expect(rebuildPlan('asset-review')).toEqual(['processed-transactions']);
  });

  it('returns empty for processed-transactions (no upstream)', () => {
    expect(rebuildPlan('processed-transactions')).toEqual([]);
  });
});

describe('resetPlan', () => {
  it('returns downstream-first then target for processed-transactions', () => {
    expect(resetPlan('processed-transactions')).toEqual(['links', 'asset-review', 'processed-transactions']);
  });

  it('returns just the target for links (no downstream)', () => {
    expect(resetPlan('links')).toEqual(['links']);
  });

  it('returns just the target for asset-review (no downstream)', () => {
    expect(resetPlan('asset-review')).toEqual(['asset-review']);
  });
});
