import { describe, expect, it } from 'vitest';

import { AcquisitionLotSchema, CostBasisMethodSupportSchema, JurisdictionConfigSchema } from '../schemas.js';

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

describe('LotStatusSchema (via AcquisitionLotSchema)', () => {
  const validLot = {
    id: '00000000-0000-4000-a000-000000000001',
    calculationId: '00000000-0000-4000-a000-000000000002',
    acquisitionTransactionId: 1,
    assetId: 'test:btc',
    assetSymbol: 'BTC',
    quantity: '1.0',
    costBasisPerUnit: '50000',
    totalCostBasis: '50000',
    acquisitionDate: '2024-01-15',
    method: 'fifo',
    remainingQuantity: '1.0',
    status: 'open',
    createdAt: '2024-01-15',
    updatedAt: '2024-01-15',
  };

  it('should accept valid statuses', () => {
    for (const status of ['open', 'partially_disposed', 'fully_disposed']) {
      expect(AcquisitionLotSchema.parse({ ...validLot, status }).status).toBe(status);
    }
  });

  it('should reject invalid statuses', () => {
    expect(() => AcquisitionLotSchema.parse({ ...validLot, status: 'closed' })).toThrow();
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
    };

    const result = JurisdictionConfigSchema.parse(config);
    expect(result.code).toBe('US');
    expect(result.supportedMethods).toHaveLength(1);
  });

  it('should reject config with missing required fields', () => {
    expect(() => JurisdictionConfigSchema.parse({ code: 'US' })).toThrow();
  });
});
