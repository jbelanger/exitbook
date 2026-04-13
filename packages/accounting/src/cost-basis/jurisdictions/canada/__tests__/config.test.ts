import { describe, expect, it } from 'vitest';

import { JurisdictionConfigSchema } from '../../../model/schemas.js';
import { CANADA_JURISDICTION_CONFIG } from '../config.js';

describe('CANADA_JURISDICTION_CONFIG', () => {
  it('validates against JurisdictionConfigSchema', () => {
    const result = JurisdictionConfigSchema.safeParse(CANADA_JURISDICTION_CONFIG);
    expect(result.success).toBe(true);
  });

  it('has jurisdiction code CA', () => {
    expect(CANADA_JURISDICTION_CONFIG.code).toBe('CA');
  });

  it('has default currency CAD', () => {
    expect(CANADA_JURISDICTION_CONFIG.defaultCurrency).toBe('CAD');
  });

  it('supports average-cost method and it is implemented', () => {
    const averageCost = CANADA_JURISDICTION_CONFIG.supportedMethods.find((m) => m.code === 'average-cost');
    expect(averageCost).toBeDefined();
    expect(averageCost?.implemented).toBe(true);
  });

  it('has sameAssetTransferFeePolicy set to add-to-basis', () => {
    expect(CANADA_JURISDICTION_CONFIG.sameAssetTransferFeePolicy).toBe('add-to-basis');
  });
});
