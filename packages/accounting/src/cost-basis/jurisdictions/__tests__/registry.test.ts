import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { resolveCostBasisJurisdictionRules } from '../registry.js';

describe('cost-basis jurisdiction registry', () => {
  it('returns Canada rules for CA', () => {
    expect(assertOk(resolveCostBasisJurisdictionRules('CA')).constructor.name).toBe('CanadaRules');
  });

  it('returns US rules for US', () => {
    expect(assertOk(resolveCostBasisJurisdictionRules('US')).constructor.name).toBe('USRules');
  });

  it('returns an error for UK', () => {
    expect(assertErr(resolveCostBasisJurisdictionRules('UK')).message).toContain(
      'UK jurisdiction rules not yet implemented'
    );
  });

  it('returns an error for EU', () => {
    expect(assertErr(resolveCostBasisJurisdictionRules('EU')).message).toContain(
      'EU jurisdiction rules not yet implemented'
    );
  });
});
