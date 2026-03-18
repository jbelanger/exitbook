import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildCanadaTaxPropertyKey } from '../canada-tax-identity-utils.js';

describe('buildCanadaTaxPropertyKey', () => {
  it('should prefix identity key with ca:', () => {
    const result = assertOk(buildCanadaTaxPropertyKey('btc'));
    expect(result).toBe('ca:btc');
  });

  it('should handle complex asset identity keys', () => {
    const result = assertOk(buildCanadaTaxPropertyKey('blockchain:ethereum:0xabcdef'));
    expect(result).toBe('ca:blockchain:ethereum:0xabcdef');
  });

  it('should trim whitespace from the identity key', () => {
    const result = assertOk(buildCanadaTaxPropertyKey('  btc  '));
    expect(result).toBe('ca:btc');
  });

  it('should return error for empty string', () => {
    const result = assertErr(buildCanadaTaxPropertyKey(''));
    expect(result.message).toContain('non-empty');
  });

  it('should return error for whitespace-only string', () => {
    const result = assertErr(buildCanadaTaxPropertyKey('   '));
    expect(result.message).toContain('non-empty');
  });
});
