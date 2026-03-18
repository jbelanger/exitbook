import { describe, expect, it } from 'vitest';

import {
  CostBasisMethodSchema,
  FiatCurrencySchema,
  JurisdictionConfigSchema,
  JurisdictionSchema,
  LotStatusSchema,
} from '../schemas.js';

describe('CostBasisMethodSchema', () => {
  it('should accept valid methods', () => {
    expect(CostBasisMethodSchema.parse('fifo')).toBe('fifo');
    expect(CostBasisMethodSchema.parse('lifo')).toBe('lifo');
    expect(CostBasisMethodSchema.parse('specific-id')).toBe('specific-id');
    expect(CostBasisMethodSchema.parse('average-cost')).toBe('average-cost');
  });

  it('should reject invalid methods', () => {
    expect(() => CostBasisMethodSchema.parse('hifo')).toThrow();
  });
});

describe('FiatCurrencySchema', () => {
  it('should accept supported currencies', () => {
    expect(FiatCurrencySchema.parse('USD')).toBe('USD');
    expect(FiatCurrencySchema.parse('CAD')).toBe('CAD');
    expect(FiatCurrencySchema.parse('EUR')).toBe('EUR');
    expect(FiatCurrencySchema.parse('GBP')).toBe('GBP');
  });

  it('should reject unsupported currencies', () => {
    expect(() => FiatCurrencySchema.parse('JPY')).toThrow();
  });
});

describe('JurisdictionSchema', () => {
  it('should accept supported jurisdictions', () => {
    expect(JurisdictionSchema.parse('CA')).toBe('CA');
    expect(JurisdictionSchema.parse('US')).toBe('US');
    expect(JurisdictionSchema.parse('UK')).toBe('UK');
    expect(JurisdictionSchema.parse('EU')).toBe('EU');
  });

  it('should reject unsupported jurisdictions', () => {
    expect(() => JurisdictionSchema.parse('AU')).toThrow();
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
