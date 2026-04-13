import { describe, expect, it } from 'vitest';

import { JurisdictionConfigSchema } from '../../../model/schemas.js';
import { US_COST_BASIS_METHODS, US_JURISDICTION_CONFIG } from '../config.js';

describe('US_JURISDICTION_CONFIG', () => {
  it('validates against JurisdictionConfigSchema', () => {
    const result = JurisdictionConfigSchema.safeParse(US_JURISDICTION_CONFIG);
    expect(result.success).toBe(true);
  });

  it('has jurisdiction code US', () => {
    expect(US_JURISDICTION_CONFIG.code).toBe('US');
  });

  it('has default currency USD', () => {
    expect(US_JURISDICTION_CONFIG.defaultCurrency).toBe('USD');
  });

  it('has sameAssetTransferFeePolicy set to disposal', () => {
    expect(US_JURISDICTION_CONFIG.sameAssetTransferFeePolicy).toBe('disposal');
  });
});

describe('US_COST_BASIS_METHODS', () => {
  it('includes fifo as implemented', () => {
    const fifo = US_COST_BASIS_METHODS.find((m) => m.code === 'fifo');
    expect(fifo).toBeDefined();
    expect(fifo?.implemented).toBe(true);
  });

  it('includes lifo as implemented', () => {
    const lifo = US_COST_BASIS_METHODS.find((m) => m.code === 'lifo');
    expect(lifo).toBeDefined();
    expect(lifo?.implemented).toBe(true);
  });

  it('includes specific-id as not implemented', () => {
    const specificId = US_COST_BASIS_METHODS.find((m) => m.code === 'specific-id');
    expect(specificId).toBeDefined();
    expect(specificId?.implemented).toBe(false);
  });
});
