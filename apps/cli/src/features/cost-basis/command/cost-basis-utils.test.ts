import { describe, expect, it } from 'vitest';

import { buildCostBasisInputFromFlags, type CostBasisCommandOptions } from './cost-basis-utils.js';

describe('buildCostBasisInputFromFlags', () => {
  it('should infer average-cost when CA is selected without a method', () => {
    const options: CostBasisCommandOptions = {
      jurisdiction: 'CA',
      taxYear: 2024,
    };

    const result = buildCostBasisInputFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.method).toBe('average-cost');
    }
  });

  it('should error if method is missing for jurisdictions with multiple supported methods', () => {
    const options: CostBasisCommandOptions = {
      jurisdiction: 'US',
      taxYear: 2024,
    };

    const result = buildCostBasisInputFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("--method is required for jurisdiction 'US'");
      expect(result.error.message).toContain('fifo, lifo');
    }
  });

  it('should error if jurisdiction is missing', () => {
    const options: CostBasisCommandOptions = {
      method: 'fifo',
      taxYear: 2024,
    };

    const result = buildCostBasisInputFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('--jurisdiction is required');
    }
  });

  it('should error if tax year is missing', () => {
    const options: CostBasisCommandOptions = {
      method: 'fifo',
      jurisdiction: 'US',
    };

    const result = buildCostBasisInputFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('--tax-year is required');
    }
  });

  it('should delegate to buildCostBasisInput when all required fields present', () => {
    const options: CostBasisCommandOptions = {
      method: 'fifo',
      jurisdiction: 'US',
      taxYear: 2024,
    };

    const result = buildCostBasisInputFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.method).toBe('fifo');
      expect(result.value.jurisdiction).toBe('US');
      expect(result.value.taxYear).toBe(2024);
      expect(result.value.currency).toBe('USD');
      expect(result.value.startDate).toBeInstanceOf(Date);
      expect(result.value.endDate).toBeInstanceOf(Date);
    }
  });

  it('should pass through fiatCurrency overrides', () => {
    const options: CostBasisCommandOptions = {
      method: 'average-cost',
      jurisdiction: 'CA',
      taxYear: 2024,
      fiatCurrency: 'EUR',
    };

    const result = buildCostBasisInputFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.currency).toBe('EUR');
      expect(result.value.startDate).toBeInstanceOf(Date);
      expect(result.value.endDate).toBeInstanceOf(Date);
    }
  });

  it('should pass through explicit scope dates', () => {
    const options: CostBasisCommandOptions = {
      method: 'fifo',
      jurisdiction: 'US',
      taxYear: 2024,
      fiatCurrency: 'USD',
      startDate: '2024-03-01T00:00:00.000Z',
      endDate: '2024-09-30T23:59:59.999Z',
    };

    const result = buildCostBasisInputFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.startDate.toISOString()).toBe('2024-03-01T00:00:00.000Z');
      expect(result.value.endDate.toISOString()).toBe('2024-09-30T23:59:59.999Z');
    }
  });

  it('should error when CA is requested with fifo', () => {
    const options: CostBasisCommandOptions = {
      method: 'fifo',
      jurisdiction: 'CA',
      taxYear: 2024,
    };

    const result = buildCostBasisInputFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('supports only average-cost');
    }
  });
});
