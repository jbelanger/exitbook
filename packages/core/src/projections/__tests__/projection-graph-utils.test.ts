import { describe, expect, it } from 'vitest';

import { cascadeInvalidation, rebuildPlan, resetPlan } from '../projection-graph-utils.js';

describe('cascadeInvalidation', () => {
  it('returns downstream dependents of processed-transactions', () => {
    expect(cascadeInvalidation('processed-transactions')).toEqual(['links']);
  });

  it('returns empty for links (no downstream)', () => {
    expect(cascadeInvalidation('links')).toEqual([]);
  });
});

describe('rebuildPlan', () => {
  it('returns upstream dependencies for links', () => {
    expect(rebuildPlan('links')).toEqual(['processed-transactions']);
  });

  it('returns empty for processed-transactions (no upstream)', () => {
    expect(rebuildPlan('processed-transactions')).toEqual([]);
  });
});

describe('resetPlan', () => {
  it('returns downstream-first then target for processed-transactions', () => {
    expect(resetPlan('processed-transactions')).toEqual(['links', 'processed-transactions']);
  });

  it('returns just the target for links (no downstream)', () => {
    expect(resetPlan('links')).toEqual(['links']);
  });
});
