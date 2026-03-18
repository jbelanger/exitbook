import { describe, expect, it } from 'vitest';

import {
  DecimalStringSchema,
  IsoDateTimeStringSchema,
  StoredCostBasisExecutionMetaSchema,
} from '../artifact-storage-shared.js';

describe('DecimalStringSchema', () => {
  it('should accept valid decimal strings', () => {
    expect(DecimalStringSchema.parse('0')).toBe('0');
    expect(DecimalStringSchema.parse('123')).toBe('123');
    expect(DecimalStringSchema.parse('123.456')).toBe('123.456');
    expect(DecimalStringSchema.parse('-99.5')).toBe('-99.5');
    expect(DecimalStringSchema.parse('-0.001')).toBe('-0.001');
  });

  it('should reject invalid decimal strings', () => {
    expect(() => DecimalStringSchema.parse('')).toThrow();
    expect(() => DecimalStringSchema.parse('abc')).toThrow();
    expect(() => DecimalStringSchema.parse('1e10')).toThrow();
    expect(() => DecimalStringSchema.parse('01')).toThrow();
    expect(() => DecimalStringSchema.parse('.5')).toThrow();
  });
});

describe('IsoDateTimeStringSchema', () => {
  it('should accept valid ISO datetime strings with offset', () => {
    expect(IsoDateTimeStringSchema.parse('2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z');
    expect(IsoDateTimeStringSchema.parse('2024-06-15T14:30:00+05:00')).toBe('2024-06-15T14:30:00+05:00');
  });

  it('should reject non-datetime strings', () => {
    expect(() => IsoDateTimeStringSchema.parse('not-a-date')).toThrow();
    expect(() => IsoDateTimeStringSchema.parse('')).toThrow();
  });
});

describe('StoredCostBasisExecutionMetaSchema', () => {
  it('should accept valid execution metadata', () => {
    const valid = {
      missingPricesCount: 0,
      retainedTransactionIds: [1, 2, 3],
    };
    expect(StoredCostBasisExecutionMetaSchema.parse(valid)).toEqual(valid);
  });

  it('should accept zero missing prices and empty retained ids', () => {
    const valid = { missingPricesCount: 0, retainedTransactionIds: [] };
    expect(StoredCostBasisExecutionMetaSchema.parse(valid)).toEqual(valid);
  });

  it('should reject negative missingPricesCount', () => {
    expect(() =>
      StoredCostBasisExecutionMetaSchema.parse({ missingPricesCount: -1, retainedTransactionIds: [] })
    ).toThrow();
  });

  it('should reject non-positive transaction ids', () => {
    expect(() =>
      StoredCostBasisExecutionMetaSchema.parse({ missingPricesCount: 0, retainedTransactionIds: [0] })
    ).toThrow();
  });

  it('should reject non-integer missingPricesCount', () => {
    expect(() =>
      StoredCostBasisExecutionMetaSchema.parse({ missingPricesCount: 1.5, retainedTransactionIds: [] })
    ).toThrow();
  });
});
