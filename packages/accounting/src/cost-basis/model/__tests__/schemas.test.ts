import { describe, expect, it } from 'vitest';

import { CostBasisMethodSupportSchema, JurisdictionConfigSchema, LotStatusSchema } from '../schemas.js';

describe('CostBasisMethodSchema (via CostBasisMethodSupportSchema)', () => {
  const validSupport = { code: 'fifo', label: 'FIFO', description: 'First In First Out', implemented: true };

  it('should accept valid methods', () => {
    for (const method of ['fifo', 'lifo', 'specific-id', 'average-cost']) {
      expect(CostBasisMethodSupportSchema.parse({ ...validSupport, code: method }).code).toBe(method);
    }
  });

  it('should reject invalid methods', () => {
    expect(() => CostBasisMethodSupportSchema.parse({ ...validSupport, code: 'hifo' })).toThrow();
  });
});

describe('FiatCurrencySchema (via JurisdictionConfigSchema)', () => {
  const validConfig = {
    code: 'US',
    label: 'United States',
    defaultCurrency: 'USD',
    costBasisImplemented: true,
    supportedMethods: [{ code: 'fifo', label: 'FIFO', description: 'First In First Out', implemented: true }],
    sameAssetTransferFeePolicy: 'disposal',
    taxAssetIdentityPolicy: 'strict-onchain-tokens',
    relaxedTaxIdentitySymbols: [],
  };

  it('should accept supported currencies', () => {
    for (const currency of ['USD', 'CAD', 'EUR', 'GBP']) {
      expect(JurisdictionConfigSchema.parse({ ...validConfig, defaultCurrency: currency }).defaultCurrency).toBe(
        currency
      );
    }
  });

  it('should reject unsupported currencies', () => {
    expect(() => JurisdictionConfigSchema.parse({ ...validConfig, defaultCurrency: 'JPY' })).toThrow();
  });
});

describe('JurisdictionSchema (via JurisdictionConfigSchema)', () => {
  const validConfig = {
    code: 'US',
    label: 'United States',
    defaultCurrency: 'USD',
    costBasisImplemented: true,
    supportedMethods: [{ code: 'fifo', label: 'FIFO', description: 'First In First Out', implemented: true }],
    sameAssetTransferFeePolicy: 'disposal',
    taxAssetIdentityPolicy: 'strict-onchain-tokens',
    relaxedTaxIdentitySymbols: [],
  };

  it('should accept supported jurisdictions', () => {
    for (const jurisdiction of ['CA', 'US', 'UK', 'EU']) {
      expect(JurisdictionConfigSchema.parse({ ...validConfig, code: jurisdiction }).code).toBe(jurisdiction);
    }
  });

  it('should reject unsupported jurisdictions', () => {
    expect(() => JurisdictionConfigSchema.parse({ ...validConfig, code: 'AU' })).toThrow();
  });
});

describe('LotStatusSchema', () => {
  it('should accept valid statuses', () => {
    expect(LotStatusSchema.parse('open')).toBe('open');
    expect(LotStatusSchema.parse('partially_disposed')).toBe('partially_disposed');
    expect(LotStatusSchema.parse('fully_disposed')).toBe('fully_disposed');
  });

  it('should reject invalid statuses', () => {
    expect(() => LotStatusSchema.parse('closed')).toThrow();
  });
});

describe('JurisdictionConfigSchema', () => {
  it('should validate a well-formed jurisdiction config', () => {
    const config = {
      code: 'US',
      label: 'United States',
      defaultCurrency: 'USD',
      costBasisImplemented: true,
      supportedMethods: [{ code: 'fifo', label: 'FIFO', description: 'First In First Out', implemented: true }],
      sameAssetTransferFeePolicy: 'disposal',
      taxAssetIdentityPolicy: 'strict-onchain-tokens',
      relaxedTaxIdentitySymbols: [],
    };

    const result = JurisdictionConfigSchema.parse(config);
    expect(result.code).toBe('US');
    expect(result.supportedMethods).toHaveLength(1);
  });

  it('should reject config with missing required fields', () => {
    expect(() => JurisdictionConfigSchema.parse({ code: 'US' })).toThrow();
  });
});
